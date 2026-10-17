// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};

use desktop_tauri_lib::commands::*;
use desktop_tauri_lib::mini_player_manager;
use desktop_tauri_lib::state::{AppState, Position};
use desktop_tauri_lib::tray;
use desktop_tauri_lib::window_policy::{should_hide_on_close, CloseContext};

fn main() {
    let app_state = AppState::default();

    tauri::Builder::default()
        .manage(app_state)
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.unminimize();
                let _ = main.set_focus();
            }
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
        .setup(|app| {
            tray::setup_tray(app.handle())?;

            let sidecar = std::sync::Arc::new(desktop_tauri_lib::sidecar::SidecarManager::new(Some(
                app.handle().clone(),
            )));
            let state = app.state::<AppState>();
            state.set_sidecar(sidecar.clone());
            let sidecar_clone = sidecar.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = sidecar_clone.start().await {
                    eprintln!("[desktop-tauri:WARN] Failed to start sidecar: {}", e);
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if window.label() == "main" {
                    let app = window.app_handle();
                    let state = app.state::<AppState>();
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
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        if !state.is_quitting() {
                            state.set_quitting(true);
                        }
                        app.exit(0);
                    }
                } else if window.label() == "mini-player" {
                    api.prevent_close();
                    let _ = window.hide();
                    let app = window.app_handle();
                    let state = app.state::<AppState>();
                    *state.mini_player_window_state.lock().unwrap() = "hidden".to_string();
                    mini_player_manager::notify_mini_player_state(app, &state);
                } else if window.label() == "desktop-lyrics" {
                    api.prevent_close();
                    let _ = window.hide();
                    let app = window.app_handle();
                    let state = app.state::<AppState>();
                    state.lyric_window_visible.store(false, Ordering::SeqCst);
                }
            }
            tauri::WindowEvent::Moved(_) => {
                if window.label() == "mini-player" {
                    let app = window.app_handle();
                    let state = app.state::<AppState>();
                    mini_player_manager::handle_mini_player_moved(app, &state);
                } else if window.label() == "desktop-lyrics" {
                    let app = window.app_handle();
                    let state = app.state::<AppState>();
                    if !state.lyric_programmatic_move.load(Ordering::SeqCst) {
                        if let Ok(pos) = window.outer_position() {
                            let scale = window.scale_factor().unwrap_or(1.0);
                            let x = (pos.x as f64 / scale).round() as i32;
                            let y = (pos.y as f64 / scale).round() as i32;
                            let handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                                let s = handle.state::<AppState>();
                                if !s.lyric_programmatic_move.load(Ordering::SeqCst) {
                                    if let Some(main) = handle.get_webview_window("main") {
                                        let _ =
                                            main.emit("desktop-lyrics:moved", Position { x, y });
                                    }
                                }
                            });
                        }
                    }
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            // Window commands
            window_minimize,
            desktop_window_minimize,
            window_maximize,
            desktop_window_maximize,
            window_close,
            desktop_window_close,
            window_is_maximized,
            desktop_window_is_maximized,
            window_set_close_to_tray,
            desktop_window_set_close_to_tray,
            window_toggle,
            desktop_window_toggle,
            // Desktop Lyrics commands
            desktop_lyrics_set_visible,
            desktop_lyrics_set_position,
            desktop_lyrics_get_position,
            desktop_lyrics_commit_position,
            desktop_lyrics_get_data,
            desktop_lyrics_set_locked,
            desktop_lyrics_set_ignore_mouse,
            desktop_lyrics_update_data,
            desktop_lyrics_send_action,
            // Mini Player commands
            mini_player_open,
            desktop_mini_player_open,
            mini_player_close,
            desktop_mini_player_close,
            mini_player_restore_main,
            desktop_mini_player_restore_main,
            mini_player_set_mode,
            desktop_mini_player_set_mode,
            mini_player_get_state,
            desktop_mini_player_get_state,
            mini_player_get_data,
            desktop_mini_player_get_data,
            mini_player_update_data,
            desktop_mini_player_update_data,
            mini_player_send_action,
            desktop_mini_player_send_action,
            // Locale commands
            locale_get,
            desktop_locale_get,
            locale_notify,
            desktop_locale_notify,
            // Taskbar commands
            taskbar_update,
            desktop_taskbar_update,
            // Bridge commands
            bridge_call,
            desktop_bridge_call,
            bridge_stream_open,
            bridge_stream_pull,
            bridge_stream_close,
            bridge_http_open,
            bridge_http_pull,
            bridge_http_close,
            bridge_tx_begin,
            bridge_tx_end,
            desktop_audio_transcode,
            desktop_audio_transcode_cancel,
            // Paths & App Version
            paths_get,
            desktop_paths_get,
            app_version,
            desktop_app_version,
            // Secrets
            secrets_available,
            desktop_secrets_available,
            secrets_encrypt,
            desktop_secrets_encrypt,
            secrets_decrypt,
            desktop_secrets_decrypt,
            // Shell
            shell_open_external,
            desktop_shell_open_external,
            shell_open_path,
            desktop_shell_open_path,
            // Dialogs & Files
            dialog_pick_directory,
            desktop_dialog_pick_directory,
            dialog_pick_files,
            desktop_dialog_pick_files,
            files_authorize,
            desktop_files_authorize,
            // DevTools
            devtools_open,
            desktop_devtools_open,
            // Plugins
            plugins_list_installed,
            desktop_plugins_list_installed,
            plugins_get_lock,
            desktop_plugins_get_lock,
            plugins_install,
            desktop_plugins_install,
            plugins_uninstall,
            desktop_plugins_uninstall,
            // Proxy & Stream
            proxy_test,
            desktop_proxy_test,
            proxy_set,
            desktop_proxy_set,
            stream_set_headers,
            desktop_stream_set_headers,
            // Sandbox
            sandbox_set_html,
            desktop_sandbox_set_html,
            // Screen
            screen_get_primary_monitor,
            desktop_screen_get_primary_monitor,
            screen_get_all_monitors,
            desktop_screen_get_all_monitors,
            screen_get_cursor_position,
            desktop_screen_get_cursor_position,
            // Power
            power_block_sleep,
            desktop_power_block_sleep,
            power_unblock_sleep,
            desktop_power_unblock_sleep,
            power_is_sleep_blocked,
            desktop_power_is_sleep_blocked,
            power_simulate_suspend,
            desktop_power_simulate_suspend,
            // System
            system_register_media_key,
            desktop_system_register_media_key,
            system_register_hotkey,
            desktop_system_register_hotkey,
            system_unregister_all_hotkeys,
            desktop_system_unregister_all_hotkeys,
            system_media_session_update,
            desktop_system_media_session_update,
            system_media_session_set_playback_state,
            desktop_system_media_session_set_playback_state,
            system_media_session_set_position,
            desktop_system_media_session_set_position,
            system_power_save_blocker,
            desktop_system_power_save_blocker,
            system_emit_event,
            desktop_system_emit_event,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
