//! BBeBee desktop host entry point.
//!
//! A thin native host: owns the window, the OS surface, and the sidecar.
//! Contains no business logic — every handler here is mechanical.
//!
//! Structure:
//! - `main()`: builds the Tauri app with plugins, protocol, and commands.
//! - `setup_app()`: tray, sidecar, and initial state.
//! - `on_window_event()`: close/minimize/move policy per window.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use desktop_tauri_lib::commands::*;
use desktop_tauri_lib::error::lock_recover;
use desktop_tauri_lib::mini_player_manager;
use desktop_tauri_lib::state::{AppState, Position};
use desktop_tauri_lib::tray;
use desktop_tauri_lib::window_policy::{should_hide_on_close, CloseContext};

fn main() {
    let app_state = AppState::default();

    tauri::Builder::default()
        .manage(app_state)
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main_window(app);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let shortcut_str = shortcut.to_string();
                        if let Some(main) = app.get_webview_window("main") {
                            let _ = main.emit("global-shortcut:pressed", shortcut_str);
                        }
                    }
                })
                .build(),
        )
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("bbebee-preload")
                .js_init_script(include_str!("shim.js"))
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("bbebee-file", |_ctx, request, responder| {
            desktop_tauri_lib::protocols::handle_bbebee_file_request(request, responder);
        })
        .setup(setup_app)
        .on_window_event(on_window_event)
        .invoke_handler(tauri::generate_handler![
            // Window
            window_minimize, desktop_window_minimize,
            window_maximize, desktop_window_maximize,
            window_close, desktop_window_close,
            window_is_maximized, desktop_window_is_maximized,
            window_set_close_to_tray, desktop_window_set_close_to_tray,
            window_toggle, desktop_window_toggle,
            // Desktop lyrics
            desktop_lyrics_set_visible, desktop_lyrics_set_position,
            desktop_lyrics_get_position, desktop_lyrics_commit_position,
            desktop_lyrics_get_data, desktop_lyrics_set_locked,
            desktop_lyrics_set_ignore_mouse, desktop_lyrics_update_data,
            desktop_lyrics_send_action,
            // Mini player
            mini_player_open, desktop_mini_player_open,
            mini_player_close, desktop_mini_player_close,
            mini_player_restore_main, desktop_mini_player_restore_main,
            mini_player_set_mode, desktop_mini_player_set_mode,
            mini_player_get_state, desktop_mini_player_get_state,
            mini_player_get_data, desktop_mini_player_get_data,
            mini_player_update_data, desktop_mini_player_update_data,
            mini_player_send_action, desktop_mini_player_send_action,
            // Locale
            locale_get, desktop_locale_get,
            locale_notify, desktop_locale_notify,
            // Taskbar
            taskbar_update, desktop_taskbar_update,
            // Bridge
            bridge_call, desktop_bridge_call,
            bridge_stream_open, bridge_stream_pull, bridge_stream_close,
            bridge_http_open, bridge_http_pull, bridge_http_close,
            bridge_tx_begin, bridge_tx_end,
            desktop_audio_transcode, desktop_audio_transcode_cancel,
            // Paths & version
            paths_get, desktop_paths_get,
            app_version, desktop_app_version,
            // Secrets
            secrets_available, desktop_secrets_available,
            secrets_encrypt, desktop_secrets_encrypt,
            secrets_decrypt, desktop_secrets_decrypt,
            // Shell
            shell_open_external, desktop_shell_open_external,
            shell_open_path, desktop_shell_open_path,
            // Dialogs & files
            dialog_pick_directory, desktop_dialog_pick_directory,
            dialog_pick_files, desktop_dialog_pick_files,
            files_authorize, desktop_files_authorize,
            // DevTools
            devtools_open, desktop_devtools_open,
            // Plugins
            plugins_list_installed, desktop_plugins_list_installed,
            plugins_get_lock, desktop_plugins_get_lock,
            plugins_install, desktop_plugins_install,
            plugins_uninstall, desktop_plugins_uninstall,
            // Proxy & stream
            proxy_test, desktop_proxy_test,
            proxy_set, desktop_proxy_set,
            stream_set_headers, desktop_stream_set_headers,
            // Sandbox
            sandbox_set_html, desktop_sandbox_set_html,
            // Screen
            screen_get_primary_monitor, desktop_screen_get_primary_monitor,
            screen_get_all_monitors, desktop_screen_get_all_monitors,
            screen_get_cursor_position, desktop_screen_get_cursor_position,
            // Power
            power_block_sleep, desktop_power_block_sleep,
            power_unblock_sleep, desktop_power_unblock_sleep,
            power_is_sleep_blocked, desktop_power_is_sleep_blocked,
            power_simulate_suspend, desktop_power_simulate_suspend,
            // System
            system_register_media_key, desktop_system_register_media_key,
            system_register_hotkey, desktop_system_register_hotkey,
            system_unregister_all_hotkeys, desktop_system_unregister_all_hotkeys,
            system_media_session_update, desktop_system_media_session_update,
            system_media_session_set_playback_state, desktop_system_media_session_set_playback_state,
            system_media_session_set_position, desktop_system_media_session_set_position,
            system_power_save_blocker, desktop_system_power_save_blocker,
            system_emit_event, desktop_system_emit_event,
            // Console forwarding
            console_forward, desktop_console_forward,
            // Native audio engine (Rust supervisor, P0)
            audio_engine_start, audio_engine_stop,
            audio_engine_load, audio_engine_play, audio_engine_pause,
            audio_engine_stop_playback, audio_engine_seek,
            audio_engine_set_volume, audio_engine_set_muted,
            audio_engine_set_dsp, audio_engine_status,
            // FFmpeg transcoding (Rust manager, P1)
            transcode_run, transcode_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// =============================================================================
// Setup
// =============================================================================

/// Show and focus the main window (single-instance second launch).
fn focus_main_window(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

/// App setup: tray icon, sidecar process, initial state.
fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    tray::setup_tray(app.handle())?;

    // Node sidecar (Core Services host)
    let sidecar = std::sync::Arc::new(desktop_tauri_lib::sidecar::SidecarManager::new(
        Some(app.handle().clone()),
    ));
    app.state::<AppState>().set_sidecar(sidecar.clone());

    tauri::async_runtime::spawn(async move {
        if let Err(e) = sidecar.start().await {
            eprintln!("[main] sidecar failed to start: {e}");
        }
    });

    // Native audio engine (Rust supervisor, P0)
    // Starts lazily on first use; the binary may not be bundled in dev.
    let audio_engine = std::sync::Arc::new(desktop_tauri_lib::audio::AudioEngineSupervisor::new(
        None,
    ));
    app.state::<AppState>().set_audio_engine(audio_engine.clone());

    // Forward engine events to the frontend as Tauri events
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let mut state_rx = audio_engine.subscribe_state();
        while let Ok(event) = state_rx.recv().await {
            let _ = app_handle.emit("audio:state", &event);
        }
    });
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let mut crash_rx = audio_engine.subscribe_crash();
        while let Ok(event) = crash_rx.recv().await {
            let _ = app_handle.emit("audio:crash", &event);
        }
    });

    Ok(())
}

// =============================================================================
// Window events
// =============================================================================

fn on_window_event(window: &WebviewWindow, event: &tauri::WindowEvent) {
    match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            on_close_requested(window, api);
        }
        tauri::WindowEvent::Moved(_) => {
            on_window_moved(window);
        }
        _ => {}
    }
}

/// Close-button policy per window.
fn on_close_requested(window: &WebviewWindow, api: &tauri::window::CloseRequestApi) {
    let app = window.app_handle();
    let state = app.state::<AppState>();

    match window.label() {
        "main" => {
            let ctx = CloseContext::new(
                state.is_quitting(),
                app.tray_by_id("main-tray").is_some(),
                host_platform(),
                Some(state.is_close_to_tray()),
            );
            if should_hide_on_close(&ctx) {
                api.prevent_close();
                let _ = window.hide();
            } else {
                if !state.is_quitting() {
                    state.set_quitting(true);
                }
                app.exit(0);
            }
        }
        "mini-player" => {
            api.prevent_close();
            let _ = window.hide();
            *lock_recover(&state.mini_player_window_state) = "hidden".to_string();
            mini_player_manager::notify_mini_player_state(&app, &state);
        }
        "desktop-lyrics" => {
            api.prevent_close();
            let _ = window.hide();
            state.lyric_window_visible.store(false, Ordering::SeqCst);
        }
        _ => {}
    }
}

/// Window-moved policy: mini-player and lyrics report positions.
fn on_window_moved(window: &WebviewWindow) {
    let app = window.app_handle();
    let state = app.state::<AppState>();

    match window.label() {
        "mini-player" => {
            mini_player_manager::handle_mini_player_moved(&app, &state);
        }
        "desktop-lyrics" => {
            if state.lyric_programmatic_move.load(Ordering::SeqCst) {
                return;
            }
            let Ok(pos) = window.outer_position() else { return };
            let scale = window.scale_factor().unwrap_or(1.0);
            let x = (pos.x as f64 / scale).round() as i32;
            let y = (pos.y as f64 / scale).round() as i32;
            let handle = app.clone();
            // Debounce: the programmatic move that follows a user drag
            // must not echo back as a second user move.
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                let s = handle.state::<AppState>();
                if !s.lyric_programmatic_move.load(Ordering::SeqCst) {
                    if let Some(main) = handle.get_webview_window("main") {
                        let _ = main.emit("desktop-lyrics:moved", Position { x, y });
                    }
                }
            });
        }
        _ => {}
    }
}

/// Platform name as the protocol expects it.
fn host_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}
