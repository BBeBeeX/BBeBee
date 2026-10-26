/**
 * A stand-in for `expo-haptics` under Vitest.
 *
 * The real module talks to the Taptic Engine and the Android vibrator over the
 * native bridge, which Node cannot load. The stub records every call with its
 * resolved arguments, so a test asserts not just "feedback happened" but the
 * *kind* — a favourite that lands as `heavy` where the spec says `light` is a
 * reviewable defect, not a passing test.
 */

export enum ImpactFeedbackStyle {
  Light = 'light',
  Medium = 'medium',
  Heavy = 'heavy',
  Rigid = 'rigid',
  Soft = 'soft',
}

export enum NotificationFeedbackType {
  Success = 'success',
  Warning = 'warning',
  Error = 'error',
}

export interface HapticsCall {
  method: 'impact' | 'notification' | 'selection'
  /** The enum value, already resolved ('light', 'success', …). */
  kind: string
}

const calls: HapticsCall[] = []

export async function impactAsync(style: ImpactFeedbackStyle = ImpactFeedbackStyle.Medium): Promise<void> {
  calls.push({ method: 'impact', kind: style })
}

export async function notificationAsync(
  type: NotificationFeedbackType = NotificationFeedbackType.Success,
): Promise<void> {
  calls.push({ method: 'notification', kind: type })
}

export async function selectionAsync(): Promise<void> {
  calls.push({ method: 'selection', kind: 'selection' })
}

/* ── Test levers ─────────────────────────────────────────────────────────── */

export function __calls(): readonly HapticsCall[] {
  return calls
}

export function __resetForTests(): void {
  calls.length = 0
}
