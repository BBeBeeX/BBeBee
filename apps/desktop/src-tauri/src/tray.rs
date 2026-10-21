//! System tray icon and menu.
//!
//! Cross-platform tray with localized controls (play/pause, prev/next,
//! show/hide, quit). Click behavior: left-click toggles the main window.

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

use crate::error::lock_recover;
use crate::i18n::get_tray_i18n;
use crate::state::{AppState, TaskbarState};

/// Toggle the main window visibility.
pub fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    let visible = win.is_visible().unwrap_or(false);
    let minimized = win.is_minimized().unwrap_or(false);
    if visible && !minimized {
        let _ = win.hide();
    } else {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Build the tray context menu for the current playback state.
pub fn create_tray_menu(
    app: &tauri::AppHandle,
    locale: &str,
    taskbar: &TaskbarState,
) -> Result<tauri::menu::Menu<tauri::Wry>, tauri::Error> {
    let i18n = get_tray_i18n(locale);
    let play_label = if taskbar.is_playing { &i18n.pause } else { &i18n.play };
    let fav_label = if taskbar.is_favorite.unwrap_or(false) {
        &i18n.unfavorite
    } else {
        &i18n.favorite
    };

    MenuBuilder::new(app)
        .item(
            &MenuItemBuilder::with_id("play_pause", play_label)
                .enabled(taskbar.can_play_or_pause.unwrap_or(true))
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("prev", &i18n.prev)
                .enabled(taskbar.can_previous.unwrap_or(true))
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("next", &i18n.next)
                .enabled(taskbar.can_next.unwrap_or(true))
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("favorite", fav_label)
                .enabled(taskbar.can_favorite.unwrap_or(false))
                .build(app)?,
        )
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&MenuItemBuilder::with_id("toggle_show", &i18n.show).build(app)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&MenuItemBuilder::with_id("quit", &i18n.quit).build(app)?)
        .build()
}

/// Create the tray icon during app setup.
pub fn setup_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let state = app.state::<AppState>();
    let taskbar = lock_recover(&state.taskbar_state).clone();
    let menu = create_tray_menu(app, &state.get_locale(), &taskbar)?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("BBeBee")
        .menu(&menu)
        .show_menu_on_left_click(false);

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder
        .on_menu_event(|app, event| on_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Handle a tray menu item click.
fn on_menu_event(app: &tauri::AppHandle, id: &str) {
    match id {
        "play_pause" => emit_to_main(app, "taskbar:action", "togglePlay"),
        "prev" => emit_to_main(app, "taskbar:action", "previous"),
        "next" => emit_to_main(app, "taskbar:action", "next"),
        "favorite" => emit_to_main(app, "taskbar:action", "toggleFavorite"),
        "toggle_show" => toggle_main_window(app),
        "quit" => {
            app.state::<AppState>().set_quitting(true);
            app.exit(0);
        }
        _ => {}
    }
}

/// Emit an event to the main window, if it exists.
pub fn emit_to_main(app: &tauri::AppHandle, event: &str, payload: &str) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit(event, payload);
    }
}

/// Refresh the tray menu and tooltip after playback state changes.
pub fn update_tray_menu(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    let taskbar = lock_recover(&state.taskbar_state).clone();
    let menu = create_tray_menu(app, &state.get_locale(), &taskbar)
        .map_err(|e| e.to_string())?;

    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_menu(Some(menu));
        let _ = tray.set_tooltip(Some(tray_tooltip(&taskbar)));
    }
    Ok(())
}

/// Tooltip text: "BBeBee — Title - Artist" or just "BBeBee".
fn tray_tooltip(taskbar: &TaskbarState) -> String {
    match (&taskbar.title, &taskbar.artist) {
        (Some(title), Some(artist)) => format!("BBeBee — {title} - {artist}"),
        (Some(title), None) => format!("BBeBee — {title}"),
        _ => "BBeBee".to_string(),
    }
}
