//! Coalescing forwarder for high-frequency Rust → webview notifications.
//!
//! State is not event (memory-governance principle 1): the webviews render
//! the *latest* value of a volatile field — the mini-player payload, the
//! desktop-lyrics payload, the media-session position — so delivering every
//! intermediate value buys nothing and costs a full Tauri serialize +
//! broadcast per tick, three hops (invoke → Rust → emit) each. A suppressed
//! payload is parked and flushed by a timer, so a *final* change is never
//! lost even when the producer stops ticking.
//!
//! The send decision itself is a pure function of the topic state and an
//! injected instant, so the coalescing/dedup semantics are testable without
//! a Tauri app handle or real clocks.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::error::lock_recover;

/// Decision for one `emit` attempt. Pure so tests can drive the clock.
#[derive(Debug, PartialEq, Eq)]
enum EmitDecision {
    /// Nothing changed since the last send — skip entirely.
    Skip,
    /// Inside the interval: send now.
    Send,
    /// Inside the interval: park the payload until `due`, latest wins.
    Park { due: Instant },
}

#[derive(Default)]
struct TopicState {
    last_sent: Option<String>,
    last_sent_at: Option<Instant>,
    pending: Option<(String, serde_json::Value)>,
    due: Option<Instant>,
    /// A flush task is alive for this topic — new parks must not spawn one.
    flushing: bool,
}

fn decide(
    state: &mut TopicState,
    serialized: &str,
    payload: &serde_json::Value,
    min_interval: Duration,
    now: Instant,
) -> EmitDecision {
    if state.last_sent.as_deref() == Some(serialized) {
        return EmitDecision::Skip;
    }
    let earliest = state.last_sent_at.map(|t| t + min_interval).unwrap_or(now);
    if now >= earliest {
        state.last_sent = Some(serialized.to_string());
        state.last_sent_at = Some(now);
        state.pending = None;
        state.due = None;
        return EmitDecision::Send;
    }
    state.pending = Some((serialized.to_string(), payload.clone()));
    state.due = Some(earliest);
    EmitDecision::Park { due: earliest }
}

/// Who owns it: one instance in `AppState`, shared by every command that
/// forwards volatile payloads. Capacity: one parked payload per topic.
/// Overflow: the newest replaces the parked one. Consumers: the webview
/// listeners of the topic. Failure: a dead flush task is replaced by the
/// next park. Release: dropped with `AppState`. Monitoring: bounded by
/// construction — one entry per topic, no history.
#[derive(Clone, Default)]
pub struct CoalescedEmitter {
    topics: Arc<Mutex<HashMap<String, TopicState>>>,
}

impl CoalescedEmitter {
    /// Emit `payload` on `topic`, at most once per `min_interval`, skipping
    /// payloads identical to whatever went out last.
    pub fn emit(
        &self,
        app: &AppHandle,
        topic: &str,
        payload: serde_json::Value,
        min_interval: Duration,
    ) {
        let serialized = payload.to_string();
        let decision = {
            let mut map = lock_recover(&self.topics);
            let state = map.entry(topic.to_string()).or_default();
            decide(state, &serialized, &payload, min_interval, Instant::now())
        };
        match decision {
            EmitDecision::Skip => {}
            EmitDecision::Send => {
                let _ = app.emit(topic, &payload);
            }
            EmitDecision::Park { .. } => {
                self.ensure_flush_task(app.clone(), topic.to_string());
            }
        }
    }

    /// Spawn exactly one flush task per topic while a park is outstanding.
    fn ensure_flush_task(&self, app: AppHandle, topic: String) {
        let needs_task = {
            let mut map = lock_recover(&self.topics);
            let state = map.entry(topic.clone()).or_default();
            if state.flushing {
                false
            } else {
                state.flushing = true;
                true
            }
        };
        if !needs_task {
            return;
        }
        let topics = Arc::clone(&self.topics);
        tauri::async_runtime::spawn(async move {
            loop {
                enum Action {
                    Sleep(Duration),
                    Take,
                }
                let action = {
                    let mut map = lock_recover(&topics);
                    let Some(state) = map.get_mut(&topic) else { break };
                    match (&state.pending, state.due) {
                        (Some(_), Some(due)) => {
                            let now = Instant::now();
                            if now >= due {
                                Action::Take
                            } else {
                                Action::Sleep(due - now)
                            }
                        }
                        _ => {
                            // Nothing parked (a direct send won the race, or
                            // a previous iteration flushed it) — stand down.
                            state.flushing = false;
                            break;
                        }
                    }
                };
                match action {
                    Action::Sleep(d) => tokio::time::sleep(d).await,
                    Action::Take => {
                        let value = {
                            let mut map = lock_recover(&topics);
                            let Some(state) = map.get_mut(&topic) else { break };
                            let Some((serialized, value)) = state.pending.take() else {
                                state.flushing = false;
                                break;
                            };
                            state.due = None;
                            state.last_sent = Some(serialized);
                            state.last_sent_at = Some(Instant::now());
                            value
                        };
                        let _ = app.emit(&topic, &value);
                        // Loop: a newer payload may have parked meanwhile.
                    }
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parked(state: &TopicState) -> Option<&String> {
        state.pending.as_ref().map(|(s, _)| s)
    }

    use serde_json::json;

    #[test]
    fn first_send_goes_out_immediately() {
        let mut state = TopicState::default();
        let now = Instant::now();
        assert_eq!(decide(&mut state, "a", &json!("a"), Duration::from_millis(100), now), EmitDecision::Send);
        assert_eq!(state.last_sent.as_deref(), Some("a"));
    }

    #[test]
    fn identical_payload_never_re_emits() {
        let mut state = TopicState::default();
        let t0 = Instant::now();
        assert_eq!(decide(&mut state, "a", &json!("a"), Duration::from_millis(100), t0), EmitDecision::Send);
        // Same value, long after the interval: still skipped.
        assert_eq!(
            decide(&mut state, "a", &json!("a"), Duration::from_millis(100), t0 + Duration::from_secs(3600)),
            EmitDecision::Skip
        );
        // A changed value inside the interval parks instead.
        assert_eq!(
            decide(&mut state, "b", &json!("b"), Duration::from_millis(100), t0 + Duration::from_millis(10)),
            EmitDecision::Park { due: t0 + Duration::from_millis(100) }
        );
        assert_eq!(parked(&state).map(String::as_str), Some("b"));
    }

    #[test]
    fn park_replaces_with_the_newest_payload() {
        let mut state = TopicState::default();
        let t0 = Instant::now();
        let _ = decide(&mut state, "a", &json!("a"), Duration::from_millis(100), t0);
        let t1 = t0 + Duration::from_millis(10);
        assert_eq!(
            decide(&mut state, "c", &json!("c"), Duration::from_millis(100), t1),
            EmitDecision::Park { due: t0 + Duration::from_millis(100) }
        );
        assert_eq!(
            decide(&mut state, "c", &json!("c"), Duration::from_millis(100), t1),
            EmitDecision::Park { due: t0 + Duration::from_millis(100) }
        );
        // Latest wins: only "c" is parked.
        assert_eq!(parked(&state).map(String::as_str), Some("c"));
        // And the parked value flushes once the interval elapses.
        assert_eq!(
            decide(&mut state, "c", &json!("c"), Duration::from_millis(100), t0 + Duration::from_millis(150)),
            EmitDecision::Send
        );
        assert!(state.pending.is_none(), "a send clears any parked payload");
    }

    #[test]
    fn a_send_clears_stale_parked_state() {
        let mut state = TopicState::default();
        let t0 = Instant::now();
        let _ = decide(&mut state, "a", &json!("a"), Duration::from_millis(100), t0);
        let _ = decide(&mut state, "b", &json!("b"), Duration::from_millis(100), t0 + Duration::from_millis(10));
        // A direct send (e.g. the state cache path forced it) supersedes.
        assert_eq!(
            decide(&mut state, "c", &json!("c"), Duration::from_millis(100), t0 + Duration::from_millis(20)),
            EmitDecision::Park { due: t0 + Duration::from_millis(100) }
        );
        assert_eq!(
            decide(&mut state, "c", &json!("c"), Duration::from_millis(100), t0 + Duration::from_millis(120)),
            EmitDecision::Send
        );
        assert!(state.pending.is_none());
        assert!(state.due.is_none());
    }
}
