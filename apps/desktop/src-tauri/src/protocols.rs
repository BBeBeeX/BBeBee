//! Custom `bbebee-file://` protocol handler.
//!
//! Serves local files to the webview with proper MIME types, CORS headers,
//! and HTTP Range support (for audio seeking). The protocol is registered
//! in `main.rs` via `register_asynchronous_uri_scheme_protocol`.
//!
//! URL forms handled:
//! - `bbebee-file:///path/to/file` (empty host, macOS native)
//! - `bbebee-file://localhost/path/to/file` (Linux, wry requires a host)
//! - `http://bbebee-file.localhost/path` (Windows, WebView2 workaround)

use std::borrow::Cow;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Convert a `bbebee-file://` or `file://` URI to a native filesystem path.
///
/// Handles percent-encoding, query strings, fragments, and the
/// `//localhost/` host prefix. Windows drive letters are preserved.
pub fn to_native_path(raw_uri: &str) -> PathBuf {
    let mut s = raw_uri.trim();

    // Strip scheme
    if let Some(rest) = s.strip_prefix("bbebee-file:") {
        s = rest;
    } else if let Some(rest) = s.strip_prefix("file:") {
        s = rest;
    }

    // Strip query and fragment
    if let Some(pos) = s.find('?') {
        s = &s[..pos];
    }
    if let Some(pos) = s.find('#') {
        s = &s[..pos];
    }

    // Strip host: //localhost/ -> /, /// -> /
    if let Some(rest) = s.strip_prefix("//localhost/") {
        s = rest;
    } else {
        s = s.trim_start_matches('/');
    }

    // Percent-decode
    let decoded = percent_encoding::percent_decode_str(s)
        .decode_utf8_lossy()
        .into_owned();

    // Windows drive letter (C:/...) -> C:\...
    if decoded.len() >= 2 {
        let mut chars = decoded.chars();
        if let (Some(c), Some(':')) = (chars.next(), chars.next()) {
            if c.is_ascii_alphabetic() {
                return PathBuf::from(decoded.replace('/', "\\"));
            }
        }
    }

    PathBuf::from(format!("/{decoded}"))
}

/// MIME type from file extension.
pub fn mime_type_from_ext(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("flac") => "audio/flac",
        Some("mp3") => "audio/mpeg",
        Some("m4a") | Some("aac") => "audio/mp4",
        Some("ogg") | Some("oga") => "audio/ogg",
        Some("opus") => "audio/opus",
        Some("wav") => "audio/wav",
        Some("weba") => "audio/webm",
        Some("json") => "application/json",
        Some("js") | Some("mjs") => "text/javascript",
        Some("css") => "text/css",
        Some("html") => "text/html",
        _ => "application/octet-stream",
    }
}

/// Build a simple error response.
fn error_response(
    status: tauri::http::StatusCode,
    message: &'static str,
) -> tauri::http::Response<Cow<'static, [u8]>> {
    tauri::http::Response::builder()
        .status(status)
        .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(tauri::http::header::CONTENT_TYPE, "text/plain")
        .body(Cow::Borrowed(message.as_bytes()))
        .unwrap_or_else(|_| {
            // Fallback: this should never happen with a valid builder
            tauri::http::Response::builder()
                .status(tauri::http::StatusCode::INTERNAL_SERVER_ERROR)
                .body(Cow::Borrowed(&b"Internal error"[..]))
                .unwrap()
        })
}

/// Parse an HTTP Range header, returning (start, end) inclusive byte offsets.
fn parse_range(range_header: &str, file_size: u64) -> Option<(u64, u64)> {
    let spec = range_header.strip_prefix("bytes=")?;
    let mut parts = spec.splitn(2, '-');
    let start_str = parts.next()?.trim();
    let end_str = parts.next()?.trim();

    let (start, end) = match (start_str.parse::<u64>().ok(), end_str.parse::<u64>().ok()) {
        (Some(s), Some(e)) => (s, e.min(file_size.saturating_sub(1))),
        (Some(s), None) => (s, file_size.saturating_sub(1)),
        (None, Some(len)) => (
            file_size.saturating_sub(len),
            file_size.saturating_sub(1),
        ),
        _ => return None,
    };

    if start <= end && start < file_size {
        Some((start, end))
    } else {
        None
    }
}

/// Handle a `bbebee-file://` protocol request.
///
/// Runs on a spawned thread to avoid blocking the Tauri async runtime.
/// Responds with the file contents, supporting HTTP Range requests for
/// audio seeking.
pub fn handle_bbebee_file_request(
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let uri_str = request.uri().to_string();
    let range_header = request
        .headers()
        .get(tauri::http::header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);

    std::thread::spawn(move || {
        let file_path = to_native_path(&uri_str);

        // 404: file doesn't exist
        if !file_path.is_file() {
            responder.respond(error_response(
                tauri::http::StatusCode::NOT_FOUND,
                "File Not Found",
            ));
            return;
        }

        let metadata = match std::fs::metadata(&file_path) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[bbebee-file] metadata failed for {file_path:?}: {e}");
                responder.respond(error_response(
                    tauri::http::StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to read metadata",
                ));
                return;
            }
        };

        let file_size = metadata.len();
        let mime = mime_type_from_ext(&file_path);

        let mut file = match File::open(&file_path) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("[bbebee-file] open failed for {file_path:?}: {e}");
                responder.respond(error_response(
                    tauri::http::StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to open file",
                ));
                return;
            }
        };

        // Handle Range requests (audio seeking)
        if let Some(range_str) = range_header {
            if let Some((start, end)) = parse_range(&range_str, file_size) {
                let chunk_size = end - start + 1;
                if file.seek(SeekFrom::Start(start)).is_ok() {
                    let mut buf = vec![0u8; chunk_size as usize];
                    if file.read_exact(&mut buf).is_ok() {
                        let response = tauri::http::Response::builder()
                            .status(tauri::http::StatusCode::PARTIAL_CONTENT)
                            .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                            .header(tauri::http::header::ACCEPT_RANGES, "bytes")
                            .header(
                                tauri::http::header::CONTENT_RANGE,
                                format!("bytes {start}-{end}/{file_size}"),
                            )
                            .header(tauri::http::header::CONTENT_LENGTH, chunk_size.to_string())
                            .header(tauri::http::header::CONTENT_TYPE, mime)
                            .body(Cow::Owned(buf));
                        if let Ok(resp) = response {
                            responder.respond(resp);
                        }
                        return;
                    }
                }
            }
        }

        // Full file response
        let mut buf = Vec::with_capacity(file_size.min(10 * 1024 * 1024) as usize);
        match file.read_to_end(&mut buf) {
            Ok(_) => {
                let response = tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::OK)
                    .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .header(tauri::http::header::ACCEPT_RANGES, "bytes")
                    .header(tauri::http::header::CONTENT_LENGTH, file_size.to_string())
                    .header(tauri::http::header::CONTENT_TYPE, mime)
                    .body(Cow::Owned(buf));
                if let Ok(resp) = response {
                    responder.respond(resp);
                }
            }
            Err(e) => {
                eprintln!("[bbebee-file] read failed for {file_path:?}: {e}");
                responder.respond(error_response(
                    tauri::http::StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to read file",
                ));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_native_path_handles_windows() {
        assert_eq!(
            to_native_path("bbebee-file:///C:/Users/test/music/track.mp3")
                .to_str()
                .unwrap(),
            "C:\\Users\\test\\music\\track.mp3"
        );
        assert_eq!(
            to_native_path("bbebee-file://localhost/D:/Music/song.wav")
                .to_str()
                .unwrap(),
            "D:\\Music\\song.wav"
        );
    }

    #[test]
    fn to_native_path_handles_unix() {
        assert_eq!(
            to_native_path("bbebee-file:///home/user/.cache/artworks/1.jpg")
                .to_str()
                .unwrap(),
            "/home/user/.cache/artworks/1.jpg"
        );
        assert_eq!(
            to_native_path("bbebee-file:///var/music/song.ogg?v=123")
                .to_str()
                .unwrap(),
            "/var/music/song.ogg"
        );
    }

    #[test]
    fn to_native_path_decodes_percent_encoding() {
        let path = to_native_path(
            "bbebee-file:///F:/music/9.%20One%C2%A0Last%20Kiss.flac",
        );
        assert!(path.to_str().unwrap().contains("One\u{a0}Last"));
    }

    #[test]
    fn parse_range_handles_valid_ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=100-", 1000), Some((100, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
    }

    #[test]
    fn parse_range_rejects_invalid() {
        assert_eq!(parse_range("bytes=999-0", 1000), None);
        assert_eq!(parse_range("bytes=2000-3000", 1000), None);
        assert_eq!(parse_range("invalid", 1000), None);
    }
}
