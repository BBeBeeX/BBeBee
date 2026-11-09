//! Cross-process memory sampler (memory-governance §10).
//!
//! The OOM post-mortem could not see the renderer filling up until the
//! PartitionAlloc pool was already gone. This sampler is the fix for that
//! blindness: one task polls resident memory for the host, every
//! `msedgewebview2` child, and the managed sidecar/engine pids, keeps a
//! bounded ring, and raises a single-shot warning when the total crosses a
//! fraction of physical memory.
//!
//! Every structure answers the eight questions: created/held by
//! `MetricsState` in `AppState`; ring capacity `METRICS_RING_CAP` samples
//! (fixed-size numbers, no strings); overflow replaces the oldest; consumed
//! via the `system_runtime_stats` command; sampling failure skips a tick;
//! released with the app; monitoring is the feature itself — the sampler
//! allocates nothing per tick beyond the refresh.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use sysinfo::System;
use tauri::Emitter;

use crate::audio::AudioEngineSupervisor;
use crate::error::lock_recover;
use crate::sidecar::{SidecarCounters, SidecarManager};

/// Samples kept: 30 s apart → six hours of history.
pub const METRICS_RING_CAP: usize = 720;
/// Seconds between samples.
const SAMPLE_INTERVAL_SECS: u64 = 30;
/// Warn when summed RSS crosses this fraction of physical memory.
const DEFAULT_ALERT_RATIO: f64 = 0.75;

/// One instantaneous cross-process snapshot. Numbers only — the ring must
/// never allocate strings per tick.
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct MetricsSample {
    pub at_ms: u64,
    /// This process (the Tauri host).
    pub host_rss_bytes: u64,
    /// Sum of every `msedgewebview2` child.
    pub webview_rss_bytes: u64,
    /// Sum of the managed sidecar + audio-engine pids.
    pub managed_rss_bytes: u64,
}

/// A managed child the sampler resolves to a pid fresh each tick — the
/// handle follows restarts automatically, no slot bookkeeping needed.
#[derive(Clone)]
pub enum ManagedChild {
    Sidecar(Arc<SidecarManager>),
    Engine(Arc<AudioEngineSupervisor>),
}

impl ManagedChild {
    async fn pid(&self) -> Option<u32> {
        match self {
            ManagedChild::Sidecar(m) => m.pid().await,
            ManagedChild::Engine(e) => e.pid().await,
        }
    }
}

#[derive(Default)]
pub struct MetricsState {
    ring: StdMutex<VecDeque<MetricsSample>>,
    managed: StdMutex<Vec<ManagedChild>>,
    sidecar_counters: StdMutex<Vec<SidecarCounters>>,
    warned: AtomicBool,
}

impl MetricsState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Track a managed child; its pid is re-resolved every sample, so a
    /// restarted sidecar or engine is picked up without re-registration.
    pub fn track_child(&self, child: ManagedChild) {
        lock_recover(&self.managed).push(child);
    }

    pub fn track_counters(&self, counters: SidecarCounters) {
        lock_recover(&self.sidecar_counters).push(counters);
    }

    fn push_sample(&self, sample: MetricsSample) {
        let mut ring = lock_recover(&self.ring);
        if ring.len() >= METRICS_RING_CAP {
            ring.pop_front();
        }
        ring.push_back(sample);
    }

    pub fn snapshot(&self) -> serde_json::Value {
        let ring = lock_recover(&self.ring);
        let counters: Vec<serde_json::Value> = lock_recover(&self.sidecar_counters)
            .iter()
            .map(|c| c.snapshot())
            .collect();
        serde_json::json!({
            "intervalSecs": SAMPLE_INTERVAL_SECS,
            "ringCap": METRICS_RING_CAP,
            "samples": ring.len(),
            "latest": ring.back().copied(),
            "oldest": ring.front().copied(),
            "sidecarCounters": counters,
        })
    }
}

fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The one-shot warning emission. Split out for clarity: the threshold is
/// compared against physical memory, and the flag makes it edge-triggered so
/// a long-running saturated machine does not spam the webview.
async fn sample_once(sys: &mut System, state: &MetricsState, app: &tauri::AppHandle) {
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    sys.refresh_memory();

    let self_pid = std::process::id();
    let mut host_rss = 0u64;
    let mut webview_rss = 0u64;
    let mut managed_rss = 0u64;
    // Clone the handle list under the lock, resolve pids outside it — a std
    // mutex guard must never be held across an await.
    let children: Vec<ManagedChild> = lock_recover(&state.managed).clone();
    let mut managed_pids = Vec::with_capacity(children.len());
    for child in &children {
        if let Some(pid) = child.pid().await {
            managed_pids.push(pid);
        }
    }

    for (pid, process) in sys.processes() {
        let pid32 = pid.as_u32();
        let rss = process.memory();
        if pid32 == self_pid {
            host_rss = rss;
        } else if managed_pids.contains(&pid32) {
            managed_rss += rss;
        } else {
            let name = process.name().to_string_lossy().to_lowercase();
            if name.starts_with("msedgewebview2") {
                webview_rss += rss;
            }
        }
    }

    let sample = MetricsSample {
        at_ms: unix_ms(),
        host_rss_bytes: host_rss,
        webview_rss_bytes: webview_rss,
        managed_rss_bytes: managed_rss,
    };
    state.push_sample(sample);

    let alert_ratio: f64 = std::env::var("BBEBEE_MEMORY_ALERT_RATIO")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_ALERT_RATIO);
    let total = sys.total_memory();
    let used = host_rss + webview_rss + managed_rss;
    if total > 0 && (used as f64) >= alert_ratio * (total as f64) {
        if !state.warned.swap(true, Ordering::Relaxed) {
            eprintln!(
                "[metrics] memory alert: {} MiB of {} MiB across host/webviews/managed",
                used / (1024 * 1024),
                total / (1024 * 1024)
            );
            let _ = app.emit("metrics:warning", &serde_json::json!({
                "usedBytes": used,
                "totalBytes": total,
                "ratio": alert_ratio,
                "sample": sample,
            }));
        }
    } else if state.warned.load(Ordering::Relaxed) {
        // Recovered below the threshold — re-arm so the next crossing warns.
        state.warned.store(false, Ordering::Relaxed);
    }
}

/// Spawned once at setup; runs until the app exits.
pub fn spawn_metrics_sampler(app: tauri::AppHandle, state: std::sync::Arc<MetricsState>) {
    tauri::async_runtime::spawn(async move {
        let mut sys = System::new();
        let mut ticker = tokio::time::interval(Duration::from_secs(SAMPLE_INTERVAL_SECS));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            sample_once(&mut sys, &state, &app).await;
        }
    });
}

/// The `system_runtime_stats` command body: latest samples + transport gates.
pub fn runtime_stats(state: &MetricsState) -> serde_json::Value {
    state.snapshot()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_is_bounded_and_serves_latest() {
        let state = MetricsState::new();
        for i in 0..(METRICS_RING_CAP as u64 + 5) {
            state.push_sample(MetricsSample {
                at_ms: i,
                host_rss_bytes: i,
                webview_rss_bytes: 0,
                managed_rss_bytes: 0,
            });
        }
        let snap = state.snapshot();
        assert_eq!(snap["samples"], serde_json::json!(METRICS_RING_CAP));
        let latest = snap["latest"].as_object().unwrap();
        assert_eq!(latest["at_ms"], serde_json::json!(METRICS_RING_CAP as u64 + 4));
        let oldest = snap["oldest"].as_object().unwrap();
        assert_eq!(oldest["at_ms"], serde_json::json!(5), "oldest samples were evicted");
    }

    #[test]
    fn counters_reach_the_snapshot() {
        let state = MetricsState::new();
        state.track_counters(SidecarCounters::default());
        let snap = state.snapshot();
        assert_eq!(snap["sidecarCounters"].as_array().unwrap().len(), 1);
    }
}
