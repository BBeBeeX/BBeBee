//! Native OS Keychain & AES-256-GCM Secrets Manager
//!
//! Replaces Electron's `safeStorage` (OS keychain: Windows DPAPI/Credential Manager,
//! macOS Keychain, Linux Secret Service via `keyring`).
//!
//! Guarantees:
//! 1. When OS Keychain is available, a 256-bit AES master key is stored in the native
//!    keychain (`service: "org.bbebee.desktop"`, `user: "master_secret_key"`).
//! 2. Payloads are encrypted with AES-256-GCM using unique 96-bit (12-byte) random nonces.
//! 3. Authenticated encryption protects ciphertext integrity; tampering causes instant rejection.
//! 4. If the OS Keychain is unavailable (e.g. headless Linux without Secret Service daemon),
//!    `is_available()` returns `false`, and `encrypt()` fails with the exact Electron error:
//!    `secrets: safeStorage encryption is not available on this system`.
//!    This lets the renderer's `safeStorageCodec()` gracefully return `undefined` and activate
//!    `NoKeychainCodec(this.installKey())` rather than masking with insecure ciphers.

use std::sync::{Mutex, OnceLock};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use rand::Rng;

const KEYRING_SERVICE: &str = "org.bbebee.desktop";
const KEYRING_USER: &str = "master_secret_key";
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;
const MIN_CIPHER_LEN: usize = NONCE_LEN + TAG_LEN;

static MASTER_KEY_CACHE: OnceLock<Mutex<Option<[u8; 32]>>> = OnceLock::new();

fn key_cache() -> &'static Mutex<Option<[u8; 32]>> {
    MASTER_KEY_CACHE.get_or_init(|| Mutex::new(None))
}

/// Checks whether the OS Keychain is reachable and functional.
pub fn is_available() -> bool {
    // If we already resolved and cached the master key in memory, it is available.
    if let Ok(guard) = key_cache().lock() {
        if guard.is_some() {
            return true;
        }
    }

    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        Ok(entry) => match entry.get_password() {
            Ok(_) => true,
            Err(keyring::Error::NoEntry) => true, // Keychain service is active and responsive
            Err(_) => false,
        },
        Err(_) => false,
    }
}

/// Loads or creates the 256-bit master encryption key from the OS Keychain.
fn get_or_create_master_key() -> Result<[u8; 32], String> {
    if let Ok(guard) = key_cache().lock() {
        if let Some(key) = *guard {
            return Ok(key);
        }
    }

    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("keyring initialization failed: {}", e))?;

    let key_bytes = match entry.get_password() {
        Ok(hex_str) => {
            let mut key = [0u8; 32];
            hex::decode_to_slice(hex_str.trim(), &mut key)
                .map_err(|e| format!("invalid hex master key in keychain: {}", e))?;
            key
        }
        Err(keyring::Error::NoEntry) => {
            // Generate a fresh 32-byte cryptographically secure master key
            let mut key = [0u8; 32];
            rand::thread_rng().fill(&mut key);
            let hex_str = hex::encode(key);
            entry
                .set_password(&hex_str)
                .map_err(|e| format!("failed to persist master key to OS keychain: {}", e))?;
            key
        }
        Err(e) => return Err(format!("keyring access error: {}", e)),
    };

    if let Ok(mut guard) = key_cache().lock() {
        *guard = Some(key_bytes);
    }

    Ok(key_bytes)
}

/// Encrypts `plain` string into base64(nonce || ciphertext || tag) using the given 256-bit key.
pub fn encrypt_with_key(plain: &str, key: &[u8; 32]) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("cipher initialization failed: {}", e))?;

    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let encrypted = cipher
        .encrypt(nonce, plain.as_bytes())
        .map_err(|e| format!("encryption failed: {}", e))?;

    let mut combined = Vec::with_capacity(NONCE_LEN + encrypted.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&encrypted);

    Ok(BASE64_STANDARD.encode(&combined))
}

/// Decrypts base64(nonce || ciphertext || tag) into plaintext string using the given 256-bit key.
pub fn decrypt_with_key(cipher_b64: &str, key: &[u8; 32]) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("cipher initialization failed: {}", e))?;

    let raw = BASE64_STANDARD
        .decode(cipher_b64.trim())
        .map_err(|e| format!("secrets: invalid base64 payload: {}", e))?;

    if raw.len() < MIN_CIPHER_LEN {
        return Err("secrets: invalid cipher format or length".to_string());
    }

    let nonce = Nonce::from_slice(&raw[..NONCE_LEN]);
    let ciphertext_and_tag = &raw[NONCE_LEN..];

    let plaintext = cipher
        .decrypt(nonce, ciphertext_and_tag)
        .map_err(|_| "secrets: decryption failed or data tampered".to_string())?;

    String::from_utf8(plaintext)
        .map_err(|e| format!("secrets: decrypted payload is not valid UTF-8: {}", e))
}

/// Encrypts `plain` string into base64(nonce || ciphertext || tag) using the OS Keychain master key.
pub fn encrypt(plain: &str) -> Result<String, String> {
    if !is_available() {
        return Err("secrets: safeStorage encryption is not available on this system".to_string());
    }
    let master_key = get_or_create_master_key()?;
    encrypt_with_key(plain, &master_key)
}

/// Decrypts base64(nonce || ciphertext || tag) into plaintext string using the OS Keychain master key.
pub fn decrypt(cipher_b64: &str) -> Result<String, String> {
    if !is_available() {
        return Err("secrets: safeStorage encryption is not available on this system".to_string());
    }
    let master_key = get_or_create_master_key()?;
    decrypt_with_key(cipher_b64, &master_key)
}

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    fn test_aes_gcm_roundtrip() {
        let test_key = [0x42u8; 32];
        let secret = "super-secret-music-token-1234567890!@#$%^&*()_+";
        let encrypted = encrypt_with_key(secret, &test_key).expect("encryption should succeed");
        assert_ne!(secret, encrypted);

        let decrypted = decrypt_with_key(&encrypted, &test_key).expect("decryption should succeed");
        assert_eq!(secret, decrypted);
    }

    #[test]
    fn test_tamper_detection() {
        let test_key = [0x55u8; 32];
        let secret = "hello-world-payload";
        let encrypted = encrypt_with_key(secret, &test_key).expect("encryption should succeed");

        // Tamper with the base64 ciphertext
        let mut raw = BASE64_STANDARD.decode(&encrypted).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 0x01; // flip 1 bit in tag/ciphertext
        let tampered = BASE64_STANDARD.encode(&raw);

        let result = decrypt_with_key(&tampered, &test_key);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("tampered") || err.contains("failed"));
    }

    #[test]
    fn test_short_payload_fails() {
        let test_key = [0x55u8; 32];
        let short_b64 = BASE64_STANDARD.encode([1, 2, 3, 4]);
        let result = decrypt_with_key(&short_b64, &test_key);
        assert!(result.is_err());
    }


    #[test]
    fn test_empty_string_encryption() {
        let test_key = [0x77u8; 32];
        let encrypted = encrypt_with_key("", &test_key).expect("empty string encrypt should succeed");
        let decrypted = decrypt_with_key(&encrypted, &test_key).expect("empty string decrypt should succeed");
        assert_eq!(decrypted, "");
    }
}

