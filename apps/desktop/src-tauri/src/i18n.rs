//! Tray and shell internationalization strings with full BCP47 negotiation.

pub struct TrayI18n {
    pub play: &'static str,
    pub pause: &'static str,
    pub prev: &'static str,
    pub next: &'static str,
    pub favorite: &'static str,
    pub unfavorite: &'static str,
    pub show: &'static str,
    pub hide: &'static str,
    pub quit: &'static str,
    pub open_mini_player: &'static str,
}

pub const TRAY_EN: TrayI18n = TrayI18n {
    play: "Play",
    pause: "Pause",
    prev: "Previous track",
    next: "Next track",
    favorite: "Favorite",
    unfavorite: "Unfavorite",
    show: "Show BBeBee",
    hide: "Hide BBeBee",
    quit: "Quit",
    open_mini_player: "Open Mini Player",
};

pub const TRAY_ZH_CN: TrayI18n = TrayI18n {
    play: "播放",
    pause: "暂停",
    prev: "上一首",
    next: "下一首",
    favorite: "收藏",
    unfavorite: "取消收藏",
    show: "显示 BBeBee",
    hide: "隐藏 BBeBee",
    quit: "退出",
    open_mini_player: "打开迷你播放器",
};

pub const TRAY_ZH_TW: TrayI18n = TrayI18n {
    play: "播放",
    pause: "暫停",
    prev: "上一首",
    next: "下一首",
    favorite: "收藏",
    unfavorite: "取消收藏",
    show: "顯示 BBeBee",
    hide: "隱藏 BBeBee",
    quit: "結束",
    open_mini_player: "開啟迷你播放器",
};

pub const TRAY_JA: TrayI18n = TrayI18n {
    play: "再生",
    pause: "一時停止",
    prev: "前の曲",
    next: "次の曲",
    favorite: "お気に入りに追加",
    unfavorite: "お気に入りから削除",
    show: "BBeBeeを表示",
    hide: "BBeBeeを隠す",
    quit: "終了",
    open_mini_player: "ミニプレーヤーを開く",
};

/// Resolves a BCP47 locale tag to the closest matching catalogue:
/// 1. Checks regional/script variants (e.g. `zh-TW`, `zh-HK`, `zh-Hant` vs `zh-CN`, `zh-Hans`).
/// 2. Checks primary language subtag (`zh`, `ja`, `en`).
/// 3. Falls back to English (`en`).
pub fn get_tray_i18n(locale: &str) -> &'static TrayI18n {
    let norm = locale.trim().to_lowercase().replace('_', "-");
    let primary = norm.split('-').next().unwrap_or("");

    if norm.starts_with("zh-tw")
        || norm.starts_with("zh-hk")
        || norm.starts_with("zh-mo")
        || norm.contains("-hant")
    {
        &TRAY_ZH_TW
    } else if primary == "zh" {
        &TRAY_ZH_CN
    } else if primary == "ja" {
        &TRAY_JA
    } else {
        &TRAY_EN
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bcp47_negotiation() {
        // Simplified Chinese variants
        assert_eq!(get_tray_i18n("zh-CN").play, "播放");
        assert_eq!(get_tray_i18n("zh-Hans-CN").pause, "暂停");
        assert_eq!(get_tray_i18n("zh_SG").show, "显示 BBeBee");
        assert_eq!(get_tray_i18n("zh").quit, "退出");
        assert_eq!(get_tray_i18n("zh-CN").open_mini_player, "打开迷你播放器");

        // Traditional Chinese variants
        assert_eq!(get_tray_i18n("zh-TW").pause, "暫停");
        assert_eq!(get_tray_i18n("zh-HK").show, "顯示 BBeBee");
        assert_eq!(get_tray_i18n("zh-MO").quit, "結束");
        assert_eq!(get_tray_i18n("zh-Hant").quit, "結束");
        assert_eq!(get_tray_i18n("zh-TW").open_mini_player, "開啟迷你播放器");

        // Japanese
        assert_eq!(get_tray_i18n("ja-JP").play, "再生");
        assert_eq!(get_tray_i18n("ja").show, "BBeBeeを表示");
        assert_eq!(get_tray_i18n("ja").open_mini_player, "ミニプレーヤーを開く");

        // English & fallbacks
        assert_eq!(get_tray_i18n("en-US").play, "Play");
        assert_eq!(get_tray_i18n("en-GB").quit, "Quit");
        assert_eq!(get_tray_i18n("en_AU").prev, "Previous track");
        assert_eq!(get_tray_i18n("fr-FR").prev, "Previous track");
        assert_eq!(get_tray_i18n("de-DE").show, "Show BBeBee");
        assert_eq!(get_tray_i18n("").quit, "Quit");
        assert_eq!(get_tray_i18n("en").open_mini_player, "Open Mini Player");
    }
}

