use std::borrow::Cow;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

pub fn to_native_path(raw_uri: &str) -> PathBuf {
    let mut s = raw_uri.trim();
    if s.starts_with("bbebee-file:") {
        s = &s["bbebee-file:".len()..];
    } else if s.starts_with("file:") {
        s = &s["file:".len()..];
    }

    if let Some(pos) = s.find('?') {
        s = &s[..pos];
    }
    if let Some(pos) = s.find('#') {
        s = &s[..pos];
    }

    if s.starts_with("//localhost/") {
        s = &s["//localhost/".len()..];
    } else {
        while s.starts_with('/') {
            s = &s[1..];
        }
    }

    let decoded = percent_encoding::percent_decode_str(s)
        .decode_utf8_lossy()
        .to_string();

    let is_windows_drive = decoded.len() >= 2
        && decoded.chars().next().map_or(false, |c| c.is_ascii_alphabetic())
        && decoded.chars().nth(1) == Some(':');

    if is_windows_drive {
        PathBuf::from(decoded.replace('/', "\\"))
    } else {
        PathBuf::from(format!("/{}", decoded))
    }
}

pub fn mime_type_from_ext(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase()).as_deref() {
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

pub fn handle_bbebee_file_request(
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let uri_str = request.uri().to_string();
    let range_header = request
        .headers()
        .get(tauri::http::header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    std::thread::spawn(move || {
        let file_path = to_native_path(&uri_str);
        if !file_path.exists() || !file_path.is_file() {
            responder.respond(
                tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .header(tauri::http::header::CONTENT_TYPE, "text/plain")
                    .body(Cow::Borrowed(&b"File Not Found"[..]))
                    .unwrap(),
            );
            return;
        }

        let metadata = match std::fs::metadata(&file_path) {
            Ok(m) => m,
            Err(_) => {
                responder.respond(
                    tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::INTERNAL_SERVER_ERROR)
                        .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .body(Cow::Borrowed(&b"Failed to read metadata"[..]))
                        .unwrap(),
                );
                return;
            }
        };

        let file_size = metadata.len();
        let mime = mime_type_from_ext(&file_path);

        let mut file = match File::open(&file_path) {
            Ok(f) => f,
            Err(_) => {
                responder.respond(
                    tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::INTERNAL_SERVER_ERROR)
                        .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .body(Cow::Borrowed(&b"Failed to open file"[..]))
                        .unwrap(),
                );
                return;
            }
        };

        if let Some(range_str) = range_header {
            if let Some(spec) = range_str.strip_prefix("bytes=") {
                let parts: Vec<&str> = spec.split('-').collect();
                if parts.len() == 2 {
                    let start: Option<u64> = parts[0].trim().parse().ok();
                    let end: Option<u64> = parts[1].trim().parse().ok();

                    let (start_byte, end_byte) = match (start, end) {
                        (Some(s), Some(e)) => (s, e.min(file_size.saturating_sub(1))),
                        (Some(s), None) => (s, file_size.saturating_sub(1)),
                        (None, Some(suffix_len)) => {
                            (file_size.saturating_sub(suffix_len), file_size.saturating_sub(1))
                        }
                        _ => (0, file_size.saturating_sub(1)),
                    };

                    if start_byte <= end_byte && start_byte < file_size {
                        let chunk_size = end_byte - start_byte + 1;
                        if file.seek(SeekFrom::Start(start_byte)).is_ok() {
                            let mut buf = vec![0u8; chunk_size as usize];
                            if file.read_exact(&mut buf).is_ok() {
                                responder.respond(
                                    tauri::http::Response::builder()
                                        .status(tauri::http::StatusCode::PARTIAL_CONTENT)
                                        .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                                        .header(tauri::http::header::ACCEPT_RANGES, "bytes")
                                        .header(
                                            tauri::http::header::CONTENT_RANGE,
                                            format!("bytes {}-{}/{}", start_byte, end_byte, file_size),
                                        )
                                        .header(tauri::http::header::CONTENT_LENGTH, chunk_size.to_string())
                                        .header(tauri::http::header::CONTENT_TYPE, mime)
                                        .body(Cow::Owned(buf))
                                        .unwrap(),
                                );
                                return;
                            }
                        }
                    }
                }
            }
        }

        let mut buf = Vec::with_capacity(file_size as usize);
        if file.read_to_end(&mut buf).is_ok() {
            responder.respond(
                tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::OK)
                    .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .header(tauri::http::header::ACCEPT_RANGES, "bytes")
                    .header(tauri::http::header::CONTENT_LENGTH, file_size.to_string())
                    .header(tauri::http::header::CONTENT_TYPE, mime)
                    .body(Cow::Owned(buf))
                    .unwrap(),
            );
        } else {
            responder.respond(
                tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::INTERNAL_SERVER_ERROR)
                    .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(Cow::Borrowed(&b"Failed to read file"[..]))
                    .unwrap(),
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_to_native_path_windows() {
        let path = to_native_path("bbebee-file:///C:/Users/test/music/track.mp3");
        assert_eq!(path.to_str().unwrap(), "C:\\Users\\test\\music\\track.mp3");

        let path_encoded = to_native_path("bbebee-file:///F:/music/ACG/Eva/9.%20One%C2%A0Last%C2%A0Kiss%20-%E5%AE%87%E5%A4%9A%E7%94%B0%E3%83%92%E3%82%AB%E3%83%AB.flac");
        assert_eq!(path_encoded.to_str().unwrap(), "F:\\music\\ACG\\Eva\\9. One\u{00A0}Last\u{00A0}Kiss -宇多田ヒカル.flac");

        let path_localhost = to_native_path("bbebee-file://localhost/D:/Music/song.wav");
        assert_eq!(path_localhost.to_str().unwrap(), "D:\\Music\\song.wav");
    }

    #[test]
    fn test_to_native_path_unix() {
        let path = to_native_path("bbebee-file:///home/user/.cache/artworks/1.jpg");
        assert_eq!(path.to_str().unwrap(), "/home/user/.cache/artworks/1.jpg");

        let path_with_query = to_native_path("bbebee-file:///var/music/song.ogg?v=123");
        assert_eq!(path_with_query.to_str().unwrap(), "/var/music/song.ogg");
    }
}
