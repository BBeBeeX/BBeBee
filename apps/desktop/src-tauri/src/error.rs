//! Unified error type for the BBeBee desktop host.
//!
//! All fallible operations in the host return `Result<T, HostError>`.
//! The error carries a machine-readable code and a human-readable message,
//! both of which cross the IPC boundary to the renderer.

use serde::Serialize;
use std::fmt;

/// Machine-readable error codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// The requested file or directory does not exist.
    NotFound,
    /// Permission denied by the OS.
    PermissionDenied,
    /// Invalid argument passed by the renderer.
    InvalidArgument,
    /// The OS keychain / secure storage is unavailable.
    SecretsUnavailable,
    /// A subprocess (sidecar, audio engine) failed.
    SubprocessFailed,
    /// An I/O operation failed.
    IoError,
    /// An unexpected internal error.
    Internal,
}

/// The host-wide error type.
#[derive(Debug, Clone, Serialize)]
pub struct HostError {
    pub code: ErrorCode,
    pub message: String,
}

impl HostError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn not_found(what: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, what.into())
    }

    pub fn invalid_argument(what: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidArgument, what.into())
    }

    pub fn internal(what: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, what.into())
    }
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.code, self.message)
    }
}

impl std::error::Error for HostError {}

/// Convert from std::io::Error.
impl From<std::io::Error> for HostError {
    fn from(e: std::io::Error) -> Self {
        let code = match e.kind() {
            std::io::ErrorKind::NotFound => ErrorCode::NotFound,
            std::io::ErrorKind::PermissionDenied => ErrorCode::PermissionDenied,
            _ => ErrorCode::IoError,
        };
        Self::new(code, e.to_string())
    }
}

/// Convert from serde_json::Error.
impl From<serde_json::Error> for HostError {
    fn from(e: serde_json::Error) -> Self {
        Self::new(ErrorCode::Internal, format!("JSON error: {e}"))
    }
}

/// Shorthand for host Results.
pub type HostResult<T> = Result<T, HostError>;

/// Lock a `Mutex`, recovering from poisoning.
///
/// A poisoned mutex means another thread panicked while holding it.
/// For the desktop host, we prefer to recover with the last-known value
/// rather than propagate the panic.
pub fn lock_recover<T>(m: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}
