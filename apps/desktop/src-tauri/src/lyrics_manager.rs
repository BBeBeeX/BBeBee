//! Desktop Lyrics Window Manager
//!
//! Controls the frameless, transparent desktop lyrics overlay window.
//! Implements screen clamping, 120ms cursor polling tracking reporting
//! relative {x, y} or {-1, -1} when locked (ported from main/index.ts:456-639),
//! and programmatic move suppression with moved event throttling.

use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{Emitter, Manager};

use crate::state::{AppState, Position};

/// Remove the DWM-drawn 1px border on Windows 11 transparent windows.
/// Uses DWMWA_BORDER_COLOR with DWMWA_COLOR_NONE (0xFFFFFFFE).
/// Best-effort: failures are logged, never fatal.
#[cfg(target_os = "windows")]
#[allow(dead_code)]
fn remove_dwm_border(win: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWINDOWATTRIBUTE};

    const DWMWA_BORDER_COLOR: DWMWINDOWATTRIBUTE = DWMWINDOWATTRIBUTE(34);
    const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

    match win.hwnd() {
        Ok(hwnd) => {
            let hwnd = HWND(hwnd.0 as *mut _);
            unsafe {
                let hr = DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_BORDER_COLOR,
                    &DWMWA_COLOR_NONE as *const u32 as *const _,
                    std::mem::size_of::<u32>() as u32,
                );
                if hr.is_err() {
                    eprintln!("[desktop-lyrics] remove_dwm_border failed: {:?}", hr);
                }
            }
        }
        Err(e) => {
            eprintln!("[desktop-lyrics] remove_dwm_border: no hwnd: {}", e);
        }
    }
}

pub const DEFAULT_LYRIC_WIDTH: i32 = 860;
pub const DEFAULT_LYRIC_HEIGHT: i32 = 140;

pub fn clamp_rect(
    pos: Position,
    width: i32,
    height: i32,
    mx: i32,
    my: i32,
    mw: i32,
    mh: i32,
) -> Position {
    let clamped_x = pos.x.max(mx).min(mx + mw - width);
    let clamped_y = pos.y.max(my).min(my + mh - height);
    Position {
        x: clamped_x,
        y: clamped_y,
    }
}

pub fn clamp_to_visible_screen(
    app: &tauri::AppHandle,
    pos: Position,
    width: i32,
    height: i32,
) -> Position {
    if let Ok(monitors) = app.available_monitors() {
        for m in monitors {
            let m_pos = m.position();
            let m_size = m.size();
            let scale = m.scale_factor();
            let mx = (m_pos.x as f64 / scale).round() as i32;
            let my = (m_pos.y as f64 / scale).round() as i32;
            let mw = (m_size.width as f64 / scale).round() as i32;
            let mh = (m_size.height as f64 / scale).round() as i32;

            if pos.x >= mx && pos.x < mx + mw && pos.y >= my && pos.y < my + mh {
                return clamp_rect(pos, width, height, mx, my, mw, mh);
            }
        }
    }
    pos
}

pub fn get_default_lyric_position(app: &tauri::AppHandle, width: i32, height: i32) -> Position {
    if let Ok(Some(primary)) = app.primary_monitor() {
        let m_pos = primary.position();
        let m_size = primary.size();
        let scale = primary.scale_factor();
        let mx = (m_pos.x as f64 / scale).round() as i32;
        let my = (m_pos.y as f64 / scale).round() as i32;
        let mw = (m_size.width as f64 / scale).round() as i32;
        let mh = (m_size.height as f64 / scale).round() as i32;

        let initial_x = mx + (mw - width) / 2;
        let initial_y = my + mh - height - 40;
        return Position {
            x: initial_x,
            y: initial_y,
        };
    }
    Position { x: 100, y: 100 }
}

pub fn get_or_create_lyric_window(
    app: &tauri::AppHandle,
    pos: Option<Position>,
) -> Result<tauri::WebviewWindow, String> {
    if let Some(win) = app.get_webview_window("desktop-lyrics") {
        return Ok(win);
    }

    let initial_pos = match pos {
        Some(p) => clamp_to_visible_screen(app, p, DEFAULT_LYRIC_WIDTH, DEFAULT_LYRIC_HEIGHT),
        None => get_default_lyric_position(app, DEFAULT_LYRIC_WIDTH, DEFAULT_LYRIC_HEIGHT),
    };

    let builder = tauri::WebviewWindowBuilder::new(
        app,
        "desktop-lyrics",
        tauri::WebviewUrl::App("index.html?window=desktop-lyrics#desktop-lyrics".into()),
    )
    .title("BBeBee Desktop Lyrics")
    .inner_size(DEFAULT_LYRIC_WIDTH as f64, DEFAULT_LYRIC_HEIGHT as f64)
    .min_inner_size(400.0, 80.0)
    .position(initial_pos.x as f64, initial_pos.y as f64)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(true)
    .initialization_script(include_str!("../gen/shim.js"))
    .visible(false);

    let win = builder.build().map_err(|e| e.to_string())?;
    let _ = win.set_always_on_top(true);
    // DIAGNOSTIC: DWM border removal disabled to isolate mini-player freeze.
    // #[cfg(target_os = "windows")]
    // remove_dwm_border(&win);

    Ok(win)
}

pub fn set_lyric_window_position(
    app: &tauri::AppHandle,
    win: &tauri::WebviewWindow,
    state: &AppState,
    x: i32,
    y: i32,
) -> Result<(), String> {
    if let Ok(cur_pos) = win.outer_position() {
        let scale = win.scale_factor().unwrap_or(1.0);
        let cur_x = (cur_pos.x as f64 / scale).round() as i32;
        let cur_y = (cur_pos.y as f64 / scale).round() as i32;
        if cur_x == x && cur_y == y {
            return Ok(());
        }
    }

    state.lyric_programmatic_move.store(true, Ordering::SeqCst);
    win.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
        x as f64, y as f64,
    )))
    .map_err(|e| e.to_string())?;

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(60)).await;
        let app_state = handle.state::<AppState>();
        app_state
            .lyric_programmatic_move
            .store(false, Ordering::SeqCst);
    });

    Ok(())
}

pub fn start_lyric_cursor_tracking(app: &tauri::AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last_inside = false;
        loop {
            tokio::time::sleep(Duration::from_millis(120)).await;
            let state = handle.state::<AppState>();
            let visible = state.lyric_window_visible.load(Ordering::SeqCst);
            let locked = state.lyric_window_locked.load(Ordering::SeqCst);

            if !visible || !locked {
                break;
            }

            let Some(win) = handle.get_webview_window("desktop-lyrics") else {
                break;
            };

            if let Ok(is_vis) = win.is_visible() {
                if !is_vis {
                    continue;
                }
            }

            let Ok(cursor) = handle.cursor_position() else {
                continue;
            };
            let scale = win.scale_factor().unwrap_or(1.0);
            let Ok(win_pos) = win.outer_position() else {
                continue;
            };
            let Ok(win_size) = win.outer_size() else {
                continue;
            };

            let rel_x = ((cursor.x - win_pos.x as f64) / scale).round() as i32;
            let rel_y = ((cursor.y - win_pos.y as f64) / scale).round() as i32;
            let logical_w = (win_size.width as f64 / scale).round() as i32;
            let logical_h = (win_size.height as f64 / scale).round() as i32;

            let inside = rel_x >= 0 && rel_x < logical_w && rel_y >= 0 && rel_y < logical_h;

            if inside || last_inside {
                let payload = if inside {
                    serde_json::json!({ "x": rel_x, "y": rel_y })
                } else {
                    serde_json::json!({ "x": -1, "y": -1 })
                };
                let _ = win.emit("desktop-lyrics:cursor", payload);
            }
            last_inside = inside;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_dimensions() {
        assert_eq!(DEFAULT_LYRIC_WIDTH, 860);
        assert_eq!(DEFAULT_LYRIC_HEIGHT, 140);
    }

    #[test]
    fn test_clamp_rect() {
        // Monitor: (0, 0, 1920, 1080), window: 860x140
        // Normal position inside bounds
        let normal = clamp_rect(Position { x: 500, y: 500 }, 860, 140, 0, 0, 1920, 1080);
        assert_eq!(normal, Position { x: 500, y: 500 });

        // Exceeds right edge
        let right = clamp_rect(Position { x: 1500, y: 500 }, 860, 140, 0, 0, 1920, 1080);
        assert_eq!(right, Position { x: 1920 - 860, y: 500 });

        // Below bottom edge
        let bottom = clamp_rect(Position { x: 500, y: 1000 }, 860, 140, 0, 0, 1920, 1080);
        assert_eq!(bottom, Position { x: 500, y: 1080 - 140 });

        // Past left edge
        let left = clamp_rect(Position { x: -50, y: 500 }, 860, 140, 0, 0, 1920, 1080);
        assert_eq!(left, Position { x: 0, y: 500 });

        // Past top edge
        let top = clamp_rect(Position { x: 500, y: -20 }, 860, 140, 0, 0, 1920, 1080);
        assert_eq!(top, Position { x: 500, y: 0 });
    }
}
