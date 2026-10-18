//! Tauri command handlers for Window management, Desktop Lyrics, Mini Player, and Locale.

use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};

use crate::lyrics_manager::{
    clamp_to_visible_screen, get_or_create_lyric_window, set_lyric_window_position,
    start_lyric_cursor_tracking, DEFAULT_LYRIC_HEIGHT, DEFAULT_LYRIC_WIDTH,
};
use crate::mini_player_manager::{
    apply_mode_bounds, get_or_create_mini_player_window, get_service_state,
    notify_mini_player_state,
};
use crate::state::{AppState, MiniPlayerOpenOptions, MiniPlayerServiceState, Position, TaskbarState};
use crate::tray::{toggle_main_window, update_tray_menu};
use crate::window_policy::{should_hide_on_close, CloseContext};

// =============================================================================
// Window Commands
// =============================================================================

#[tauri::command]
pub fn window_minimize(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn desktop_window_minimize(window: tauri::WebviewWindow) -> Result<(), String> {
    window_minimize(window)
}

#[tauri::command]
pub fn window_maximize(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn desktop_window_maximize(window: tauri::WebviewWindow) -> Result<(), String> {
    window_maximize(window)
}

#[tauri::command]
pub fn window_close(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let platform = if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    };

    let ctx = CloseContext::new(
        state.is_quitting(),
        app.tray_by_id("main-tray").is_some(),
        platform,
        Some(state.is_close_to_tray()),
    );

    if should_hide_on_close(&ctx) {
        window.hide().map_err(|e| e.to_string())
    } else {
        if !state.is_quitting() {
            state.set_quitting(true);
        }
        app.exit(0);
        Ok(())
    }
}

#[tauri::command]
pub fn desktop_window_close(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    window_close(app, window, state)
}

#[tauri::command]
pub fn window_is_maximized(window: tauri::WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn desktop_window_is_maximized(window: tauri::WebviewWindow) -> Result<bool, String> {
    window_is_maximized(window)
}

#[tauri::command]
pub fn window_set_close_to_tray(
    state: tauri::State<AppState>,
    enabled: bool,
) -> Result<(), String> {
    state.set_close_to_tray(enabled);
    Ok(())
}

#[tauri::command]
pub fn desktop_window_set_close_to_tray(
    state: tauri::State<AppState>,
    enabled: bool,
) -> Result<(), String> {
    window_set_close_to_tray(state, enabled)
}

#[tauri::command]
pub fn window_toggle(app: tauri::AppHandle) -> Result<(), String> {
    toggle_main_window(&app);
    Ok(())
}

#[tauri::command]
pub fn desktop_window_toggle(app: tauri::AppHandle) -> Result<(), String> {
    window_toggle(app)
}

// =============================================================================
// Desktop Lyrics Commands
// =============================================================================

#[tauri::command]
pub fn desktop_lyrics_set_visible(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    visible: bool,
    position: Option<Position>,
) -> Result<(), String> {
    state
        .lyric_window_visible
        .store(visible, Ordering::SeqCst);

    if visible {
        let win = get_or_create_lyric_window(&app, position)?;
        if let Some(pos) = position {
            let clamped =
                clamp_to_visible_screen(&app, pos, DEFAULT_LYRIC_WIDTH, DEFAULT_LYRIC_HEIGHT);
            let _ = set_lyric_window_position(&app, &win, &state, clamped.x, clamped.y);
        }
        let _ = win.show();
        if let Some(data) = state.latest_lyric_data.lock().unwrap().as_ref() {
            let _ = win.emit("desktop-lyrics:data", data);
        }
    } else if let Some(win) = app.get_webview_window("desktop-lyrics") {
        let _ = win.hide();
    }

    if visible && state.lyric_window_locked.load(Ordering::SeqCst) {
        start_lyric_cursor_tracking(&app);
    }

    Ok(())
}

#[tauri::command]
pub fn desktop_lyrics_set_position(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    position: Position,
) -> Result<(), String> {
    let clamped =
        clamp_to_visible_screen(&app, position, DEFAULT_LYRIC_WIDTH, DEFAULT_LYRIC_HEIGHT);
    let win = get_or_create_lyric_window(&app, Some(clamped))?;
    set_lyric_window_position(&app, &win, &state, clamped.x, clamped.y)
}

#[tauri::command]
pub fn desktop_lyrics_get_position(
    app: tauri::AppHandle,
) -> Result<Option<Position>, String> {
    if let Some(win) = app.get_webview_window("desktop-lyrics") {
        let scale = win.scale_factor().unwrap_or(1.0);
        let pos = win.outer_position().map_err(|e| e.to_string())?;
        Ok(Some(Position {
            x: (pos.x as f64 / scale).round() as i32,
            y: (pos.y as f64 / scale).round() as i32,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn desktop_lyrics_commit_position(
    app: tauri::AppHandle,
    position: Position,
) -> Result<(), String> {
    let clamped =
        clamp_to_visible_screen(&app, position, DEFAULT_LYRIC_WIDTH, DEFAULT_LYRIC_HEIGHT);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("desktop-lyrics:moved", clamped);
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_lyrics_get_data(
    state: tauri::State<AppState>,
) -> Result<Option<serde_json::Value>, String> {
    Ok(state.latest_lyric_data.lock().unwrap().clone())
}

#[tauri::command]
pub fn desktop_lyrics_set_locked(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    locked: bool,
) -> Result<(), String> {
    state.lyric_window_locked.store(locked, Ordering::SeqCst);
    if let Some(win) = app.get_webview_window("desktop-lyrics") {
        let _ = win.set_ignore_cursor_events(locked);
    }
    if locked && state.lyric_window_visible.load(Ordering::SeqCst) {
        start_lyric_cursor_tracking(&app);
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_lyrics_set_ignore_mouse(
    app: tauri::AppHandle,
    ignore: bool,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("desktop-lyrics") {
        let _ = win.set_ignore_cursor_events(ignore);
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_lyrics_update_data(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    data: serde_json::Value,
) -> Result<(), String> {
    *state.latest_lyric_data.lock().unwrap() = Some(data.clone());
    if let Some(win) = app.get_webview_window("desktop-lyrics") {
        let _ = win.emit("desktop-lyrics:data", data);
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_lyrics_send_action(
    app: tauri::AppHandle,
    action: serde_json::Value,
) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("desktop-lyrics:action", action);
    }
    Ok(())
}

// =============================================================================
// Mini Player Commands
// =============================================================================

#[tauri::command]
pub fn mini_player_open(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    options: Option<MiniPlayerOpenOptions>,
) -> Result<(), String> {
    if let Some(opts) = options {
        if let Some(m) = opts.mode {
            *state.mini_player_mode.lock().unwrap() = m;
        }
    }

    let mode = state.mini_player_mode.lock().unwrap().clone();
    let win = get_or_create_mini_player_window(&app, &state)?;
    apply_mode_bounds(&app, &state, &mode)?;
    let _ = win.show();
    let _ = win.set_focus();

    if let Some(data) = state.latest_mini_player_data.lock().unwrap().as_ref() {
        let _ = win.emit("mini-player:data", data);
    }
    notify_mini_player_state(&app, &state);

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.minimize();
    }

    Ok(())
}

#[tauri::command]
pub fn desktop_mini_player_open(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    options: Option<MiniPlayerOpenOptions>,
) -> Result<(), String> {
    mini_player_open(app, state, options)
}

#[tauri::command]
pub fn mini_player_close(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("mini-player") {
        let _ = win.hide();
    }
    *state.mini_player_window_state.lock().unwrap() = "hidden".to_string();
    notify_mini_player_state(&app, &state);

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_mini_player_close(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    mini_player_close(app, state)
}

#[tauri::command]
pub fn mini_player_restore_main(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_mini_player_restore_main(app: tauri::AppHandle) -> Result<(), String> {
    mini_player_restore_main(app)
}

#[tauri::command]
pub fn mini_player_set_mode(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    mode: String,
) -> Result<(), String> {
    *state.mini_player_mode.lock().unwrap() = mode.clone();
    apply_mode_bounds(&app, &state, &mode)?;
    notify_mini_player_state(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn desktop_mini_player_set_mode(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    mode: String,
) -> Result<(), String> {
    mini_player_set_mode(app, state, mode)
}

#[tauri::command]
pub fn mini_player_get_state(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<MiniPlayerServiceState, String> {
    Ok(get_service_state(&app, &state))
}

#[tauri::command]
pub fn desktop_mini_player_get_state(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<MiniPlayerServiceState, String> {
    mini_player_get_state(app, state)
}

#[tauri::command]
pub fn mini_player_get_data(
    state: tauri::State<AppState>,
) -> Result<Option<serde_json::Value>, String> {
    Ok(state.latest_mini_player_data.lock().unwrap().clone())
}

#[tauri::command]
pub fn desktop_mini_player_get_data(
    state: tauri::State<AppState>,
) -> Result<Option<serde_json::Value>, String> {
    mini_player_get_data(state)
}

#[tauri::command]
pub fn mini_player_update_data(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    data: serde_json::Value,
) -> Result<(), String> {
    *state.latest_mini_player_data.lock().unwrap() = Some(data.clone());
    if let Some(win) = app.get_webview_window("mini-player") {
        let _ = win.emit("mini-player:data", data);
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_mini_player_update_data(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    data: serde_json::Value,
) -> Result<(), String> {
    mini_player_update_data(app, state, data)
}

#[tauri::command]
pub fn mini_player_send_action(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    action: serde_json::Value,
) -> Result<(), String> {
    if let Some(action_type) = action.get("type").and_then(|v| v.as_str()) {
        match action_type {
            "restoreMain" => return mini_player_restore_main(app),
            "close" => return mini_player_close(app, state),
            "setMode" => {
                if let Some(mode) = action.get("mode").and_then(|v| v.as_str()) {
                    return mini_player_set_mode(app, state, mode.to_string());
                }
            }
            _ => {}
        }
    }

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("mini-player:action", action);
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_mini_player_send_action(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    action: serde_json::Value,
) -> Result<(), String> {
    mini_player_send_action(app, state, action)
}

// =============================================================================
// Locale Commands
// =============================================================================

#[tauri::command]
pub fn locale_get(state: tauri::State<AppState>) -> Result<String, String> {
    Ok(state.get_locale())
}

#[tauri::command]
pub fn desktop_locale_get(state: tauri::State<AppState>) -> Result<String, String> {
    locale_get(state)
}

#[tauri::command]
pub fn locale_notify(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    locale: String,
) -> Result<(), String> {
    if locale.is_empty() || locale == state.get_locale() {
        return Ok(());
    }
    state.set_locale(locale.clone());
    let _ = app.emit("locale:changed", &locale);
    let _ = update_tray_menu(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn desktop_locale_notify(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    locale: String,
) -> Result<(), String> {
    locale_notify(app, state, locale)
}

// =============================================================================
// Taskbar Update Command
// =============================================================================

#[tauri::command]
pub fn taskbar_update(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    taskbar: TaskbarState,
) -> Result<(), String> {
    *state.taskbar_state.lock().unwrap() = taskbar;
    let _ = update_tray_menu(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn desktop_taskbar_update(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    taskbar: TaskbarState,
) -> Result<(), String> {
    taskbar_update(app, state, taskbar)
}

// =============================================================================
// Core Desktop Bridge Commands (Rust <-> Node Sidecar Transport)
// =============================================================================

#[tauri::command]
pub async fn bridge_call(
    state: tauri::State<'_, AppState>,
    service: String,
    method: String,
    args: Vec<serde_json::Value>,
    token: Option<String>,
) -> Result<serde_json::Value, String> {
    let sidecar = state.get_sidecar()?;
    sidecar
        .call(
            "BBeBee:call",
            serde_json::json!([service, method, args, token]),
        )
        .await
}

#[tauri::command]
pub async fn desktop_bridge_call(
    state: tauri::State<'_, AppState>,
    service: String,
    method: String,
    args: Vec<serde_json::Value>,
    token: Option<String>,
) -> Result<serde_json::Value, String> {
    bridge_call(state, service, method, args, token).await
}

#[tauri::command]
pub async fn bridge_stream_open(
    state: tauri::State<'_, AppState>,
    uri: String,
    range: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let sidecar = state.get_sidecar()?;
    sidecar
        .call("BBeBee:stream:open", serde_json::json!([uri, range]))
        .await
}

#[tauri::command]
pub async fn bridge_stream_pull(
    state: tauri::State<'_, AppState>,
    handle: u32,
) -> Result<serde_json::Value, String> {
    let sidecar = state.get_sidecar()?;
    sidecar
        .call("BBeBee:stream:pull", serde_json::json!([handle]))
        .await
}

#[tauri::command]
pub async fn bridge_stream_close(
    state: tauri::State<'_, AppState>,
    handle: u32,
) -> Result<serde_json::Value, String> {
    let sidecar = state.get_sidecar()?;
    sidecar
        .call("BBeBee:stream:close", serde_json::json!([handle]))
        .await
}

#[tauri::command]
pub async fn bridge_http_open(
    state: tauri::State<'_, AppState>,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let sidecar = state.get_sidecar()?;
    sidecar
        .call("BBeBee:http:open", serde_json::json!([request]))
        .await
}

#[tauri::command]
pub async fn bridge_http_pull(
    state: tauri::State<'_, AppState>,
    handle: u32,
) -> Result<serde_json::Value, String> {
    let sidecar = state.get_sidecar()?;
    sidecar
        .call("BBeBee:http:pull", serde_json::json!([handle]))
        .await
}

#[tauri::command]
pub async fn bridge_http_close(
    state: tauri::State<'_, AppState>,
    handle: u32,
) -> Result<serde_json::Value, String> {
    let sidecar = state.get_sidecar()?;
    sidecar
        .call("BBeBee:http:close", serde_json::json!([handle]))
        .await
}

#[tauri::command]
pub async fn bridge_tx_begin(
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let sidecar = state.get_sidecar()?;
    sidecar.call("BBeBee:tx:begin", serde_json::json!([])).await
}

#[tauri::command]
pub async fn bridge_tx_end(
    state: tauri::State<'_, AppState>,
    token: String,
    commit: bool,
) -> Result<serde_json::Value, String> {
    let sidecar = state.get_sidecar()?;
    sidecar
        .call("BBeBee:tx:end", serde_json::json!([token, commit]))
        .await
}

// =============================================================================
// Audio Transcode Commands
// =============================================================================

#[tauri::command]
pub async fn desktop_audio_transcode(
    state: tauri::State<'_, AppState>,
    options: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let sidecar = state.get_sidecar()?;
    sidecar
        .call("audio:transcode", serde_json::json!([options]))
        .await
}

#[tauri::command]
pub async fn desktop_audio_transcode_cancel(
    state: tauri::State<'_, AppState>,
    job_id: String,
) -> Result<serde_json::Value, String> {
    let sidecar = state.get_sidecar()?;
    sidecar
        .call("audio:transcode-cancel", serde_json::json!([job_id]))
        .await
}

// =============================================================================
// Paths & App Version
// =============================================================================

#[tauri::command]
pub async fn paths_get(
    state: tauri::State<'_, AppState>,
    kind: String,
) -> Result<Option<String>, String> {
    let sidecar = state.get_sidecar()?;
    match sidecar.call("paths:get", serde_json::json!([kind])).await {
        Ok(v) => Ok(v.as_str().map(|s| s.to_string())),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub async fn desktop_paths_get(
    state: tauri::State<'_, AppState>,
    kind: String,
) -> Result<Option<String>, String> {
    paths_get(state, kind).await
}

#[tauri::command]
pub fn app_version(app: tauri::AppHandle) -> Result<String, String> {
    Ok(app.package_info().version.to_string())
}

#[tauri::command]
pub fn desktop_app_version(app: tauri::AppHandle) -> Result<String, String> {
    app_version(app)
}

// =============================================================================
// Secrets (OS Keychain & AES-256-GCM Storage)
// =============================================================================

#[tauri::command]
pub fn secrets_available() -> Result<bool, String> {
    Ok(crate::secrets::is_available())
}

#[tauri::command]
pub fn desktop_secrets_available() -> Result<bool, String> {
    secrets_available()
}

#[tauri::command]
pub fn secrets_encrypt(plain: String) -> Result<String, String> {
    crate::secrets::encrypt(&plain)
}

#[tauri::command]
pub fn desktop_secrets_encrypt(plain: String) -> Result<String, String> {
    secrets_encrypt(plain)
}

#[tauri::command]
pub fn secrets_decrypt(cipher: String) -> Result<String, String> {
    crate::secrets::decrypt(&cipher)
}

#[tauri::command]
pub fn desktop_secrets_decrypt(cipher: String) -> Result<String, String> {
    secrets_decrypt(cipher)
}


// =============================================================================
// Shell & OS Operations
// =============================================================================

#[tauri::command]
pub fn shell_open_external(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(format!("refusing to open non-web url: {}", url));
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd").args(["/C", "start", "", &url]).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&url).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_shell_open_external(url: String) -> Result<(), String> {
    shell_open_external(url)
}

#[tauri::command]
pub fn shell_open_path(path: String) -> Result<String, String> {
    if !path.is_empty() {
        let p = std::path::Path::new(&path);
        if !p.exists() {
            let _ = std::fs::create_dir_all(p);
        }
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(&path).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&path).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&path).spawn();
    }
    Ok("".to_string())
}

#[tauri::command]
pub fn desktop_shell_open_path(path: String) -> Result<String, String> {
    shell_open_path(path)
}

// =============================================================================
// Dialogs & Files Authorization
// =============================================================================

#[tauri::command]
pub async fn dialog_pick_directory(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, String> {
    if let Ok(mock) = std::env::var("BBEBEE_MOCK_PICKED_DIR") {
        if !mock.is_empty() {
            let _ = files_authorize(state, mock.clone()).await;
            return Ok(Some(mock));
        }
    }
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file();
    if let Some(window) = app.get_webview_window("main") {
        builder = builder.set_parent(&window);
    }
    builder.pick_folder(move |path| {
        let _ = tx.send(path.map(|f| f.to_string()));
    });

    let result = rx.await.map_err(|e| e.to_string())?;

    if let Some(ref path) = result {
        let _ = files_authorize(state, path.clone()).await;
    }
    Ok(result)
}

#[tauri::command]
pub async fn desktop_dialog_pick_directory(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, String> {
    dialog_pick_directory(app, state).await
}

#[tauri::command]
pub async fn dialog_pick_files(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    _options: Option<serde_json::Value>,
) -> Result<Vec<String>, String> {
    if let Ok(mock) = std::env::var("BBEBEE_MOCK_PICKED_FILES") {
        if !mock.is_empty() {
            let files: Vec<String> = mock.split(';').map(|s| s.to_string()).collect();
            for f in &files {
                let _ = files_authorize(state.clone(), f.clone()).await;
            }
            return Ok(files);
        }
    }
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file();
    if let Some(window) = app.get_webview_window("main") {
        builder = builder.set_parent(&window);
    }
    builder.pick_files(move |paths| {
        let files = paths
            .unwrap_or_default()
            .into_iter()
            .map(|f| f.to_string())
            .collect::<Vec<_>>();
        let _ = tx.send(files);
    });

    let files = rx.await.map_err(|e| e.to_string())?;

    for f in &files {
        let _ = files_authorize(state.clone(), f.clone()).await;
    }
    Ok(files)
}

#[tauri::command]
pub async fn desktop_dialog_pick_files(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    options: Option<serde_json::Value>,
) -> Result<Vec<String>, String> {
    dialog_pick_files(app, state, options).await
}

#[tauri::command]
pub async fn files_authorize(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<bool, String> {
    let sidecar = state.get_sidecar()?;
    match sidecar.call("files:authorize", serde_json::json!([path])).await {
        Ok(v) => Ok(v.as_bool().unwrap_or(true)),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn desktop_files_authorize(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<bool, String> {
    files_authorize(state, path).await
}

// =============================================================================
// DevTools
// =============================================================================

#[tauri::command]
pub fn devtools_open(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        window.open_devtools();
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = window;
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_devtools_open(window: tauri::WebviewWindow) -> Result<(), String> {
    devtools_open(window)
}

// =============================================================================
// Plugins Disk Management
// =============================================================================

#[tauri::command]
pub async fn plugins_list_installed(
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let sidecar = state.get_sidecar()?;
    sidecar.call("plugins:list-installed", serde_json::json!([])).await
}

#[tauri::command]
pub async fn desktop_plugins_list_installed(
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    plugins_list_installed(state).await
}

#[tauri::command]
pub async fn plugins_get_lock(
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let sidecar = state.get_sidecar()?;
    sidecar.call("plugins:get-lock", serde_json::json!([])).await
}

#[tauri::command]
pub async fn desktop_plugins_get_lock(
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    plugins_get_lock(state).await
}

#[tauri::command]
pub async fn plugins_install(
    state: tauri::State<'_, AppState>,
    plugin_id: String,
    files: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let sidecar = state.get_sidecar()?;
    sidecar
        .call("plugins:install", serde_json::json!([plugin_id, files]))
        .await
}

#[tauri::command]
pub async fn desktop_plugins_install(
    state: tauri::State<'_, AppState>,
    plugin_id: String,
    files: serde_json::Value,
) -> Result<serde_json::Value, String> {
    plugins_install(state, plugin_id, files).await
}

#[tauri::command]
pub async fn plugins_uninstall(
    state: tauri::State<'_, AppState>,
    plugin_id: String,
) -> Result<serde_json::Value, String> {
    let sidecar = state.get_sidecar()?;
    sidecar
        .call("plugins:uninstall", serde_json::json!([plugin_id]))
        .await
}

#[tauri::command]
pub async fn desktop_plugins_uninstall(
    state: tauri::State<'_, AppState>,
    plugin_id: String,
) -> Result<serde_json::Value, String> {
    plugins_uninstall(state, plugin_id).await
}

// =============================================================================
// Proxy & Stream Headers
// =============================================================================

#[tauri::command]
pub async fn proxy_test(
    state: tauri::State<'_, AppState>,
    config: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let sidecar = state.get_sidecar()?;
    sidecar.call("proxy:test", serde_json::json!([config])).await
}

#[tauri::command]
pub async fn desktop_proxy_test(
    state: tauri::State<'_, AppState>,
    config: serde_json::Value,
) -> Result<serde_json::Value, String> {
    proxy_test(state, config).await
}

#[tauri::command]
pub async fn proxy_set(
    state: tauri::State<'_, AppState>,
    config: serde_json::Value,
) -> Result<(), String> {
    let sidecar = state.get_sidecar()?;
    let _ = sidecar.call("proxy:set", serde_json::json!([config])).await;
    Ok(())
}

#[tauri::command]
pub async fn desktop_proxy_set(
    state: tauri::State<'_, AppState>,
    config: serde_json::Value,
) -> Result<(), String> {
    proxy_set(state, config).await
}

#[tauri::command]
pub async fn stream_set_headers(
    state: tauri::State<'_, AppState>,
    entry: serde_json::Value,
) -> Result<(), String> {
    let sidecar = state.get_sidecar()?;
    let _ = sidecar.call("stream:set-headers", serde_json::json!([entry])).await;
    Ok(())
}

#[tauri::command]
pub async fn desktop_stream_set_headers(
    state: tauri::State<'_, AppState>,
    entry: serde_json::Value,
) -> Result<(), String> {
    stream_set_headers(state, entry).await
}

// =============================================================================
// Sandbox
// =============================================================================

#[tauri::command]
pub async fn sandbox_set_html(
    state: tauri::State<'_, AppState>,
    id: String,
    html: String,
) -> Result<(), String> {
    let sidecar = state.get_sidecar()?;
    let _ = sidecar
        .call("sandbox:set-html", serde_json::json!([{ "id": id, "html": html }]))
        .await;
    Ok(())
}

#[tauri::command]
pub async fn desktop_sandbox_set_html(
    state: tauri::State<'_, AppState>,
    id: String,
    html: String,
) -> Result<(), String> {
    sandbox_set_html(state, id, html).await
}

// =============================================================================
// Screen & Display Geometry (Group 0 OS Service)
// =============================================================================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub name: Option<String>,
    pub position: Position,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

#[tauri::command]
pub fn screen_get_primary_monitor(app: tauri::AppHandle) -> Result<Option<MonitorInfo>, String> {
    if let Ok(Some(m)) = app.primary_monitor() {
        let pos = m.position();
        let size = m.size();
        Ok(Some(MonitorInfo {
            name: m.name().map(|s| s.to_string()),
            position: Position { x: pos.x, y: pos.y },
            width: size.width,
            height: size.height,
            scale_factor: m.scale_factor(),
            is_primary: true,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn desktop_screen_get_primary_monitor(app: tauri::AppHandle) -> Result<Option<MonitorInfo>, String> {
    screen_get_primary_monitor(app)
}

#[tauri::command]
pub fn screen_get_all_monitors(app: tauri::AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let mut out = Vec::new();
    let primary_name = app
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|m| m.name().map(|s| s.to_string()));
    if let Ok(monitors) = app.available_monitors() {
        for m in monitors {
            let pos = m.position();
            let size = m.size();
            let name = m.name().map(|s| s.to_string());
            let is_primary = name.is_some() && name == primary_name;
            out.push(MonitorInfo {
                name,
                position: Position { x: pos.x, y: pos.y },
                width: size.width,
                height: size.height,
                scale_factor: m.scale_factor(),
                is_primary,
            });
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn desktop_screen_get_all_monitors(app: tauri::AppHandle) -> Result<Vec<MonitorInfo>, String> {
    screen_get_all_monitors(app)
}

#[tauri::command]
pub fn screen_get_cursor_position(app: tauri::AppHandle) -> Result<Position, String> {
    if let Ok(pos) = app.cursor_position() {
        return Ok(Position {
            x: pos.x.round() as i32,
            y: pos.y.round() as i32,
        });
    }
    if let Ok(monitors) = app.available_monitors() {
        if let Some(first) = monitors.first() {
            let pos = first.position();
            return Ok(Position {
                x: pos.x,
                y: pos.y,
            });
        }
    }
    Ok(Position { x: 0, y: 0 })
}

#[tauri::command]
pub fn desktop_screen_get_cursor_position(app: tauri::AppHandle) -> Result<Position, String> {
    screen_get_cursor_position(app)
}

// =============================================================================
// Power Management & Sleep Blocker (Group 0 OS Service)
// =============================================================================

#[tauri::command]
pub fn power_block_sleep(
    state: tauri::State<'_, AppState>,
    id: Option<u32>,
    _reason: Option<String>,
) -> Result<u32, String> {
    let lock_id = id.unwrap_or(1);
    state.block_sleep(lock_id);
    Ok(lock_id)
}

#[tauri::command]
pub fn desktop_power_block_sleep(
    state: tauri::State<'_, AppState>,
    id: Option<u32>,
    reason: Option<String>,
) -> Result<u32, String> {
    power_block_sleep(state, id, reason)
}

#[tauri::command]
pub fn power_unblock_sleep(
    state: tauri::State<'_, AppState>,
    id: u32,
) -> Result<(), String> {
    state.unblock_sleep(id);
    Ok(())
}

#[tauri::command]
pub fn desktop_power_unblock_sleep(
    state: tauri::State<'_, AppState>,
    id: u32,
) -> Result<(), String> {
    power_unblock_sleep(state, id)
}

#[tauri::command]
pub fn power_is_sleep_blocked(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    Ok(state.is_sleep_blocked())
}

#[tauri::command]
pub fn desktop_power_is_sleep_blocked(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    power_is_sleep_blocked(state)
}

#[tauri::command]
pub fn power_simulate_suspend(app: tauri::AppHandle) -> Result<(), String> {
    app.emit("BBeBee:event", serde_json::json!({ "topic": "will-suspend" }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn desktop_power_simulate_suspend(app: tauri::AppHandle) -> Result<(), String> {
    power_simulate_suspend(app)
}

// =============================================================================
// System Service Host Commands (Group 0 OS Service)
// =============================================================================

#[tauri::command]
pub fn system_register_media_key(
    state: tauri::State<'_, AppState>,
    _key: Option<String>,
) -> Result<(), String> {
    state.set_media_keys_active(true);
    Ok(())
}

#[tauri::command]
pub fn desktop_system_register_media_key(
    state: tauri::State<'_, AppState>,
    key: Option<String>,
) -> Result<(), String> {
    system_register_media_key(state, key)
}

#[tauri::command]
pub fn system_register_hotkey(
    state: tauri::State<'_, AppState>,
    accelerator: String,
) -> Result<(), String> {
    state.register_hotkey(accelerator);
    Ok(())
}

#[tauri::command]
pub fn desktop_system_register_hotkey(
    state: tauri::State<'_, AppState>,
    accelerator: String,
) -> Result<(), String> {
    system_register_hotkey(state, accelerator)
}

#[tauri::command]
pub fn system_unregister_all_hotkeys(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.unregister_all_hotkeys();
    state.set_media_keys_active(false);
    Ok(())
}

#[tauri::command]
pub fn desktop_system_unregister_all_hotkeys(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    system_unregister_all_hotkeys(state)
}

#[tauri::command]
pub fn system_media_session_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    now_playing: serde_json::Value,
) -> Result<(), String> {
    state.set_now_playing(Some(now_playing.clone()));
    if let Some(tray) = app.tray_by_id("main-tray") {
        let title = now_playing
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or("BBeBee");
        let tooltip = if title.is_empty() || title == "BBeBee" {
            "BBeBee".to_string()
        } else {
            format!("BBeBee — {}", title)
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_system_media_session_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    now_playing: serde_json::Value,
) -> Result<(), String> {
    system_media_session_update(app, state, now_playing)
}

#[tauri::command]
pub fn system_media_session_set_playback_state(
    state: tauri::State<'_, AppState>,
    playback_state: String,
) -> Result<(), String> {
    state.set_playback_state(playback_state);
    Ok(())
}

#[tauri::command]
pub fn desktop_system_media_session_set_playback_state(
    state: tauri::State<'_, AppState>,
    playback_state: String,
) -> Result<(), String> {
    system_media_session_set_playback_state(state, playback_state)
}

#[tauri::command]
pub fn system_media_session_set_position(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    position_ms: Option<f64>,
) -> Result<(), String> {
    if let Some(pos) = position_ms {
        state.set_position_ms(pos);
        let _ = app.emit("media-session:position", pos);
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_system_media_session_set_position(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    position_ms: Option<f64>,
) -> Result<(), String> {
    system_media_session_set_position(app, state, position_ms)
}

#[tauri::command]
pub fn system_power_save_blocker(
    state: tauri::State<'_, AppState>,
    blocker_type: Option<String>,
) -> Result<u32, String> {
    let id = 1;
    let _ = blocker_type;
    state.block_sleep(id);
    Ok(id)
}

#[tauri::command]
pub fn desktop_system_power_save_blocker(
    state: tauri::State<'_, AppState>,
    blocker_type: Option<String>,
) -> Result<u32, String> {
    system_power_save_blocker(state, blocker_type)
}

#[tauri::command]
pub fn system_emit_event(
    app: tauri::AppHandle,
    event: serde_json::Value,
) -> Result<(), String> {
    app.emit("BBeBee:event", event).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn desktop_system_emit_event(
    app: tauri::AppHandle,
    event: serde_json::Value,
) -> Result<(), String> {
    system_emit_event(app, event)
}

// =============================================================================
// Console Forwarding
// =============================================================================

/// Forward a browser console message to the Rust log output.
///
/// The webview's `console` is otherwise invisible in the terminal running
/// `tauri dev` — resource errors like `ERR_UNKNOWN_URL_SCHEME` never reach
/// the Rust logs. The preload shim patches `console.error`/`console.warn`
/// and `window.onerror` to call this, so frontend failures show up alongside
/// backend logs with a `[console]` prefix.
#[tauri::command]
pub fn console_forward(level: String, message: String) -> Result<(), String> {
    // Route through eprintln so it lands in the same stream as the other
    // Rust diagnostics when running `tauri dev`.
    eprintln!("[console][{}] {}", level, message);
    Ok(())
}

#[tauri::command]
pub fn desktop_console_forward(level: String, message: String) -> Result<(), String> {
    console_forward(level, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_open_external_security_check() {
        assert!(shell_open_external("ftp://example.com".to_string()).is_err());
        assert!(shell_open_external("file:///etc/passwd".to_string()).is_err());
        assert!(shell_open_external("javascript:alert(1)".to_string()).is_err());
        assert!(shell_open_external("https://example.com".to_string()).is_ok());
        assert!(shell_open_external("http://localhost:3000".to_string()).is_ok());
    }

    #[test]
    fn test_monitor_info_serialization() {
        let info = MonitorInfo {
            name: Some("PrimaryDisplay".to_string()),
            position: Position { x: 0, y: 0 },
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
            is_primary: true,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"isPrimary\":true"));
        assert!(json.contains("\"width\":1920"));
    }
}



