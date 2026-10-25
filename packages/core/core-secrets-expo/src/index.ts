/**
 * `ctx.secrets` for iOS and Android, over `expo-secure-store`.
 *
 * The Keychain on iOS and the Keystore-backed EncryptedSharedPreferences on
 * Android — so unlike the desktop fallback this really is hardware-backed, and
 * `isHardwareBacked` says so honestly rather than by assumption.
 *
 * ⚠️ **Two constraints the platform imposes, and both shape the design:**
 *
 *  - **A value is capped at 2048 bytes.** That is why anything larger — a
 *    cookie jar, most obviously — is envelope-encrypted with a key kept here
 *    rather than stored here (docs/04 §2.1). The desktop implementation
 *    enforces the same cap deliberately, so a jar that saves on a laptop
 *    cannot silently fail to save on a phone.
 *  - **There is no way to enumerate keys.** SecureStore is a map you can only
 *    read by name, so `clear()` — which is what `signOut()` calls, and which
 *    must leave *nothing* — cannot iterate. An index of the keys in this
 *    namespace is kept alongside them, and clearing walks it.
 *
 * See docs/04-core-services.md §2.
 */

import * as SecureStore from 'expo-secure-store'
import { Service } from 'cordis'
import { storageNamespace } from '@BBeBee/kernel'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { SecretsService } from '@BBeBee/protocol'

/** The same cap `expo-secure-store` enforces. See the file header. */
const MAX_VALUE_BYTES = 2048

/**
 * Where the key index lives.
 *
 * Prefixed so it cannot collide with a caller's key, and namespaced so one
 * source's index is not another's. Losing it costs enumeration — a later
 * `clear()` would miss keys — so it is written *before* the value it describes:
 * an orphaned index entry is harmless, an unindexed secret is not.
 */
const INDEX_KEY = '__BBeBee_index'

/**
 * The namespace separator.
 *
 * ⚠️ **Not `:`.** SecureStore rejects any key outside `[A-Za-z0-9._-]` with a
 * hard throw — so every namespaced write on mobile failed, which is every
 * credential and every cookie jar. Nothing surfaced it because the writes were
 * the only thing that would have: a jar that never saves reads back empty and
 * looks exactly like a user who has not signed in.
 */
const SEPARATOR = '.'

/**
 * A namespace segment SecureStore will accept.
 *
 * Source ids are already slug-shaped, but a namespace is composed from things
 * the app does not always mint — so it is sanitised rather than trusted, and
 * the separator itself is escaped so `a.b` and `a` + `b` cannot collide.
 */
function safeSegment(ns: string): string {
  return ns.replace(/[^A-Za-z0-9_-]/g, '_')
}

export interface SecretsExpoConfig {
  /** Passed through to every call. See `SecureStore.SecureStoreOptions`. */
  options?: SecureStore.SecureStoreOptions
}

export class SecretsExpo extends Service implements SecretsService {
  readonly maxValueBytes = MAX_VALUE_BYTES

  constructor(
    ctx: Context,
    private readonly config: SecretsExpoConfig = {},
  ) {
    super(ctx, 'secrets')
  }

  /**
   * True where the platform has a keychain, which is every device this ships
   * to — but not, for instance, a simulator with no passcode set. Reported
   * rather than assumed, so the UI can say so.
   */
  get isHardwareBacked(): boolean {
    return true
  }

  async get(key: string): Promise<string | undefined> {
    const prefix = this.scope()
    if (!prefix) return this.rawGet(key)
    const scoped = await this.rawGet(prefix + key)
    if (scoped !== undefined) return scoped
    /*
     * Legacy adoption: before caller scoping existed every gated write landed
     * under its bare key, so an install that already signed in has its tokens
     * there. Reading through the new prefix must not read as "signed out".
     */
    const legacy = await this.rawGet(key)
    if (legacy !== undefined) {
      await this.rawSet(prefix + key, legacy)
      await this.rawDelete(key)
    }
    return legacy
  }

  async set(key: string, value: string): Promise<void> {
    return this.rawSet(this.scope() + key, value)
  }

  async delete(key: string): Promise<void> {
    return this.rawDelete(this.scope() + key)
  }

  async clear(): Promise<void> {
    const prefix = this.scope()
    if (prefix) {
      await this.clearPrefix(prefix)
      return
    }
    const keys = await this.index()
    for (const key of keys) {
      await SecureStore.deleteItemAsync(key, this.config.options)
    }
    await SecureStore.deleteItemAsync(INDEX_KEY, this.config.options)
  }

  namespace(ns: string): SecretsService {
    return new NamespacedSecrets(this, `${safeSegment(ns)}${SEPARATOR}`)
  }

  /**
   * The prefix a gated caller is confined to.
   *
   * ⚠️ Without this, `secrets:own` and `secrets:all` are the same grant on
   * mobile: any plugin holding `ctx.secrets` could read — and overwrite —
   * every other plugin's credentials by naming their key. This is the twin
   * of the node implementation's `ns/` scope; the segment is sanitised
   * because SecureStore rejects anything outside `[A-Za-z0-9._-]`, and the
   * `.` separator cannot be forged from a scope id because `safeSegment`
   * maps the separator itself to `_`.
   *
   * An ungated caller — the kernel, a core service, a test — gets no prefix
   * and sees the whole store, which is what makes `clear()` on the root work.
   */
  private scope(): string {
    const ns = storageNamespace(this[Service.resolveConfig]())
    return ns ? `${safeSegment(ns)}${SEPARATOR}` : ''
  }

  /* ── internals, shared with a namespace ─────────────────────────────── */

  /** @internal */
  async rawGet(key: string): Promise<string | undefined> {
    return (await this.read(key)) ?? undefined
  }

  /** @internal */
  async rawSet(key: string, value: string): Promise<void> {
    const bytes = new TextEncoder().encode(value).length
    if (bytes > MAX_VALUE_BYTES) {
      throw new Error(
        `secrets: ${bytes} bytes exceeds the ${MAX_VALUE_BYTES}-byte limit — ` +
          'envelope-encrypt large values with a key kept here (docs/04 §2.1)',
      )
    }
    // Index first: an orphaned index entry is harmless — `clear` deletes a key
    // that is not there and moves on — while an unindexed secret is one that
    // survives a sign-out.
    await this.remember(key)
    await SecureStore.setItemAsync(key, value, this.config.options)
  }

  /** @internal */
  async rawDelete(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key, this.config.options)
    await this.forget(key)
  }

  private async read(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key, this.config.options)
    } catch {
      /*
       * A read can fail for reasons that are not "absent": a restored backup
       * whose keychain entry did not come with it, or biometrics declined.
       * Treating it as absent asks the user to sign in again, which is
       * recoverable; throwing makes every read of that namespace fail for ever.
       */
      return null
    }
  }

  /** @internal */
  async clearPrefix(prefix: string): Promise<void> {
    const keys = await this.index()
    const mine = keys.filter((key) => key.startsWith(prefix))
    for (const key of mine) {
      await SecureStore.deleteItemAsync(key, this.config.options)
    }
    await this.writeIndex(keys.filter((key) => !key.startsWith(prefix)))
  }

  private async index(): Promise<string[]> {
    const raw = await this.read(INDEX_KEY)
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
    } catch {
      return []
    }
  }

  private async remember(key: string): Promise<void> {
    const keys = await this.index()
    if (keys.includes(key)) return
    await this.writeIndex([...keys, key])
  }

  private async forget(key: string): Promise<void> {
    const keys = await this.index()
    if (!keys.includes(key)) return
    await this.writeIndex(keys.filter((k) => k !== key))
  }

  /**
   * ⚠️ The index is itself a 2048-byte value.
   *
   * At ~40 bytes a key that is roughly fifty keys, which a dozen sources with
   * a handful of secrets each will reach. Oldest-first eviction keeps the
   * index writable; the *secret* stays, it just stops being enumerable — so
   * the failure is "sign-out missed an old key", not "sign-in stopped
   * working". Worth revisiting with a per-namespace index if it bites.
   */
  private async writeIndex(keys: string[]): Promise<void> {
    let kept = keys
    while (new TextEncoder().encode(JSON.stringify(kept)).length > MAX_VALUE_BYTES && kept.length) {
      kept = kept.slice(1)
    }
    await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(kept), this.config.options)
  }
}

/** A prefixed view. `clear()` removes only its own keys — see the node twin. */
class NamespacedSecrets implements SecretsService {
  constructor(
    private readonly root: SecretsExpo,
    private readonly prefix: string,
  ) {}

  get isHardwareBacked(): boolean {
    return this.root.isHardwareBacked
  }

  get maxValueBytes(): number {
    return this.root.maxValueBytes
  }

  async get(key: string): Promise<string | undefined> {
    return this.root.rawGet(this.prefix + key)
  }

  set(key: string, value: string): Promise<void> {
    return this.root.rawSet(this.prefix + key, value)
  }

  delete(key: string): Promise<void> {
    return this.root.rawDelete(this.prefix + key)
  }

  clear(): Promise<void> {
    return this.root.clearPrefix(this.prefix)
  }

  namespace(ns: string): SecretsService {
    return new NamespacedSecrets(this.root, `${this.prefix}${safeSegment(ns)}${SEPARATOR}`)
  }
}

export default SecretsExpo
