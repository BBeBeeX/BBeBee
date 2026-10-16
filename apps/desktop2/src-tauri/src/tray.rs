//! System Tray icon and contextual menu management
//!
//! Provides cross-platform system tray icon, localized contextual controls
//! (Play/Pause, Next, Previous, Show/Hide, Quit), and click interaction.

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

use crate::i18n::get_tray_i18n;
use crate::state::{AppState, TaskbarState};

pub fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) && !win.is_minimized().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
    }
}

pub fn create_tray_menu(
    app: &tauri::AppHandle,
    locale: &str,
    taskbar: &TaskbarState,
) -> Result<tauri::menu::Menu<tauri::Wry>, tauri::Error> {
    let i18n = get_tray_i18n(locale);
    let play_label = if taskbar.is_playing {
        i18n.pause
    } else {
        i18n.play
    };

    let can_play = taskbar.can_play_or_pause.unwrap_or(true);
    let can_prev = taskbar.can_previous.unwrap_or(true);
    let can_next = taskbar.can_next.unwrap_or(true);

    MenuBuilder::new(app)
        .item(&MenuItemBuilder::with_id("play_pause", play_label).enabled(can_play).build(app)?)
        .item(&MenuItemBuilder::with_id("prev", i18n.prev).enabled(can_prev).build(app)?)
        .item(&MenuItemBuilder::with_id("next", i18n.next).enabled(can_next).build(app)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&MenuItemBuilder::with_id("toggle_show", i18n.show).build(app)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&MenuItemBuilder::with_id("quit", i18n.quit).build(app)?)
        .build()
}

pub fn setup_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let state = app.state::<AppState>();
    let locale = state.get_locale();
    let taskbar = state.taskbar_state.lock().unwrap().clone();

    let menu = create_tray_menu(app, &locale, &taskbar)?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("BBeBee")
        .menu(&menu)
        .show_menu_on_left_click(false);

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "play_pause" => {
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.emit("taskbar:action", "togglePlay");
                    }
                }
                "prev" => {
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.emit("taskbar:action", "previous");
                    }
                }
                "next" => {
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.emit("taskbar:action", "next");
                    }
                }
                "toggle_show" => {
                    toggle_main_window(app);
                }
                "quit" => {
                    let s = app.state::<AppState>();
                    s.set_quitting(true);
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                toggle_main_window(app);
            }
        })
        .build(app)?;

    Ok(())
}

pub fn update_tray_menu(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    let locale = state.get_locale();
    let taskbar = state.taskbar_state.lock().unwrap().clone();
    let menu = create_tray_menu(app, &locale, &taskbar).map_err(|e| e.to_string())?;

    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_menu(Some(menu));
        let tooltip = if let Some(title) = &taskbar.title {
            if let Some(artist) = &taskbar.artist {
                format!("BBeBee — {} - {}", title, artist)
            } else {
                format!("BBeBee — {}", title)
            }
        } else {
            "BBeBee".to_string()
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
    Ok(())
}
