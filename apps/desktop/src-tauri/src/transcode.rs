//! FFmpeg audio transcoding manager.
//!
//! Spawns `ffmpeg` as a child process, builds encoding arguments from
//! [`TranscodeOptions`], parses progress from stderr, and supports
//! cancellation by job ID.
//!
//! This replaces the TypeScript `TranscodeManager` that ran in the Node
//! sidecar. Rust's process control is more reliable for long-running
//! CPU-intensive children.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{broadcast, Mutex};

use crate::error::{HostError, HostResult};
use crate::protocols::to_native_path;

// =============================================================================
// Types
// =============================================================================

/// Transcoding job options (mirrors the TS `TranscodeOptions`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeOptions {
    pub job_id: Option<String>,
    pub input_uri: String,
    pub output_uri: String,
    pub target_format: String,
    pub bitrate: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    pub bit_depth: Option<u32>,
    pub vbr: Option<bool>,
    pub quality: Option<f32>,
    pub vbr_quality: Option<f32>,
    pub volume_gain_db: Option<f32>,
    pub fade_in_seconds: Option<f32>,
    pub fade_out_seconds: Option<f32>,
    pub start_time_seconds: Option<f32>,
    pub end_time_seconds: Option<f32>,
}

/// Progress event emitted during transcoding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeProgress {
    pub job_id: Option<String>,
    pub progress: f32,
    pub current_time_seconds: f32,
}

/// Result of a completed transcode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscodeResult {
    pub ok: bool,
    pub error: Option<String>,
}

// =============================================================================
// Manager
// =============================================================================

/// Manages active ffmpeg transcode processes.
pub struct TranscodeManager {
    active: Arc<Mutex<HashMap<String, Child>>>,
    progress_tx: broadcast::Sender<TranscodeProgress>,
}

impl TranscodeManager {
    pub fn new() -> Self {
        let (progress_tx, _) = broadcast::channel(64);
        Self {
            active: Arc::new(Mutex::new(HashMap::new())),
            progress_tx,
        }
    }

    /// Subscribe to progress events.
    pub fn subscribe_progress(&self) -> broadcast::Receiver<TranscodeProgress> {
        self.progress_tx.subscribe()
    }

    /// Cancel a running transcode by job ID.
    pub fn cancel(&self, job_id: &str) -> bool {
        // Sync context (Tauri sync command): blocking_lock is safe here.
        let mut active = self.active.blocking_lock();
        if let Some(mut child) = active.remove(job_id) {
            // Kill is sync; the child will be reaped by the monitor task
            let _ = child.start_kill();
            true
        } else {
            false
        }
    }

    /// Resolve the ffmpeg binary path.
    fn find_ffmpeg() -> HostResult<PathBuf> {
        // 1. Environment override
        for var in &["FFMPEG_PATH", "FFMPEG_BIN"] {
            if let Ok(p) = std::env::var(var) {
                let path = PathBuf::from(p);
                if path.is_file() {
                    return Ok(path);
                }
            }
        }
        // 2. Bundled next to the executable
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                for name in &["ffmpeg", "ffmpeg.exe"] {
                    let p = dir.join("bin").join(name);
                    if p.is_file() {
                        return Ok(p);
                    }
                }
            }
        }
        // 3. System PATH
        if let Ok(path) = which_ffmpeg() {
            return Ok(path);
        }
        Err(HostError::not_found(
            "ffmpeg binary not found (set FFMPEG_PATH)",
        ))
    }

    /// Run a transcode job. Returns when the job completes or fails.
    pub async fn transcode(&self, opts: TranscodeOptions) -> HostResult<TranscodeResult> {
        let in_path = to_native_path(&opts.input_uri);
        let out_path = to_native_path(&opts.output_uri);
        let fmt = opts.target_format.to_lowercase();
        let ffmpeg = Self::find_ffmpeg()?;
        let job_id = opts.job_id.clone().unwrap_or_else(|| {
            format!("job-{}", std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0))
        });

        // Ensure the output parent directory exists
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(HostError::from)?;
        }

        let args = build_ffmpeg_args(&opts, &in_path, &out_path, &fmt);

        eprintln!("[transcode:{job_id}] starting: {} {}", ffmpeg.display(), args.join(" "));

        let mut child = Command::new(&ffmpeg)
            .args(&args)
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| HostError::internal(format!("failed to spawn ffmpeg: {e}")))?;

        let stderr = child.stderr.take();
        let job_id_clone = job_id.clone();
        let progress_tx = self.progress_tx.clone();

        // Spawn stderr progress parser
        if let Some(stderr) = stderr {
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line).await {
                        Ok(0) => break,
                        Ok(_) => {
                            if let Some((time_s, _)) = parse_ffmpeg_progress(&line) {
                                let _ = progress_tx.send(TranscodeProgress {
                                    job_id: Some(job_id_clone.clone()),
                                    progress: 0.0, // computed by caller from duration
                                    current_time_seconds: time_s,
                                });
                            }
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        // Register for cancellation
        self.active.lock().await.insert(job_id.clone(), child);

        // Wait for completion
        let status = {
            let mut active = self.active.lock().await;
            if let Some(child) = active.get_mut(&job_id) {
                child.wait().await.map_err(|e| {
                    HostError::internal(format!("ffmpeg wait failed: {e}"))
                })?
            } else {
                // Was cancelled
                return Ok(TranscodeResult {
                    ok: false,
                    error: Some("cancelled".to_string()),
                });
            }
        };

        self.active.lock().await.remove(&job_id);

        if status.success() {
            eprintln!("[transcode:{job_id}] completed");
            Ok(TranscodeResult { ok: true, error: None })
        } else {
            let code = status.code().unwrap_or(-1);
            eprintln!("[transcode:{job_id}] failed with code {code}");
            Ok(TranscodeResult {
                ok: false,
                error: Some(format!("ffmpeg exited with code {code}")),
            })
        }
    }
}

impl Default for TranscodeManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Locate ffmpeg on the system PATH.
fn which_ffmpeg() -> Result<PathBuf, ()> {
    let path_var = std::env::var("PATH").map_err(|_| ())?;
    for dir in std::env::split_paths(&path_var) {
        for name in &["ffmpeg", "ffmpeg.exe"] {
            let p = dir.join(name);
            if p.is_file() {
                return Ok(p);
            }
        }
    }
    Err(())
}

/// Build the ffmpeg argument list from options.
fn build_ffmpeg_args(
    opts: &TranscodeOptions,
    in_path: &std::path::Path,
    out_path: &std::path::Path,
    fmt: &str,
) -> Vec<String> {
    let mut args = vec!["-y".to_string()];

    if let Some(ss) = opts.start_time_seconds {
        if ss > 0.0 {
            args.push("-ss".to_string());
            args.push(format!("{ss:.3}"));
        }
    }
    if let Some(to) = opts.end_time_seconds {
        if to > 0.0 {
            args.push("-to".to_string());
            args.push(format!("{to:.3}"));
        }
    }

    args.push("-i".to_string());
    args.push(in_path.to_string_lossy().to_string());

    // Cover art handling
    const FORMATS_WITH_COVER: &[&str] = &[
        "mp3", "flac", "m4a", "aac", "mp4", "alac", "aiff", "wma",
    ];
    if FORMATS_WITH_COVER.contains(&fmt) {
        args.extend(["-map", "0:a", "-map", "0:v?", "-c:v", "copy"].iter().map(|s| s.to_string()));
        if fmt == "mp3" || fmt == "aiff" {
            args.extend(["-id3v2_version", "3"].iter().map(|s| s.to_string()));
        } else if matches!(fmt, "m4a" | "aac" | "mp4" | "alac") {
            args.extend(["-disposition:v", "attached_pic"].iter().map(|s| s.to_string()));
        }
    } else {
        args.extend(["-map", "0:a", "-vn"].iter().map(|s| s.to_string()));
    }
    args.extend(["-map_metadata", "0"].iter().map(|s| s.to_string()));

    // Audio filters
    let mut filters = Vec::new();
    if let Some(gain) = opts.volume_gain_db {
        if gain != 0.0 {
            filters.push(format!("volume={gain}dB"));
        }
    }
    if let Some(fade_in) = opts.fade_in_seconds {
        if fade_in > 0.0 {
            filters.push(format!("afade=t=in:st=0:d={fade_in}"));
        }
    }
    if let Some(fade_out) = opts.fade_out_seconds {
        if fade_out > 0.0 {
            if let Some(end) = opts.end_time_seconds {
                if end > fade_out {
                    let start = end - fade_out;
                    filters.push(format!("afade=t=out:st={start}:d={fade_out}"));
                }
            }
        }
    }
    if !filters.is_empty() {
        args.push("-af".to_string());
        args.push(filters.join(","));
    }

    // Sample rate / channels
    if let Some(sr) = opts.sample_rate {
        args.push("-ar".to_string());
        args.push(sr.to_string());
    }
    if let Some(ch) = opts.channels {
        args.push("-ac".to_string());
        args.push(ch.to_string());
    }

    // Codec selection
    let q = opts.vbr_quality.or(opts.quality);
    match fmt {
        "flac" => {
            args.extend(["-c:a", "flac"].iter().map(|s| s.to_string()));
            match opts.bit_depth {
                Some(24) => args.extend(["-sample_fmt", "s32"].iter().map(|s| s.to_string())),
                Some(16) => args.extend(["-sample_fmt", "s16"].iter().map(|s| s.to_string())),
                _ => {}
            }
        }
        "mp3" => {
            args.extend(["-c:a", "libmp3lame"].iter().map(|s| s.to_string()));
            if opts.vbr == Some(true) {
                if let Some(q) = q {
                    args.extend(["-q:a", &q.to_string()].iter().map(|s| s.to_string()));
                }
            } else {
                args.extend(["-b:a", opts.bitrate.as_deref().unwrap_or("320k")]
                    .iter()
                    .map(|s| s.to_string()));
            }
        }
        "m4a" | "aac" | "mp4" => {
            args.extend(["-c:a", "aac"].iter().map(|s| s.to_string()));
            if opts.vbr == Some(true) {
                if let Some(q) = q {
                    args.extend(["-q:a", &q.to_string()].iter().map(|s| s.to_string()));
                }
            } else {
                args.extend(["-b:a", opts.bitrate.as_deref().unwrap_or("320k")]
                    .iter()
                    .map(|s| s.to_string()));
            }
        }
        "ogg" | "opus" => {
            args.extend(
                ["-c:a", "libopus", "-b:a", opts.bitrate.as_deref().unwrap_or("256k")]
                    .iter()
                    .map(|s| s.to_string()),
            );
        }
        "wav" => {
            let codec = match opts.bit_depth {
                Some(24) => "pcm_s24le",
                Some(32) => "pcm_s32le",
                _ => "pcm_s16le",
            };
            args.extend(["-c:a", codec].iter().map(|s| s.to_string()));
        }
        "aiff" => {
            let codec = match opts.bit_depth {
                Some(24) => "pcm_s24be",
                Some(32) => "pcm_s32be",
                _ => "pcm_s16be",
            };
            args.extend(["-c:a", codec].iter().map(|s| s.to_string()));
        }
        "alac" => {
            args.extend(["-c:a", "alac"].iter().map(|s| s.to_string()));
        }
        "wma" => {
            args.extend(
                ["-c:a", "wmav2", "-b:a", opts.bitrate.as_deref().unwrap_or("192k")]
                    .iter()
                    .map(|s| s.to_string()),
            );
        }
        _ => {
            // Unknown format: let ffmpeg guess from the extension
            eprintln!("[transcode] unknown format '{fmt}', letting ffmpeg guess");
        }
    }

    args.push(out_path.to_string_lossy().to_string());
    args
}

/// Parse ffmpeg's stderr progress line.
///
/// Looks for `time=HH:MM:SS.xx` and returns seconds.
fn parse_ffmpeg_progress(line: &str) -> Option<(f32, f32)> {
    // Example: "frame= 1234 fps= 30 q=28.0 size=    5120kB time=00:00:41.20 bitrate=1012.3kbits/s speed=1.37x"
    let time_part = line.split("time=").nth(1)?;
    let time_str = time_part.split_whitespace().next()?;
    let seconds = parse_ffmpeg_time(time_str)?;
    Some((seconds, 0.0))
}

/// Parse `HH:MM:SS.xx` into seconds.
fn parse_ffmpeg_time(s: &str) -> Option<f32> {
    let mut parts = s.split(':');
    let h: f32 = parts.next()?.parse().ok()?;
    let m: f32 = parts.next()?.parse().ok()?;
    let sec: f32 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + sec)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_time_hh_mm_ss() {
        assert!((parse_ffmpeg_time("00:00:41.20").unwrap() - 41.2).abs() < 0.01);
        assert!((parse_ffmpeg_time("01:02:03.50").unwrap() - 3723.5).abs() < 0.01);
    }

    #[test]
    fn parse_progress_line() {
        let line = "frame= 1234 fps=30 q=28.0 size=5120kB time=00:00:41.20 bitrate=1012kbits/s speed=1.37x";
        let (secs, _) = parse_ffmpeg_progress(line).unwrap();
        assert!((secs - 41.2).abs() < 0.01);
    }

    #[test]
    fn build_args_mp3_cbr() {
        let opts = TranscodeOptions {
            job_id: None,
            input_uri: "file:///in.flac".to_string(),
            output_uri: "file:///out.mp3".to_string(),
            target_format: "mp3".to_string(),
            bitrate: Some("320k".to_string()),
            vbr: Some(false),
            ..Default::default()
        };
        // Fill remaining fields
        let opts = TranscodeOptions {
            sample_rate: None,
            channels: None,
            bit_depth: None,
            quality: None,
            vbr_quality: None,
            volume_gain_db: None,
            fade_in_seconds: None,
            fade_out_seconds: None,
            start_time_seconds: None,
            end_time_seconds: None,
            ..opts
        };
        let args = build_ffmpeg_args(
            &opts,
            std::path::Path::new("/in.flac"),
            std::path::Path::new("/out.mp3"),
            "mp3",
        );
        assert!(args.contains(&"libmp3lame".to_string()));
        assert!(args.contains(&"320k".to_string()));
    }
}

// Manual Default impl (derive would require all fields; we want a simple one)
impl Default for TranscodeOptions {
    fn default() -> Self {
        Self {
            job_id: None,
            input_uri: String::new(),
            output_uri: String::new(),
            target_format: String::new(),
            bitrate: None,
            sample_rate: None,
            channels: None,
            bit_depth: None,
            vbr: None,
            quality: None,
            vbr_quality: None,
            volume_gain_db: None,
            fade_in_seconds: None,
            fade_out_seconds: None,
            start_time_seconds: None,
            end_time_seconds: None,
        }
    }
}
