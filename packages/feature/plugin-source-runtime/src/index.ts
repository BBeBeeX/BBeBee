/**
 * `plugin-source-runtime` — the one interpreter of source documents.
 *
 * It claims no service key. It reads the `sources` table through
 * `ctx.sources`, and registers one `MediaProvider` per enabled row. Sources
 * are rows; this is the only thing that turns one into something playable, and
 * there is no second interpreter to keep in step.
 *
 * **A source is not a plugin — but each one gets a fiber anyway.** That is
 * what makes disabling one total and free of bespoke cleanup: its isolated
 * `ctx.http` scope (its own cookie jar, its own rate limit, its own host
 * allowlist) and its registration go when the fiber goes. See docs/06 §4.1.
 *
 * This is the M1 slice (docs/11 MD-7): documents are stored, given fibers, and
 * resolved to streams. Search, explore, the rule language and the sandbox are
 * live; login and the tracer are the rest of M2.
 */

import type { Context } from 'cordis'
// Pulls the service and event augmentations (`ctx.sources`, `source/*`) into
// this program. Without it a consumer compiling in isolation sees a bare Context.
import type {} from '@BBeBee/protocol'
import { formatUrn, RuleError } from '@BBeBee/protocol'
import type {
  Disposable,
  JsService,
  MediaProvider,
  SecretsService,
  SettingsService,
  SourceRecord,
  StreamPrefs,
} from '@BBeBee/protocol'
import { DocumentSource, type SourceVars } from './source.js'
import { isInterpretable } from './capabilities.js'

/**
 * How long one rotted rule stays "already reported".
 *
 * Long enough to cover playing through a queue, short enough that a source
 * still broken an hour later says so again.
 */
const RULE_FAILURE_WINDOW_MS = 60_000

export interface SourceRuntimeConfig {
  /**
   * Applied to a source whose document states no `concurrentRate`.
   *
   * Conservative on purpose: the failure mode of guessing high is the user's
   * own server rate-limiting or banning them, which looks like the app being
   * broken (docs/06 §4.3).
   */
  defaultRate?: string
}

/**
 * Everything one live source owns.
 *
 * Held so that a change to one document tears down exactly that source and
 * nothing else — the user sees the edit on the next play, with no restart.
 */
interface LiveSource {
  record: SourceRecord
  /** Kept so a sign-out can drop the realm along with the credentials. */
  source: DocumentSource
  dispose: Disposable
}

export class SourceRuntime {
  private readonly live = new Map<string, LiveSource>()
  /** `sourceId\0block.field` → when it was last reported. See §7. */
  private readonly reportedFailures = new Map<string, number>()
  /**
   * In-memory mirror of `source_vars`, per source.
   *
   * `src.vars.get` has to be synchronous — a script calling it from inside a
   * `{{ }}` placeholder has nowhere to await — so the table is read once at
   * start and written through on every put.
   */
  private readonly vars = new Map<string, Map<string, string>>()
  /** Set by `useJs` when `ctx.js` exists. See `apply`. */
  private js: JsService | undefined
  /** Set by `useSecrets`. Holds the cookie jar's key, so sign-out must reach it. */
  private secrets: SecretsService | undefined
  /**
   * Set by `useSettings`. Holds the third-party master switch, so a toggle in
   * settings is total: no live fiber, no provider, no cookie use.
   */
  private settings: SettingsService | undefined

  constructor(
    private readonly ctx: Context,
    private readonly config: SourceRuntimeConfig = {},
  ) {}

  /** Bring every enabled source up, and keep the set in step with the table. */
  async start(): Promise<Disposable> {
    await this.sync()

    // Every handler is fire-and-forget from an event, so each needs its own
    // catch: an unhandled rejection here would surface far from its cause,
    // and — worse — could reject inside `ctx.emit`, taking the import that
    // triggered it down with the report the user was waiting for.
    const off = [
      this.ctx.on('source/imported', () => this.safely('sync', () => this.sync())),
      this.ctx.on('source/changed', (id) => this.safely(`reload ${id}`, () => this.reload(id))),
      this.ctx.on('source/removed', (id) => this.safely(`stop ${id}`, () => this.stop(id))),
    ]

    return () => {
      for (const dispose of off) dispose()
      for (const id of [...this.live.keys()]) this.stop(id)
    }
  }

  /** Run a background reaction without letting it escape as a rejection. */
  private safely(what: string, run: () => void | Promise<void>): void {
    try {
      const result = run()
      if (result) {
        void result.catch((error: unknown) => {
          this.ctx.logger.warn(`source-runtime: ${what} failed: ${String(error)}`)
        })
      }
    } catch (error) {
      this.ctx.logger.warn(`source-runtime: ${what} failed: ${String(error)}`)
    }
  }

  /**
   * Adopt (or drop) the sandbox.
   *
   * Every live source is restarted, because a realm belongs to a source and
   * capabilities are derived from what can run *now*: a document whose `@js:`
   * rules just became runnable must re-derive `search` from `false` to `true`,
   * and one that just lost the sandbox must do the reverse rather than keep
   * offering a button that no longer works.
   */
  /**
   * Adopt (or drop) the credential store.
   *
   * No restart: nothing derived from it is cached, and it is only read during
   * sign-out. A build without one simply has nothing there to clear.
   */
  useSecrets(secrets: SecretsService | undefined): void {
    this.secrets = secrets
  }

  useJs(js: JsService | undefined): void {
    if (this.js === js) return
    this.js = js
    for (const id of [...this.live.keys()]) this.stop(id)
    this.safely('adopting the js service', () => this.sync())
  }

  /**
   * Adopt (or drop) the settings service.
   *
   * No realm is rebuilt: the switch only moves sources between "wanted" and
   * not, which `sync` applies by stopping or starting fibers. An imported
   * source stopped this way keeps its rows, so flipping the switch back on
   * restores it warm rather than re-importing anything.
   */
  useSettings(settings: SettingsService | undefined): void {
    this.settings = settings
    this.safely('applying the third-party sources switch', () => this.sync())
  }

  /** Start what should be running, stop what should not. */
  private async sync(): Promise<void> {
    /*
     * Enabled *and* something this runtime can interpret.
     *
     * Not every `sources` row is a document: the catalogue's foreign keys need
     * one per source id, so the scanner writes a rules-free row for `local`.
     * Starting a fiber for it registered a second provider on `local` and
     * collided with `plugin-source-local`'s real one — see `isInterpretable`.
     *
     * The master switch sits beside `enabled` rather than inside it: `enabled`
     * is one source's row, this is the user's word that third-party documents
     * run at all, and keeping them apart means disabling the switch backfills
     * nothing and re-enabling restores everything as it was.
     */
    const thirdPartyEnabled = this.settings?.getSync().thirdPartySourcesEnabled ?? true
    const wanted = new Map(
      this.ctx.sources.sources
        .filter((r) => r.enabled && thirdPartyEnabled && isInterpretable(r.doc))
        .map((r) => [r.id, r] as const),
    )

    for (const [id, current] of this.live) {
      const next = wanted.get(id)
      // A document that did not change keeps its fiber: rebuilding it would
      // drop a warm cookie jar for nothing.
      if (!next) this.stop(id)
      else if (next.docHash !== current.record.docHash) this.replace(next)
    }
    for (const [id, record] of wanted) {
      if (this.live.has(id)) continue
      try {
        /*
         * Vars before registration, not lazily on first script use.
         *
         * `auth.status` is derived from whether the source has its variable,
         * and a UI reads it as soon as the provider appears — so a provider
         * registered before its vars had loaded reported `anonymous` on every
         * restart for a source the user had signed into. One indexed query per
         * source is a cheap price for a correct first paint.
         */
        await this.loadVars(id)
        this.startOne(record)
      } catch (error) {
        // Same guard as `replace`: one source that will not start must not
        // stop the rest of the set from starting.
        this.ctx.logger.warn(`source-runtime: ${id} would not start: ${String(error)}`)
      }
    }
  }

  /**
   * Read one source's `source_vars` into the mirror.
   *
   * Called before a source is registered, and again before its realm is built.
   *
   * `src.vars.get` has to be synchronous — a script calling it inside a `{{ }}`
   * placeholder has nowhere to await — so the values must be in memory before
   * any script runs *and* before `auth.status` is first read. Idempotent, so
   * the second call is free.
   */
  private async loadVars(sourceId: string): Promise<void> {
    if (this.vars.has(sourceId)) return
    const mirror = new Map<string, string>()
    // Set before awaiting, so two concurrent realm builds share one mirror
    // rather than the second replacing the first's loaded values.
    this.vars.set(sourceId, mirror)
    try {
      // Through the service: `source_vars` is a core table and this plugin
      // holds only `db:read:core`, so the *write* side has to go through the
      // owner. Reading through the same door keeps the two in one place.
      for (const [key, value] of Object.entries(await this.ctx.sources.readVars(sourceId))) {
        mirror.set(key, value)
      }

      // Credentials come from the keychain, not the table. Read after the
      // table so a value left there by an older build is superseded rather
      // than winning.
      const secrets = this.secrets?.namespace(sourceId)
      if (secrets) {
        for (const key of this.secretKeysFor(sourceId)) {
          const stored = await secrets.get(key)
          if (stored !== undefined) mirror.set(key, stored)
        }
      }
    } catch (error) {
      // A source with no vars still works; one whose vars failed to load asks
      // the user to sign in again. Neither is worth failing a search over.
      this.ctx.logger.warn(`source-runtime: could not load vars for ${sourceId}: ${String(error)}`)
    }
  }

  private reload(id: string): void {
    this.ctx.logger.info(`source-runtime: reloading source "${id}"`)
    const record = this.ctx.sources.source(id)
    if (!record || !record.enabled) {
      this.stop(id)
      return
    }
    // An enable/disable emits `source/changed` too, so this fires for edits
    // that did not touch the document. Rebuilding then would drop a warm
    // cookie jar to arrive at exactly the same source.
    const current = this.live.get(id)
    if (current && current.record.docHash === record.docHash) {
      this.vars.delete(id)
      void this.loadVars(id)
      return
    }
    this.replace(record)
  }

  private replace(record: SourceRecord): void {
    this.stop(record.id)
    try {
      this.startOne(record)
    } catch (error) {
      // A source that will not start must not leave the runtime believing it
      // did, nor take the others with it.
      this.ctx.logger.warn(`source-runtime: ${record.id} would not start: ${String(error)}`)
    }
  }

  /**
   * Give one source its own HTTP stack and register it.
   *
   * `ctx.isolate('http')` is what makes two Navidrome servers unable to see
   * each other's cookies, and one slow source unable to stall another's
   * requests. Every other service stays shared, because only the named key is
   * isolated (docs/03 §5).
   */
  private startOne(record: SourceRecord): void {
    const scoped = this.ctx.isolate('http')

    // The scope carries the source's own storage namespace and egress
    // allowlist: `net:host/*` is held by this plugin because the hosts are not
    // known until a document is imported, and it is narrowed here, per source,
    // to what that document declared (docs/03 §7, docs/06 §8).
    //
    // Deliberately *not* passed: a `jar` name and a `rateLimit`. `ctx.http`
    // has no cookie jar and no rate limiter in the M1 slice, so setting them
    // would be config that reads as live and enforces nothing — the exact
    // shape `net:host/…` had before anything checked it. `concurrentRate` is
    // still parsed and surfaced through `capabilities.rateLimit`, so the
    // document's declaration is visible; it is not yet obeyed, and M2 wires
    // both to the same scope.
    const sourceCtx = scoped.intercept('http', {
      scopeId: record.id,
      allowedHosts: [...record.allowedHosts],
    })

    const source = new DocumentSource(record, {
      http: sourceCtx.http,
      // Optional: a build with no sandbox runs every document that does not
      // need one, and derives the affected capabilities as absent for the
      // rest rather than offering a button that cannot work.
      ...(this.js ? { js: this.js } : {}),
      vars: this.varsFor(record.id),
      signOut: () => this.forget(record.id, sourceCtx),
      forget: (key) => this.forgetVar(record.id, key),
      trackPayload: (id) => this.trackPayload(record.id, id),
      albumPayload: (id) => this.albumPayload(record.id, id),
      log: (message) => this.ctx.logger.info(message),
    })

    /*
     * Expiry is an event, not an error (docs/06 §5): the source stays
     * registered and its cached catalogue stays browsable, so the shell can
     * offer a re-login in place rather than making the source vanish.
     */
    const offAuth = source.provider().auth.onStatusChange((status) => {
      if (status.state !== 'expired') return
      this.safely('reporting an expired session', () =>
        this.ctx.emit('source/auth-expired', record.id),
      )
    })

    const off = sourceCtx.sources.register(this.reporting(source.provider()))
    this.ctx.logger.info(`source-runtime: started source "${record.id}" (${record.name})`)
    this.live.set(record.id, {
      record,
      source,
      // Wrapped in a local closure: the disposer that came back through the
      // service proxy is not the one a fiber would collect (docs/03 §2).
      // `source.dispose()` frees the realm — a WASM allocation that nothing
      // else will ever collect.
      dispose: () => {
        off()
        offAuth()
        source.dispose()
      },
    })
  }

  /**
   * Erase every trace of one source's session.
   *
   * Three stores, and forgetting any one of them leaves the user signed in
   * through a route they cannot see (docs/06 §5.1):
   *
   *  - the **cookie jar**, emptied *and* forgotten, so a restart does not
   *    rehydrate it;
   *  - the **secrets namespace**, which holds the jar's encryption key;
   *  - **`source_vars`**, which is where the password itself lives.
   *
   * The realm goes too: `src.cache` may hold a token minted from any of them.
   */
  private async forget(sourceId: string, scoped: Context): Promise<void> {
    const failures: string[] = []

    try {
      await scoped.http.cookies.destroy(sourceId)
    } catch (error) {
      failures.push(`cookies: ${String(error)}`)
    }
    try {
      await this.secrets?.namespace(sourceId).clear()
    } catch (error) {
      failures.push(`secrets: ${String(error)}`)
    }
    try {
      await this.ctx.sources.clearVars(sourceId)
      this.vars.delete(sourceId)
    } catch (error) {
      failures.push(`vars: ${String(error)}`)
    }

    // Rebuilt on next use, without whatever the old one had cached.
    this.live.get(sourceId)?.source?.dispose()

    /*
     * Every store is attempted before anything is reported. A sign-out that
     * stopped at the first failure would leave the *later* stores intact —
     * and the later ones here are the password itself.
     */
    if (failures.length > 0) {
      throw new Error(`sign-out did not fully complete — ${failures.join('; ')}`)
    }
  }

  /**
   * `src.vars` for one source, backed by `source_vars`.
   *
   * Read through a memory mirror so `src.vars.get` can stay synchronous — a
   * script calling it inside a template placeholder cannot await.
   *
   * ⚠️ **Where a value is written depends on whether it is a credential.**
   * docs/06 §5 and docs/07 §4.1 both say credentials never land in readable
   * storage, and `source_vars` is a plain SQLite table — the value is
   * greppable in the database *and* in the WAL. So the source variable and
   * every declared login field go to `ctx.secrets`, which is the OS keychain
   * on mobile and an encrypted store on desktop; `source_vars` keeps only what
   * a document put there itself through `src.vars.put`, which is a cache key
   * or a region code rather than a password.
   *
   * A build with no `ctx.secrets` refuses to store a credential rather than
   * falling back to the table. Silently downgrading the guarantee is worse
   * than failing to sign in: the user cannot see that it happened.
   */
  private varsFor(sourceId: string): SourceVars {
    const secretKeys = this.secretKeysFor(sourceId)
    return {
      load: () => this.loadVars(sourceId),
      get: (key) => this.vars.get(sourceId)?.get(key),
      put: async (key, value) => {
        const mirror = this.vars.get(sourceId) ?? new Map<string, string>()
        mirror.set(key, value)
        this.vars.set(sourceId, mirror)

        if (secretKeys.has(key)) {
          const secrets = this.secrets?.namespace(sourceId)
          if (!secrets) {
            throw new Error(
              `sources: ${sourceId} cannot store credentials — this build has no ctx.secrets, ` +
                'and writing them to the database would break the promise in docs/06 §5',
            )
          }
          await secrets.set(key, value)
          return
        }

        await this.ctx.sources
          .writeVar(sourceId, key, value)
          .catch((error: unknown) => {
            // A failed write costs persistence, not correctness: the value is
            // in the mirror and the session keeps working until a restart.
            this.ctx.logger.warn(`sources: could not persist ${sourceId}.${key}: ${String(error)}`)
          })
      },
    }
  }

  /**
   * Drop one stored value, from wherever it lives.
   *
   * Used to undo a sign-in the backend refused: leaving the credentials behind
   * would leave the source reporting "authenticated" with a password that had
   * just been rejected.
   */
  private async forgetVar(sourceId: string, key: string): Promise<void> {
    this.vars.get(sourceId)?.delete(key)
    if (this.secretKeysFor(sourceId).has(key)) {
      await this.secrets?.namespace(sourceId).delete(key)
      return
    }
    await this.ctx.sources.clearVars(sourceId, key).catch(() => undefined)
  }

  /**
   * Which of a source's keys are credentials.
   *
   * `var` always — it is the field whose documented content is
   * `username:password` — plus every id the document's own login form
   * declares. Anything else a script stores is its own business.
   */
  private secretKeysFor(sourceId: string): Set<string> {
    const doc = this.ctx.sources.source(sourceId)?.doc
    return new Set([
      'var',
      ...(doc?.loginUi ?? []).map((field) => field.id),
      ...(doc?.sourceGroup?.includes('subsonic') ? ['user', 'password'] : []),
    ])
  }

  /**
   * Wrap a provider so a rotted rule is *reported*, not just thrown.
   *
   * `source/rule-failed` is what drives `fail_count` and the stale badge
   * (docs/06 §7). It was declared and never emitted, so the badge could never
   * appear and the one signal telling a user to go and re-import their source
   * did not exist. The wrapper is the only place that sees every RuleError
   * from every entry point.
   *
   * Emission is **coalesced per source and rule**, as docs/07 §5 says: one
   * rotted rule against a hundred-track queue is one fact, not a hundred
   * events, and the badge needs the fact.
   */
  private reporting(provider: MediaProvider): MediaProvider {
    const report = (error: unknown): never => {
      if (error instanceof RuleError) this.reportRuleFailure(provider.sourceId, error)
      throw error
    }
    return {
      ...provider,
      get capabilities() {
        return provider.capabilities
      },
      getTrack: (id: string) => provider.getTrack(id).catch(report),
      resolveStream: (id: string, prefs: StreamPrefs) =>
        provider.resolveStream(id, prefs).catch(report),
    }
  }

  /**
   * Emit `source/rule-failed`, at most once per rule per window.
   *
   * Without this, playing a queue through a source whose `ruleStream.url` has
   * rotted emits one event per track — a hundred identical events for a badge
   * that only needs to appear once, each of them waking every listener.
   */
  private reportRuleFailure(sourceId: string, error: RuleError): void {
    const key = `${sourceId}\u0000${error.rule.block}.${error.rule.field}`
    const now = Date.now()
    const last = this.reportedFailures.get(key)
    // `now - last` is compared as an absolute span: a clock that jumps
    // backwards (an NTP correction, a timezone-naive host) would otherwise
    // make the difference negative and reopen the window on every failure.
    if (last !== undefined && Math.abs(now - last) < RULE_FAILURE_WINDOW_MS) return

    this.reportedFailures.set(key, now)
    this.ctx.emit('source/rule-failed', sourceId, error.rule)
  }

  /** Forget a stopped source's coalescing state, so a fix reports again. */
  private forgetFailures(sourceId: string): void {
    for (const key of [...this.reportedFailures.keys()]) {
      if (key.startsWith(`${sourceId}\u0000`)) this.reportedFailures.delete(key)
    }
  }

  private stop(id: string): void {
    const current = this.live.get(id)
    if (!current) return
    this.live.delete(id)
    this.ctx.logger.info(`source-runtime: stopped source "${id}"`)
    // An edited or restarted source starts clean: the user may have just
    // fixed the rule, and the next failure is news again.
    this.forgetFailures(id)
    current.dispose()
  }

  /**
   * The raw payload a search stored for this track.
   *
   * This is why `tracks.raw_json` exists: `ruleStream` runs hours after the
   * search that produced the track, possibly offline, and must not re-run it.
   */
  private trackPayload(
    sourceId: string,
    trackId: string,
  ): Promise<Record<string, unknown> | undefined> {
    return this.payloadOf('tracks', formatUrn({ sourceId, kind: 'track', id: trackId }))
  }

  /**
   * The payload a browse stored for an album.
   *
   * This is what makes `getAlbum` possible: it holds the `childUrl` — the URL
   * of the album's own document — which nothing else in the app knows and
   * which cannot be derived from an id.
   */
  private albumPayload(
    sourceId: string,
    albumId: string,
  ): Promise<Record<string, unknown> | undefined> {
    return this.payloadOf('albums', formatUrn({ sourceId, kind: 'album', id: albumId }))
  }

  private async payloadOf(
    table: 'tracks' | 'albums',
    urn: string,
  ): Promise<Record<string, unknown> | undefined> {
    // The table name is a literal from the two call sites above, never input.
    const row = await this.ctx.db.get<{ raw_json: string | null }>(
      `SELECT raw_json FROM ${table} WHERE urn = ?`,
      [urn],
    )
    if (!row?.raw_json) return undefined
    try {
      const parsed: unknown = JSON.parse(row.raw_json)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
    } catch {
      return undefined
    }
  }
}

export { DocumentSource } from './source.js'
export { capabilitiesFor, isInterpretable, parseRate } from './capabilities.js'

export const name = 'plugin-source-runtime'
export const inject = ['http', 'db', 'sources']

/**
 * ⚠️ `async` is not decoration. Cordis decides "is this a class?" with
 * `!!func.prototype`, and a plain `function apply(…)` has one — so it would be
 * `new`-ed and the disposer returned here discarded, leaving every source
 * registered forever after unload. An async function has no prototype.
 * `conventions.test.ts` fails the build on the other shape.
 */
export async function apply(ctx: Context, config: SourceRuntimeConfig = {}) {
  ctx.logger.info('plugin-source-runtime: loaded')
  const runtime = new SourceRuntime(ctx, config)

  /*
   * `js` is optional, and a nested `inject` is how cordis says that.
   *
   * Every key in a plugin's own `inject` is *required* — a fiber whose store
   * lacks one never activates — so listing `js` there would mean a build with
   * no sandbox has no source runtime either, and every document, scripted or
   * not, would stop working.
   *
   * This callback runs when the sandbox exists and its disposer when it goes,
   * and each re-syncs: capabilities are derived from what can run *now*, so a
   * source whose `@js:` rules just became runnable has to re-derive them.
   */
  const withJs = ctx.inject(['js'], (scoped) => {
    runtime.useJs(scoped.js)
    return () => runtime.useJs(undefined)
  })

  // Optional for the same reason, and separately: a build may have a sandbox
  // and no credential store, or the reverse.
  const withSecrets = ctx.inject(['secrets'], (scoped) => {
    runtime.useSecrets(scoped.secrets)
    return () => runtime.useSecrets(undefined)
  })

  // The settings service carries the third-party master switch. Optional like
  // the rest: a build with no settings service runs every imported source,
  // which is the switch's own default.
  const withSettings = ctx.inject(['settings'], (scoped) => {
    const offSettings = scoped.on('settings/changed', () => runtime.useSettings(scoped.settings))
    runtime.useSettings(scoped.settings)
    return () => {
      offSettings()
      runtime.useSettings(undefined)
    }
  })

  /*
   * ⚠️ Started *after* both injections, not before.
   *
   * Starting a source loads its stored credentials, and those live in
   * `ctx.secrets` — so a runtime that started first read the keychain before
   * it had one, found nothing, and reported every signed-in source as
   * anonymous on the first launch after a restart. The one visible symptom
   * was a sign-in prompt that should not have been there.
   */
  const stop = await runtime.start()

  return () => {
    withSettings.dispose()
    withSecrets.dispose()
    withJs.dispose()
    stop()
  }
}

export default { name, inject, apply }
