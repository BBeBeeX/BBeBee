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
    message: impl Into<Cow<'static, str>>,
) -> tauri::http::Response<Cow<'static, [u8]>> {
    let message: Cow<'static, str> = message.into();
    tauri::http::Response::builder()
        .status(status)
        .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(tauri::http::header::CONTENT_TYPE, "text/plain")
        .body(Cow::Owned(message.into_owned().into_bytes()))
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

// ========================================================================
// bbebee-plugin:// — installed external plugin files, served natively
// ========================================================================
//
// The serving logic used to live only in the Node sidecar, reached from
// here through a stdio round-trip (`protocol:plugin`). That extra hop
// was the difference between working and not on Windows: artwork over
// `bbebee-file` (served natively below) loaded, while plugin modules
// failed their fetch. This is a faithful port of the sidecar
// implementation — same URL forms, directory resolution, traversal
// confinement and MIME table — and the sidecar copy is removed so the
// two cannot drift. The confinement tests are ported from the sidecar
// suite with the same vectors.

/// Serve one `bbebee-plugin://` request from the installed-plugins
/// directory. Pure apart from filesystem reads, so tests can point it
/// at a fixture tree.
fn serve_plugin_file(
    installed_root: &Path,
    raw_url: &str,
) -> tauri::http::Response<Cow<'static, [u8]>> {
    let Some((plugin_id, sub_path)) = parse_plugin_request_url(raw_url) else {
        return error_response(
            tauri::http::StatusCode::BAD_REQUEST,
            format!("Invalid plugin URL: {raw_url}"),
        );
    };
    let Some(plugin_dir) = resolve_plugin_dir(&plugin_id, installed_root) else {
        // The body carries the resolved root and id: a "not found" here
        // has exactly two possible causes (wrong root, wrong id) and
        // the webview's loader diagnostics surface this text verbatim.
        return error_response(
            tauri::http::StatusCode::NOT_FOUND,
            format!(
                "Plugin not found (id={plugin_id}, root={})",
                installed_root.display()
            ),
        );
    };
    // Separator boundary, not a bare prefix: `/plugins/abc-secret`
    // starts with the string `/plugins/abc` but is a *sibling*, and a
    // prefix-only check waves `../abc-secret/…` straight through.
    let root = lexical_normalize(&plugin_dir);
    let safe = lexical_normalize(&plugin_dir.join(&sub_path));
    if safe != root && !safe.starts_with(&root) {
        return error_response(tauri::http::StatusCode::FORBIDDEN, "Forbidden");
    }
    let is_file = std::fs::metadata(&safe).map(|m| m.is_file()).unwrap_or(false);
    if !is_file {
        return error_response(
            tauri::http::StatusCode::NOT_FOUND,
            format!("Plugin File Not Found (path={})", safe.display()),
        );
    }
    match std::fs::read(&safe) {
        Ok(bytes) => tauri::http::Response::builder()
            .status(tauri::http::StatusCode::OK)
            .header(tauri::http::header::CONTENT_TYPE, plugin_content_type(&safe))
            .header(tauri::http::header::CONTENT_LENGTH, bytes.len().to_string())
            .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(Cow::Owned(bytes))
            .unwrap_or_else(|_| {
                error_response(
                    tauri::http::StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to build protocol response",
                )
            }),
        Err(_) => error_response(
            tauri::http::StatusCode::NOT_FOUND,
            "Plugin File Not Found",
        ),
    }
}

/// Handle a `bbebee-plugin://` protocol request.
///
/// Registered in `main.rs` exactly like `bbebee-file`: the webview's
/// dynamic `import()` of an external plugin's entry modules lands here,
/// and the file is served off a worker thread — no sidecar round-trip,
/// no app state — mirroring the handler whose Windows behaviour is
/// already proven by artwork and media loads.
pub fn handle_bbebee_plugin_request(
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let uri_str = request.uri().to_string();
    std::thread::spawn(move || {
        let response = match installed_plugins_dir() {
            Some(root) => serve_plugin_file(&root, &uri_str),
            None => error_response(
                tauri::http::StatusCode::SERVICE_UNAVAILABLE,
                "Plugin directory unavailable",
            ),
        };
        responder.respond(response);
    });
}

/// `<userData>/installed-plugins`, with `userData` resolved exactly as
/// the sidecar resolves it (`core-paths-node`'s
/// `resolveSystemPath('userData')`): `BBEBEE_DATA_DIR` wins, then the
/// platform data directory + `BBeBee`.
fn installed_plugins_dir() -> Option<PathBuf> {
    let user_data = match std::env::var("BBEBEE_DATA_DIR") {
        Ok(custom) if !custom.is_empty() => PathBuf::from(custom),
        _ => platform_user_data_dir()?,
    };
    Some(user_data.join("installed-plugins"))
}

#[cfg(target_os = "windows")]
fn platform_data_base() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(PathBuf::from)
}

#[cfg(target_os = "macos")]
fn platform_data_base() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Library").join("Application Support"))
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn platform_data_base() -> Option<PathBuf> {
    if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
        Some(PathBuf::from(xdg))
    } else {
        std::env::var_os("HOME")
            .map(|home| PathBuf::from(home).join(".local").join("share"))
    }
}

fn platform_user_data_dir() -> Option<PathBuf> {
    platform_data_base().map(|base| base.join("BBeBee"))
}

/// An id is a name (a scoped id carries a single slash), never a path:
/// dot segments, empty segments and backslash separators are refused.
/// Percent-encoded spellings land here already decoded by
/// `parse_plugin_request_url`, so `%2e%2e` is judged as `..`.
fn is_safe_plugin_id(plugin_id: &str) -> bool {
    if plugin_id.is_empty() || plugin_id.contains('\\') {
        return false;
    }
    plugin_id
        .split('/')
        .all(|seg| !seg.is_empty() && seg != "." && seg != "..")
}

fn percent_decode(segment: &str) -> Option<String> {
    percent_encoding::percent_decode_str(segment)
        .decode_utf8()
        .ok()
        .map(|c| c.into_owned())
}

/// Resolve `.`/`..` path segments the way WHATWG URL parsing does:
/// a segment that is (case-insensitively) `.`, `%2e`, `..`, `.%2e`,
/// `%2e.` or `%2e%2e` is a dot segment; `..` pops the previous segment,
/// and a trailing dot segment leaves a trailing empty segment.
fn normalize_dot_segments(path: &str) -> Vec<String> {
    fn dot_kind(seg: &str) -> u8 {
        match seg.to_lowercase().as_str() {
            "." | "%2e" => 1,
            ".." | ".%2e" | "%2e." | "%2e%2e" => 2,
            _ => 0,
        }
    }
    let raw: Vec<&str> = path.split('/').collect();
    let mut out: Vec<String> = Vec::new();
    for (i, seg) in raw.iter().enumerate() {
        let last = i == raw.len() - 1;
        match dot_kind(seg) {
            1 => {
                if last {
                    out.push(String::new());
                }
            }
            2 => {
                out.pop();
                if last {
                    out.push(String::new());
                }
            }
            _ => out.push((*seg).to_string()),
        }
    }
    out
}

/// Parse a plugin request URL into `(pluginId, subPath)`, across the
/// address forms the loader and wry produce:
/// - `http://bbebee-plugin.localhost/app/<id>/<sub>` (the form the
///   page requests on WebView2)
/// - `bbebee-plugin://localhost/app/<id>/<sub>` (what wry's WebView2
///   workaround actually delivers to the handler for the form above:
///   it folds `http://<scheme>.localhost/<path>` back to
///   `<scheme>://localhost/<path>` — the only form a Windows handler
///   ever sees; the path may also arrive without the `app` prefix)
/// - `bbebee-plugin://app/<id>/<sub>` (also `plugin` as the host)
/// - `bbebee-plugin://<id>/<sub>` (bare form)
fn parse_plugin_request_url(raw_url: &str) -> Option<(String, String)> {
    let no_query = raw_url.split(['?', '#']).next()?;
    let rest = no_query.split_once("://")?.1;
    let (host_raw, pathname) = match rest.find('/') {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, ""),
    };
    // The URL parser lowercases the host before the sidecar's parser
    // compares or decodes it; mirror that.
    let host = host_raw.to_lowercase();
    let stripped = pathname.trim_start_matches('/');
    // WHATWG URL parsing (what the sidecar's `new URL` does) resolves
    // dot segments in the path before the parser ever sees them —
    // including the percent-encoded spellings — so `/app/a/../b`
    // arrives as id `b`, never as a traversal. Mirror that here; the
    // serve-time confinement check remains as the second layer.
    let segments = normalize_dot_segments(stripped);
    if host == "bbebee-plugin.localhost" {
        if segments.first().map(String::as_str) != Some("app")
            && segments.first().map(String::as_str) != Some("plugin")
        {
            return None;
        }
        let raw_id = segments.get(1).map(String::as_str).filter(|s| !s.is_empty())?;
        let plugin_id = percent_decode(raw_id)?;
        if !is_safe_plugin_id(&plugin_id) {
            return None;
        }
        let sub = segments[2..].join("/");
        return Some((plugin_id, if sub.is_empty() { "index.js".into() } else { sub }));
    }
    if host == "localhost" {
        // The wry-folded form: the path keeps whatever the page's URL
        // carried — `app/<id>/<sub>` for the loader's URLs, or a bare
        // `<id>/<sub>` if the prefix was never there.
        let prefixed = segments.first().map(String::as_str) == Some("app")
            || segments.first().map(String::as_str) == Some("plugin");
        let (raw_id, sub_start) = if prefixed {
            (segments.get(1), 2)
        } else {
            (segments.first(), 1)
        };
        let raw_id = raw_id.map(String::as_str).filter(|s| !s.is_empty())?;
        let plugin_id = percent_decode(raw_id)?;
        if !is_safe_plugin_id(&plugin_id) {
            return None;
        }
        let sub = segments[sub_start.min(segments.len())..].join("/");
        return Some((plugin_id, if sub.is_empty() { "index.js".into() } else { sub }));
    }
    if host == "app" || host == "plugin" {
        let raw_id = segments.first().map(String::as_str).filter(|s| !s.is_empty())?;
        let plugin_id = percent_decode(raw_id)?;
        if !is_safe_plugin_id(&plugin_id) {
            return None;
        }
        let sub = segments[1..].join("/");
        return Some((plugin_id, if sub.is_empty() { "index.js".into() } else { sub }));
    }
    let plugin_id = percent_decode(&host)?;
    if !is_safe_plugin_id(&plugin_id) {
        return None;
    }
    let sub = segments.join("/");
    Some((
        plugin_id,
        if sub.is_empty() {
            "index.js".into()
        } else {
            sub
        },
    ))
}

/// FNV-1a dual-lane hash: a unit-for-unit port of `@BBeBee/protocol`'s
/// `shortHash` (JS `charCodeAt` iterates UTF-16 code units).
fn plugin_short_hash(value: &str) -> String {
    let mut a: u32 = 0x811c9dc5;
    let mut b: u32 = 0x01000193 ^ 0x5bf03635;
    for unit in value.encode_utf16() {
        let code = u32::from(unit);
        a = (a ^ code).wrapping_mul(0x01000193);
        b = (b ^ (code + 1)).wrapping_mul(0x01000193);
    }
    format!("{a:08x}{b:08x}")
}

fn is_plugin_id_char(unit: u16) -> bool {
    matches!(unit, 0x30..=0x39 | 0x41..=0x5A | 0x61..=0x7A | 0x2E | 0x5F | 0x2D)
}

/// Replace every run of characters outside `[a-zA-Z0-9._-]` with one
/// `_`, per UTF-16 code unit like the JS regex it ports.
fn sanitize_plugin_id(value: &str) -> String {
    let mut units: Vec<u16> = Vec::new();
    let mut in_bad_run = false;
    for unit in value.encode_utf16() {
        if is_plugin_id_char(unit) {
            units.push(unit);
            in_bad_run = false;
        } else if !in_bad_run {
            units.push(0x5F);
            in_bad_run = true;
        }
    }
    String::from_utf16_lossy(&units)
}

/// `<readable>-<hash>` directory name: a port of `@BBeBee/protocol`'s
/// `pluginDirName`.
fn plugin_dir_name(plugin_id: &str) -> String {
    let stripped = plugin_id.strip_prefix('@').unwrap_or(plugin_id);
    let sanitized = sanitize_plugin_id(stripped);
    let readable: String = sanitized.chars().take(48).collect();
    format!("{readable}-{}", plugin_short_hash(plugin_id))
}

/// Lexically normalize a path (`.` dropped, `..` folded) without
/// touching the filesystem — the `resolve()` semantics the sidecar's
/// confinement checks rely on.
fn lexical_normalize(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            c => out.push(c.as_os_str()),
        }
    }
    out
}

/// Find the on-disk directory for an installed plugin id: the hashed
/// `pluginDirName`, then the exact sanitized name, then a directory
/// scan for the id or a versioned (`<id>@<version>`) match.
fn resolve_plugin_dir(plugin_id: &str, installed_root: &Path) -> Option<PathBuf> {
    if !is_safe_plugin_id(plugin_id) {
        return None;
    }
    let _ = std::fs::create_dir_all(installed_root);
    let root = lexical_normalize(installed_root);
    // A candidate only counts when it resolves strictly *inside* the
    // installed-plugins root. The sanitized-name step is the one that
    // used to escape: the sanitizer preserves dots, so the id `..`
    // joined straight onto the parent directory.
    let inside_root = |candidate: &Path| {
        let resolved = lexical_normalize(candidate);
        resolved != root && resolved.starts_with(&root)
    };
    let hashed_name = plugin_dir_name(plugin_id);
    let hashed_path = installed_root.join(&hashed_name);
    if inside_root(&hashed_path) && hashed_path.exists() {
        return Some(hashed_path);
    }
    let direct_path = installed_root.join(sanitize_plugin_id(plugin_id));
    if inside_root(&direct_path) && direct_path.exists() {
        return Some(direct_path);
    }
    if let Ok(entries) = std::fs::read_dir(installed_root) {
        for entry in entries.flatten() {
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if !is_dir {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == plugin_id
                || name.starts_with(&format!("{plugin_id}@"))
                || name.starts_with(&format!("{hashed_name}@"))
            {
                return Some(installed_root.join(&name));
            }
        }
    }
    None
}

/// MIME for a served plugin file: the explicit module types the loader
/// depends on, then the sidecar's `getFileMimeType` table.
fn plugin_content_type(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "wasm" => "application/wasm",
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "weba" => "audio/webm",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
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

    // ---- bbebee-plugin serving (ported from the sidecar suite) ----

    #[test]
    fn plugin_url_parses_all_address_forms() {
        let expected = Some((
            "test-plugin-a".to_string(),
            "dist/index.js".to_string(),
        ));
        assert_eq!(
            parse_plugin_request_url("bbebee-plugin://app/test-plugin-a/dist/index.js"),
            expected
        );
        assert_eq!(
            parse_plugin_request_url("http://bbebee-plugin.localhost/app/test-plugin-a/dist/index.js"),
            expected
        );
        assert_eq!(
            parse_plugin_request_url("bbebee-plugin://test-plugin-a/dist/index.js"),
            expected
        );
        assert_eq!(
            parse_plugin_request_url("bbebee-plugin://app/test-plugin-a"),
            Some(("test-plugin-a".to_string(), "index.js".to_string()))
        );
        // The wry-folded form: on WebView2 the handler receives the
        // page's http://bbebee-plugin.localhost URL folded back to
        // bbebee-plugin://localhost with the path untouched — the id
        // is the segment after `app`, never the host.
        assert_eq!(
            parse_plugin_request_url(
                "bbebee-plugin://localhost/app/test-plugin-a/dist/index.js"
            ),
            expected
        );
        assert_eq!(
            parse_plugin_request_url("bbebee-plugin://localhost/test-plugin-a/dist/index.js"),
            expected
        );
    }

    #[test]
    fn plugin_url_rejects_unsafe_ids() {
        // ".." as the id, both raw and percent-encoded, and "." too.
        assert_eq!(parse_plugin_request_url("bbebee-plugin://../userdata-marker.txt"), None);
        assert_eq!(
            parse_plugin_request_url("http://bbebee-plugin.localhost/app/%2e%2e/secret.js"),
            None
        );
        assert_eq!(parse_plugin_request_url("bbebee-plugin://app/a\\b/index.js"), None);
        // The folded form judges the decoded id the same way.
        assert_eq!(
            parse_plugin_request_url("bbebee-plugin://localhost/app/a%5cb/index.js"),
            None
        );
        assert_eq!(parse_plugin_request_url("bbebee-plugin://localhost"), None);
        assert_eq!(parse_plugin_request_url("bbebee-plugin://./secret.js"), None);
        // The localhost form without the app segment is not a plugin URL.
        assert_eq!(
            parse_plugin_request_url("http://bbebee-plugin.localhost/etc/passwd"),
            None
        );
    }

    #[test]
    fn plugin_url_normalizes_dot_segments_like_a_url_parser() {
        // WHATWG parsing resolves these before the plugin parser runs:
        // `/app/a/../b/index.js` is simply plugin `b`, and `/app/./x`
        // drops the `.` — neither is a traversal by the time it lands.
        assert_eq!(
            parse_plugin_request_url("bbebee-plugin://app/a/../b/index.js"),
            Some(("b".to_string(), "index.js".to_string()))
        );
        assert_eq!(
            parse_plugin_request_url("bbebee-plugin://app/%2e%2e/b/index.js"),
            Some(("b".to_string(), "index.js".to_string()))
        );
    }

    #[test]
    fn plugin_dir_name_matches_protocol() {
        // Reference values from @BBeBee/protocol's pluginDirName/shortHash.
        assert_eq!(plugin_short_hash("bbebee-plugin-catppuccin-theme"), "52ece0ddc3d73640");
        assert_eq!(
            plugin_dir_name("bbebee-plugin-catppuccin-theme"),
            "bbebee-plugin-catppuccin-theme-52ece0ddc3d73640"
        );
        assert_eq!(
            plugin_dir_name("@scope/my-plugin"),
            "scope_my-plugin-afaca104c7f5dae9"
        );
        assert_eq!(
            plugin_dir_name("test-plugin-a"),
            "test-plugin-a-62c71f5931d8d78f"
        );
    }

    fn plugin_fixture() -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::TempDir::new().unwrap();
        let root = tmp.path().join("installed-plugins");
        // Hashed-dir layout, as writePluginFilesAtomic names it for new
        // installs of scoped/renamed ids — plus the exact-name layout.
        let hashed = root.join(plugin_dir_name("test-plugin-a"));
        std::fs::create_dir_all(hashed.join("dist")).unwrap();
        std::fs::write(hashed.join("dist/index.js"), "export default 'a'").unwrap();
        let exact = root.join("test-plugin-b");
        std::fs::create_dir_all(&exact).unwrap();
        std::fs::write(exact.join("secret.js"), "export default 'b'").unwrap();
        (tmp, root)
    }

    #[test]
    fn plugin_serving_reads_installed_files() {
        let (_tmp, root) = plugin_fixture();
        let res = serve_plugin_file(&root, "bbebee-plugin://app/test-plugin-a/dist/index.js");
        assert_eq!(res.status(), tauri::http::StatusCode::OK);
        assert_eq!(
            res.headers().get("content-type").unwrap(),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(res.body().as_ref(), b"export default 'a'");

        // The exact-name layout serves too.
        let res = serve_plugin_file(&root, "bbebee-plugin://app/test-plugin-b/secret.js");
        assert_eq!(res.status(), tauri::http::StatusCode::OK);
        assert_eq!(res.body().as_ref(), b"export default 'b'");

        // The Windows host form serves identically.
        let res = serve_plugin_file(
            &root,
            "http://bbebee-plugin.localhost/app/test-plugin-a/dist/index.js",
        );
        assert_eq!(res.status(), tauri::http::StatusCode::OK);
        assert_eq!(res.body().as_ref(), b"export default 'a'");

        // And so does the form wry actually delivers on WebView2:
        // bbebee-plugin://localhost with the path unchanged.
        let res = serve_plugin_file(
            &root,
            "bbebee-plugin://localhost/app/test-plugin-a/dist/index.js",
        );
        assert_eq!(res.status(), tauri::http::StatusCode::OK);
        assert_eq!(res.body().as_ref(), b"export default 'a'");
    }

    #[test]
    fn plugin_serving_confines_to_the_plugin_dir() {
        let (_tmp, root) = plugin_fixture();
        // A sibling plugin's file is not reachable through an encoded
        // traversal subpath (the encoded slash keeps it one inert
        // segment, which names no real file).
        let res = serve_plugin_file(
            &root,
            "bbebee-plugin://app/test-plugin-a/%2e%2e%2ftest-plugin-b/secret.js",
        );
        assert_ne!(res.status(), tauri::http::StatusCode::OK);
        // ".." as the id is refused before any directory resolution.
        let res = serve_plugin_file(&root, "bbebee-plugin://../test-plugin-b/secret.js");
        assert_ne!(res.status(), tauri::http::StatusCode::OK);
    }

    #[test]
    fn plugin_serving_404s_for_missing_plugin_and_file() {
        let (_tmp, root) = plugin_fixture();
        let res = serve_plugin_file(&root, "bbebee-plugin://app/not-installed/dist/index.js");
        assert_eq!(res.status(), tauri::http::StatusCode::NOT_FOUND);
        let res = serve_plugin_file(&root, "bbebee-plugin://app/test-plugin-a/dist/missing.js");
        assert_eq!(res.status(), tauri::http::StatusCode::NOT_FOUND);
    }

    #[test]
    fn plugin_scoped_ids_resolve() {
        let tmp = tempfile::TempDir::new().unwrap();
        let root = tmp.path().join("installed-plugins");
        let dir = root.join(plugin_dir_name("@scope/my-plugin"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.js"), "export default 's'").unwrap();
        let res = serve_plugin_file(&root, "bbebee-plugin://app/%40scope%2Fmy-plugin/index.js");
        assert_eq!(res.status(), tauri::http::StatusCode::OK);
        assert_eq!(res.body().as_ref(), b"export default 's'");
    }
}
