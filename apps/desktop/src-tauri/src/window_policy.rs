//! Window Policy: When a window close hides, and when it destroys.
//!
//! Ported 1:1 from `apps/desktop/main/window-policy.ts`.
//!
//! MD-6: Keeping the renderer alive keeps the kernel, the queue and the
//! audio graph alive, so "close the window" and "stop the music" stop being
//! the same gesture.

use serde::{Deserialize, Serialize};

/// What the close handler knows when it has to decide.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseContext {
    /// The user asked to quit — tray menu, app menu, or before-quit.
    pub quitting: bool,
    /// A tray icon exists, so a hidden window can be got back.
    pub has_tray: bool,
    /// `process.platform`. macOS keeps an app alive with no windows by design.
    pub platform: String,
    /// User preference: whether closing the window should minimize/hide to tray. Default true.
    pub close_to_tray: Option<bool>,
}

impl CloseContext {
    pub fn new(quitting: bool, has_tray: bool, platform: impl Into<String>, close_to_tray: Option<bool>) -> Self {
        Self {
            quitting,
            has_tray,
            platform: platform.into(),
            close_to_tray,
        }
    }
}

/// Whether hiding the last window leaves a way back to it.
///
/// ⚠️ The reason this is a question at all: a Linux session with no
/// StatusNotifier host has no tray, and hiding the last window there leaves a
/// process with no window, no tray and no dock — running, playing, and
/// impossible to reach or quit except from a terminal. Losing playback on close
/// is worse than the alternative everywhere the tray exists, and much better
/// than that.
pub fn can_survive_without_window(has_tray: bool, platform: &str) -> bool {
    has_tray || platform == "darwin"
}

/// `true` when the close must be intercepted and the window hidden instead.
///
/// This is MD-6: keeping the renderer alive keeps the kernel, the queue and the
/// audio graph alive, so "close the window" and "stop the music" stop being the
/// same gesture.
pub fn should_hide_on_close(ctx: &CloseContext) -> bool {
    if ctx.quitting {
        return false;
    }
    if ctx.close_to_tray == Some(false) {
        return false;
    }
    can_survive_without_window(ctx.has_tray, &ctx.platform)
}

/// `true` when the last window going away should end the process.
///
/// Reached only when a window was genuinely destroyed, since `should_hide_on_close`
/// intercepts the rest.
pub fn should_quit_when_windows_gone(ctx: &CloseContext) -> bool {
    ctx.quitting || ctx.close_to_tray == Some(false) || !can_survive_without_window(ctx.has_tray, &ctx.platform)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        has_tray: bool,
        platform: &'static str,
    }

    const WITH_TRAY: Fixture = Fixture {
        has_tray: true,
        platform: "win32",
    };
    const NO_TRAY: Fixture = Fixture {
        has_tray: false,
        platform: "linux",
    };
    const MAC: Fixture = Fixture {
        has_tray: false,
        platform: "darwin",
    };

    #[test]
    fn hides_rather_than_destroys_so_playback_survives_it() {
        let ctx = CloseContext::new(false, WITH_TRAY.has_tray, WITH_TRAY.platform, None);
        assert!(should_hide_on_close(&ctx));
        assert!(!should_quit_when_windows_gone(&ctx));
    }

    #[test]
    fn keeps_the_app_alive_on_macos_with_no_tray_where_dock_is_way_back() {
        let ctx = CloseContext::new(false, MAC.has_tray, MAC.platform, None);
        assert!(should_hide_on_close(&ctx));
    }

    #[test]
    fn lets_the_close_through_where_there_would_be_no_way_back() {
        let ctx = CloseContext::new(false, NO_TRAY.has_tray, NO_TRAY.platform, None);
        assert!(!should_hide_on_close(&ctx));
        assert!(should_quit_when_windows_gone(&ctx));
    }

    #[test]
    fn does_not_intercept_a_close_that_is_a_quit() {
        for target in &[WITH_TRAY, MAC, NO_TRAY] {
            let ctx = CloseContext::new(true, target.has_tray, target.platform, None);
            assert!(!should_hide_on_close(&ctx), "Platform: {}", target.platform);
            assert!(should_quit_when_windows_gone(&ctx), "Platform: {}", target.platform);
        }
    }

    #[test]
    fn destroys_and_quits_when_close_to_tray_is_disabled_by_user() {
        let ctx_win = CloseContext::new(false, WITH_TRAY.has_tray, WITH_TRAY.platform, Some(false));
        assert!(!should_hide_on_close(&ctx_win));
        assert!(should_quit_when_windows_gone(&ctx_win));

        let ctx_mac = CloseContext::new(false, MAC.has_tray, MAC.platform, Some(false));
        assert!(!should_hide_on_close(&ctx_mac));
        assert!(should_quit_when_windows_gone(&ctx_mac));
    }

    #[test]
    fn can_survive_without_window_is_the_tray_on_windows_and_linux_and_dock_on_macos() {
        assert!(can_survive_without_window(WITH_TRAY.has_tray, WITH_TRAY.platform));
        assert!(can_survive_without_window(true, "linux"));
        assert!(can_survive_without_window(MAC.has_tray, MAC.platform));
        assert!(!can_survive_without_window(NO_TRAY.has_tray, NO_TRAY.platform));
        assert!(!can_survive_without_window(false, "win32"));
    }
}
