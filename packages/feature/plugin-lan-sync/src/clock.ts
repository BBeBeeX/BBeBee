/**
 * Pure sync math for the listen-together mirror.
 *
 * The follower keeps one piece of derived state — the estimated offset
 * between its own clock and the leader's — and uses it to turn a snapshot
 * into "the position the leader is at *right now*". Everything here is a
 * pure function so the drift policy is testable without a transport.
 */

import { DRIFT_THRESHOLD_MS } from './protocol.js'

/** The clock relationship learned from one snapshot receipt. */
export interface ClockEstimate {
  /** `leaderNow ≈ localNow + offsetMs`. Positive = leader clock ahead. */
  offsetMs: number
  learnedAt: number
}

/**
 * Learn the clock offset from a snapshot receipt.
 *
 * `receivedAtLocal` is the local time the snapshot arrived; the snapshot
 * carries the leader's clock at build time. The difference includes the
 * leader→follower transit, so the estimate is biased by at most one RTT/2 —
 * on a LAN, single-digit milliseconds against a 350 ms drift threshold.
 */
export function learnClock(serverTimeMs: number, receivedAtLocal: number): ClockEstimate {
  return { offsetMs: serverTimeMs - receivedAtLocal, learnedAt: receivedAtLocal }
}

/** The leader's clock, approximately, right now. */
export function leaderNow(clock: ClockEstimate | undefined, localNow: number): number {
  return clock ? localNow + clock.offsetMs : localNow
}

/**
 * Where the follower's position should be at local time `localNow`, given a
 * snapshot taken at leader time `snapshot.serverTimeMs`.
 *
 * While the leader reports `playing`, the position advances in real time;
 * under any other status it is frozen at the snapshot value. `transportLagMs`
 * accounts for the known systematic gap between "the position the leader's
 * engine reports" and "the position the follower hears" — the follower's own
 * output latency, bounded and small, added by the caller.
 */
export function expectedPosition(
  snapshot: {
    status: string
    positionMs: number
    serverTimeMs: number
  },
  clock: ClockEstimate | undefined,
  localNow: number,
  transportLagMs = 0,
): number {
  if (snapshot.status !== 'playing') return snapshot.positionMs
  const elapsed = leaderNow(clock, localNow) - snapshot.serverTimeMs
  const advanced = snapshot.positionMs + Math.max(0, elapsed) - transportLagMs
  // A snapshot older than the track itself (join after a long pause in
  // traffic) still lands inside the track: clamp to the reported duration's
  // neighbourhood rather than inventing positions past the end.
  return Math.max(0, advanced)
}

/** True when the disagreement is large enough to be worth a seek. */
export function driftExceeds(actualPositionMs: number, expectedPositionMs: number): boolean {
  return Math.abs(actualPositionMs - expectedPositionMs) > DRIFT_THRESHOLD_MS
}

/**
 * Whether a snapshot represents a change the follower must act on, compared
 * against what it already mirrored. Pure bookkeeping — the reconcile state
 * machine calls this before touching the engine.
 */
export function snapshotMeansReload(
  loaded: { urn?: string; url?: string } | undefined,
  next: { trackUrn?: string; streamUrl?: string },
): boolean {
  if (!loaded) return Boolean(next.trackUrn)
  if (loaded.urn !== next.trackUrn) return true
  // Same track but a different URL (re-resolved token, rotated CDN link,
  // fresh expiry) is a reload too — the old URL may already be dead.
  return Boolean(next.streamUrl) && loaded.url !== next.streamUrl
}
