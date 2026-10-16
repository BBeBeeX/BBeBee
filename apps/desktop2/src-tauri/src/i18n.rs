//! Tray and shell internationalization strings with zh-CN / en-US catalogue fallback.

pub struct TrayI18n {
    pub play: &'static str,
    pub pause: &'static str,
    pub prev: &'static str,
    pub next: &'static str,
    pub show: &'static str,
    pub hide: &'static str,
    pub quit: &'static str,
}

pub const TRAY_EN: TrayI18n = TrayI18n {
    play: "Play",
    pause: "Pause",
    prev: "Previous track",
    next: "Next track",
    show: "Show BBeBee",
    hide: "Hide BBeBee",
    quit: "Quit",
};

pub const TRAY_ZH: TrayI18n = TrayI18n {
    play: "播放",
    pause: "暂停",
    prev: "上一首",
    next: "下一首",
    show: "显示 BBeBee",
    hide: "隐藏 BBeBee",
    quit: "退出",
};

pub fn get_tray_i18n(locale: &str) -> &'static TrayI18n {
    if locale.starts_with("zh") {
        &TRAY_ZH
    } else {
        &TRAY_EN
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_i18n_fallback() {
        assert_eq!(get_tray_i18n("zh-CN").play, "播放");
        assert_eq!(get_tray_i18n("zh-TW").show, "显示 BBeBee");
        assert_eq!(get_tray_i18n("en-US").play, "Play");
        assert_eq!(get_tray_i18n("en-GB").quit, "Quit");
        assert_eq!(get_tray_i18n("fr-FR").prev, "Previous track");
    }
}
