//! The shell's proxy custody.
//!
//! The renderer never sends the proxy config anywhere: it can only ask for a
//! reload. This module is the reason that is enough — it reads the *settings
//! store* (`store.json`, where `proxy.enabled` and the address live) and the
//! *secrets file* (`secrets.json`, where `setProxyPassword` put the password),
//! decrypts the password with the keychain key only this process holds, and
//! assembles the transport config that gets pushed to the sidecar. The
//! password crosses this boundary exactly once, shell → sidecar, and never
//! appears in the settings document, a renderer payload, or a log.
//!
//! Any failure on the secrets side — missing file, missing entry, keychain
//! unavailable, a legacy XOR-fallback entry this process cannot decrypt —
//! reads as "no password", because a proxy without its password is simply a
//! proxy that may answer 407. Nothing here fails the app over a credential.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

/// The settings document inside `store.json` (namespace:key, as `core-store-fs`
/// lays it out), plus the legacy unprefixed spelling.
const SETTINGS_KEYS: [&str; 2] = ["@bbebee/plugin-settings:preferences", "preferences"];
/// The secrets entry `plugin-settings` writes via `setProxyPassword`
/// (`<pluginScope>/<key>`, as `core-secrets-desktop` prefixes it).
const PROXY_SECRET_KEY: &str = "@bbebee/plugin-settings/proxy.password";

/// `<userData>`, resolved exactly as the sidecar resolves it
/// (`core-paths-desktop`'s `resolveSystemPath('userData')`).
pub(crate) fn user_data_dir() -> Result<PathBuf, String> {
    crate::protocols::user_data_dir().ok_or_else(|| "could not resolve the app data directory".to_string())
}

fn read_json(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// The stored proxy password, decrypted. `None` covers every way it can be
/// absent, including the ones that mean "this install has no keychain".
fn read_proxy_password(user_data: &Path) -> Option<String> {
    let doc = read_json(&user_data.join("secrets.json"))?;
    let cipher = doc.get(PROXY_SECRET_KEY)?.as_str()?;
    crate::secrets::decrypt(cipher)
        .ok()
        .filter(|password| !password.is_empty())
}

/// The transport config the sidecar should hold, or `None` for "no proxy":
/// the master switch off, a missing host/port, or no settings file at all.
///
/// A legacy plaintext `password` left in the settings document by an older
/// build is deliberately **not** forwarded — the secret file is the only
/// source, and the migration in `plugin-settings` is what empties the
/// document field.
pub fn effective_proxy_config(user_data: &Path) -> Option<Value> {
    let store = read_json(&user_data.join("store.json"))?;
    let settings = SETTINGS_KEYS
        .iter()
        .find_map(|key| store.get(*key))
        .filter(|settings| settings.is_object())?;
    let proxy = settings.get("proxy")?;

    let enabled = proxy.get("enabled").and_then(Value::as_bool).unwrap_or(false);
    let host = proxy
        .get("host")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    // JSON numbers may arrive as floats; `as_i64` would refuse `7890.0`.
    let port = proxy
        .get("port")
        .and_then(Value::as_f64)
        .filter(|port| port.fract() == 0.0 && *port > 0.0 && *port <= 65535.0)
        .map(|port| port as u16)?;
    if !enabled || host.is_empty() {
        return None;
    }

    let protocol = match proxy.get("protocol").and_then(Value::as_str) {
        Some("socks5") => "socks5",
        Some("https") => "https",
        _ => "http",
    };

    let mut config = json!({ "enabled": true, "protocol": protocol, "host": host, "port": port });
    if let Some(username) = proxy.get("username").and_then(Value::as_str).filter(|u| !u.is_empty()) {
        config["username"] = json!(username);
    }
    if let Some(password) = read_proxy_password(user_data) {
        config["password"] = json!(password);
    }
    Some(config)
}

/// The password alone, for the settings "test" button: it probes the *form*
/// values plus whatever credential is stored, without needing the master
/// switch to be on.
pub fn stored_proxy_password(user_data: &Path) -> Option<String> {
    read_proxy_password(user_data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_dir(name: &str, store: Option<&str>, secrets: Option<&str>) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bbebee-proxy-cfg-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        if let Some(store) = store {
            fs::write(dir.join("store.json"), store).unwrap();
        }
        if let Some(secrets) = secrets {
            fs::write(dir.join("secrets.json"), secrets).unwrap();
        }
        dir
    }

    const STORE: &str = r#"{
        "@bbebee/plugin-settings:preferences": {
            "proxy": {
                "enabled": true, "protocol": "socks5", "host": "127.0.0.1",
                "port": 7890, "username": "user", "password": "LEGACY-PLAINTEXT",
                "sourceRules": {}
            }
        }
    }"#;

    #[test]
    fn assembles_the_config_from_store_and_ignores_the_document_password() {
        let dir = write_dir("assemble", Some(STORE), None);
        let config = effective_proxy_config(&dir).expect("enabled proxy with host/port");
        assert_eq!(config["protocol"], "socks5");
        assert_eq!(config["host"], "127.0.0.1");
        assert_eq!(config["port"], 7890);
        assert_eq!(config["username"], "user");
        // The legacy plaintext in the document is never forwarded.
        assert!(config.get("password").is_none());
    }

    #[test]
    fn master_switch_off_means_no_proxy() {
        let disabled = STORE.replace("\"enabled\": true", "\"enabled\": false");
        let dir = write_dir("disabled", Some(&disabled), None);
        assert!(effective_proxy_config(&dir).is_none());
    }

    #[test]
    fn missing_store_means_no_proxy() {
        let dir = write_dir("empty", None, None);
        assert!(effective_proxy_config(&dir).is_none());
    }
}
