/**
 * One imported source, presented as a `MediaProvider`.
 *
 * This is the M1 slice (docs/11 MD-7): a source row, a fiber, a `=` template,
 * and a stream. `ruleStream` is rendered against the stored track payload and
 * the active `StreamPrefs`; everything else in docs/06 — the selector engines,
 * search, explore, login, `@js:` — arrives with the rest of the runtime.
 *
 * The important property even at this size is that `ruleStream` depends only
 * on `{{source.*}}`, `{{track.*}}` and `{{prefs.*}}` — never on state left
 * over from a search. The user plays from their library hours later, offline
 * from whatever produced the track, and resolution must still work.
 */

import {
  AuthError,
  hostAllowedBy,
  NetworkError,
  NotFoundError,
  ProviderError,
  RateLimitError,
  RuleError,
  UnavailableError,
} from '@BBeBee/protocol'
import type {
  AuthFlow,
  BrowseEntry,
  AlbumDetail,
  Artist,
  ArtistDetail,
  ArtworkRef,
  PlaylistDetail,
  PlaylistItem,
  BrowseResult,
  DebugStep,
  PageRequest,
  Paged,
  SearchQuery,
  SearchResult,
  AuthStatus,
  Capabilities,
  Disposable,
  HttpService,
  JsRealm,
  JsService,
  MediaProvider,
  ProviderAuth,
  QrCodeSession,
  SourceRecord,
  StreamHandle,
  Lyrics,
  LyricsFormat,
  StreamPrefs,
  StreamQuality,
  Track,
  TraceEvent,
} from '@BBeBee/protocol'
import { formatUrn, STREAM_QUALITIES } from '@BBeBee/protocol'
import {
  engineAvailable,
  evaluate,
  parseRule,
  type JsEvaluator,
  type RuleSite,
  type TemplateScope,
} from '@BBeBee/source-rules'
import { evaluateRule, evaluateUrlTemplate } from '@BBeBee/source-rules'
import { artistKey } from '@BBeBee/toolkit'
import { capabilitiesFor, hasRules } from './capabilities.js'
import { SRC_SHIM, createSourceHost, type HostDeps } from './host.js'
import { TraceCollector, tracedHttp } from './trace.js'
import { fetchDocument, parseUrlObject, type FetchSite } from './fetch.js'
import { coerceDuration, evaluateListRule, rowToTrack } from './list-rule.js'

/** What the runtime needs from its context. Kept narrow so tests need no kernel. */
export interface SourceDeps {
  http: HttpService
  /**
   * The sandbox, when the host has one.
   *
   * Optional so a build without `ctx.js` still runs every document that does
   * not need it — which is most of them. A document that *does* reports its
   * affected capabilities as absent rather than offering a button that fails.
   */
  js?: JsService
  cookies?: HostDeps['cookies']
  /**
   * Persistent per-source values, behind `src.vars`.
   *
   * Credential-grade (docs/06 §3.4): a document keeps its session token here,
   * so it is never exported and is cleared by sign-out.
   */
  vars?: SourceVars
  /**
   * Erase everything this source holds: its jar, its secrets, its vars.
   *
   * Owned by the runtime rather than by the source, because two of the three
   * live in the source's *isolated scope* — the jar belongs to `ctx.http`, the
   * secrets to `ctx.secrets` — and the provider cannot reach them.
   */
  signOut?(): Promise<void>
  /** The track payload a search stored, keyed by track id. */
  trackPayload?(id: string): Promise<Record<string, unknown> | undefined>
  /** Drop one stored value — used to undo a sign-in the backend refused. */
  forget?(key: string): Promise<void>
  /** The album payload a browse stored. Carries the `childUrl` `getAlbum` fetches. */
  albumPayload?(id: string): Promise<Record<string, unknown> | undefined>
  /**
   * Where a note about a rule that half-worked goes.
   *
   * Optional so a test can construct a source without a context, but supplied
   * in production: a rule dropping rows is the kind of thing that otherwise
   * only shows up as "the search is missing things".
   */
  log?(message: string): void
}

/**
 * Auth synthesised from the document.
 *
 * A document with no login fields is `flow: 'none'` and its two methods are
 * nearly trivial — which is precisely the case that proves requiring `auth` on
 * every provider costs nothing. `variable` is the flow a Subsonic-shaped
 * document uses: the user types one string, and the document decides what it
 * means.
 */
class DocumentAuth implements ProviderAuth {
  readonly flow: AuthFlow
  private explicit: AuthStatus | undefined
  private readonly sourceIdForErrors: string
  /** The one refresh every caller awaits. See `refresh`. */
  private inFlight: Promise<void> | undefined
  private readonly listeners = new Set<(s: AuthStatus) => void>()

  constructor(
    record: SourceRecord,
    private readonly session: SessionStore,
  ) {
    this.sourceIdForErrors = record.id
    /*
     * Order matters: a document with `loginUi` is a *form*, even if it also
     * carries a `variableComment` for something else. The form is what the
     * user is shown, and offering a single-line variable box for a two-field
     * login is a screen nobody can complete.
     */
    this.flow =
      record.doc.loginType === 'qrcode' || record.doc.loginQrJs
        ? { kind: 'qrcode', pollIntervalMs: 2000 }
        : record.doc.loginUi?.length
          ? { kind: 'form', fields: record.doc.loginUi, submitTo: record.doc.loginUrl ?? '' }
          : record.doc.variableComment
            ? { kind: 'variable', comment: record.doc.variableComment }
            : { kind: 'none' }
  }

  /** Called by the runtime when a response says the session is over. */
  markExpired(): void {
    if (this.status.state === 'expired') return
    this.set({ state: 'expired' })
  }

  markAuthenticated(): void {
    this.explicit = undefined
    for (const listener of this.listeners) listener(this.status)
  }

  /**
   * Derived, not snapshotted.
   *
   * ⚠️ A snapshot taken in the constructor is read *before* the persisted
   * variable has loaded, so every restart reported `anonymous` for a source
   * the user had signed into — and the only visible symptom was a sign-in
   * prompt that should not have been there.
   *
   * A `variable` source with no variable is anonymous rather than
   * authenticated: reporting otherwise makes every screen offer content it
   * cannot fetch, and the first failure then reads as a broken backend.
   */
  get status(): AuthStatus {
    if (this.explicit) return this.explicit
    if (this.flow.kind === 'none') return { state: 'authenticated' }
    if (this.flow.kind === 'qrcode') {
      const stored =
        this.session.get('refresh_token') !== undefined ||
        this.session.get('token') !== undefined ||
        this.session.get('var') !== undefined
      return stored ? { state: 'authenticated' } : { state: 'anonymous' }
    }
    // A form source keeps its credentials under the field ids it declared, not
    // under `var`. Checking only `var` reported every signed-in form source as
    // anonymous — the same class of bug as reading the status before the vars
    // had loaded, one level down.
    const stored =
      this.flow.kind === 'form'
        ? this.flow.fields.every(
            (field) => field.type === 'checkbox' || this.session.get(field.id) !== undefined,
          )
        : this.session.get('var') !== undefined
    return stored ? { state: 'authenticated' } : { state: 'anonymous' }
  }

  /**
   * Store what the user typed.
   *
   * `input.var` is the one field a `variable` flow has (docs/06 §5). It goes
   * to `source_vars` rather than into the document, so it is never exported
   * with the source and never appears in a trace.
   */
  async signIn(input: Record<string, string> = {}): Promise<void> {
    if (this.flow.kind === 'qrcode') {
      const token = input.refresh_token ?? input.token ?? input.var
      if (token) {
        await this.session.put('refresh_token', token)
        await this.session.put('var', token)
      }
      this.explicit = undefined
      for (const listener of this.listeners) listener(this.status)
      return
    }

    if (this.flow.kind === 'variable') {
      const variable = input.var ?? input.variable
      if (!variable) {
        throw new AuthError('this source needs its variable set before it can sign in')
      }
      await this.session.put('var', variable)
    } else if (this.flow.kind === 'form') {
      /*
       * Every declared field is stored, then the login request is made. The
       * fields go to the same credential-grade store as the variable, so a
       * password typed into a form is no more exposed than one pasted into a
       * variable box (docs/06 §5).
       */
      for (const field of this.flow.fields) {
        const value = input[field.id]
        // A checkbox that is off sends nothing, and that is a real answer —
        // only a missing text field is a missing credential.
        if (value === undefined && field.type !== 'checkbox') {
          throw new AuthError(`this source needs "${field.label}" to sign in`)
        }
        if (value !== undefined) await this.session.put(field.id, value)
      }

      /*
       * ⚠️ If the login is refused, the credentials do not stay.
       *
       * `status` is derived from whether the fields are stored, so persisting
       * them and *then* failing left the source reporting "authenticated" with
       * a password the backend had just rejected — and every later request
       * failed with no prompt to fix it, because as far as the app was
       * concerned the user was signed in.
       */
      try {
        await this.session.login()
      } catch (error) {
        for (const field of this.flow.fields) await this.session.forget?.(field.id)
        throw error
      }
    }
    this.explicit = undefined
    for (const listener of this.listeners) listener(this.status)
  }

  /** Start a QR code login session. */
  async createQrSession(): Promise<QrCodeSession> {
    if (this.flow.kind !== 'qrcode' || !this.session.createQrSession) {
      throw new AuthError('this source does not support QR code login', this.sourceIdForErrors)
    }
    return this.session.createQrSession()
  }

  /**
   * Re-run the login, once, however many callers asked.
   *
   * A burst of 401s is the normal shape of an expired session — every request
   * in flight fails at the same moment — and re-authenticating once per
   * failure would hammer the backend with logins and race them against each
   * other. One in-flight promise; everyone awaits it (docs/06 §5).
   */
  async refresh(): Promise<void> {
    /*
     * ⚠️ Once expired, no more attempts until the user signs in again.
     *
     * Single-flighting only collapses a *concurrent* burst. Ten sequential
     * searches against a permanently-401 backend still produced ten login
     * POSTs — measured — which is a credential-stuffing pattern aimed at the
     * user's own server, and every one of them was already known to be
     * hopeless: the previous refresh had just failed for the same reason.
     *
     * `signIn` clears this, because that is the user supplying new
     * information; nothing else does.
     */
    if (this.explicit?.state === 'expired') {
      throw new AuthError('this source is signed out — sign in again', this.sourceIdForErrors)
    }
    if (this.flow.kind !== 'form' && this.flow.kind !== 'qrcode') {
      // Nothing to re-run: a `variable` source's credentials are static, so an
      // expired session there needs the *user*, not a retry.
      throw new AuthError('this source cannot refresh its own session')
    }
    this.inFlight ??= (this.flow.kind === 'qrcode' && this.session.refresh
      ? this.session.refresh()
      : this.session.login())
      .then(() => {
        this.explicit = undefined
        for (const listener of this.listeners) listener(this.status)
      })
      .finally(() => {
        this.inFlight = undefined
      })
    return this.inFlight
  }

  /**
   * Leave nothing behind.
   *
   * ⚠️ The most commonly missed step in the whole design, and the reason it is
   * one call rather than three: the persisted cookie jar, the secrets
   * namespace and `source_vars` all have to go, and forgetting any one of them
   * leaves the user signed in through a route they cannot see.
   */
  async signOut(): Promise<void> {
    await this.session.clear()
    // Cleared, not overridden: with the variable gone the derived answer is
    // already `anonymous`, and an override would survive a later sign-in that
    // wrote a new one.
    this.explicit = undefined
    for (const listener of this.listeners) listener(this.status)
  }

  onStatusChange(cb: (s: AuthStatus) => void): Disposable {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }

  private set(status: AuthStatus): void {
    this.explicit = status
    for (const listener of this.listeners) listener(status)
  }
}

export class DocumentSource {
  private readonly auth: DocumentAuth
  /** Learned from a HEAD when the document does not say. */
  private seekable: boolean | undefined
  /**
   * The source's realm, created on first use and kept for its lifetime.
   *
   * Kept rather than created per rule because `jsLib` and `src.cache` are
   * *state a document builds*: a token cached during search has to still be
   * there when the stream is resolved. Per-call realms would make `src.cache`
   * a no-op with a plausible name.
   */
  private realm: JsRealm | undefined
  private realmSetup: Promise<JsRealm> | undefined
  private readonly hostCache = new Map<string, unknown>()
  /**
   * Set only while `debug()` runs.
   *
   * On the instance rather than threaded through every call because tracing
   * has to reach *every* evaluation — including the ones inside `renderOptional`
   * and the list rule — and a parameter on each would be forgotten by exactly
   * the one that later turns out to matter.
   */
  private tracing: TraceCollector | undefined

  constructor(
    private readonly record: SourceRecord,
    private readonly deps: SourceDeps,
  ) {
    this.auth = new DocumentAuth(record, {
      get: (key) => deps.vars?.get(key),
      put: async (key, value) => {
        await deps.vars?.put(key, value)
      },
      clear: async () => {
        await deps.signOut?.()
      },
      forget: async (key) => {
        await deps.forget?.(key)
      },
      login: () => this.login(),
      createQrSession: () => this.createQrSession(),
      refresh: () => this.refreshSession(),
    })
    // ⚠️ No rule is evaluated here. `seekable` used to be rendered in the
    // constructor against an empty scope, so a perfectly reasonable document
    // — `seekable: '={{prefs.saveData}}'` — threw a RuleError during
    // construction, which propagated through `startOne` out of `apply` and
    // marked the *whole plugin* FAILED. Every source became unusable, on
    // every boot. A rule is evaluated when it has a scope to be evaluated in.
  }

  get sourceId(): string {
    return this.record.id
  }

  /**
   * Tear down anything this source holds.
   *
   * A realm is a WASM allocation; a source removed or disabled while the app
   * runs must not leave one behind.
   */
  dispose(): void {
    this.realm?.dispose()
    this.realm = undefined
    this.realmSetup = undefined
  }

  /**
   * The evaluator handed to the rule engine, or `undefined` with no sandbox.
   *
   * Its presence is what makes `@js:` an available engine, so a build without
   * `ctx.js` derives capabilities that leave the affected features off rather
   * than offering them and failing (docs/06 §1.3).
   */
  private get js(): JsEvaluator | undefined {
    if (!this.deps.js) return undefined
    return async (expression, scope) => {
      const realm = await this.realmFor()
      /*
       * Wrapped in a function, not evaluated bare.
       *
       * A `@js:` body is an *expression* in every document that exists —
       * `auth()`, `result.map(x => x.id)` — but authors also write multi
       * statement bodies ending in a `return`. Wrapping accepts both: a bare
       * expression becomes the completion value of the arrow, and a body with
       * `return` works because it is a function body.
       */
      return realm.eval(`(async () => { ${bodyOf(expression)} })()`, scope as Record<string, unknown>)
    }
  }

  /**
   * The realm, created once.
   *
   * The in-flight promise is memoised, not just the result: two rules
   * evaluated concurrently would otherwise each build a realm, and the second
   * would silently replace the first — taking `src.cache` and anything `jsLib`
   * had set up with it.
   */
  private realmFor(): Promise<JsRealm> {
    /*
     * ⚠️ A poisoned realm is replaced, not reused.
     *
     * `ctx.js` retires a realm that breached a limit — every later call on it
     * rejects, by contract. Handing that same dead realm back for ever meant
     * one `@js:` rule timing out once bricked *every* scripted rule for that
     * source until the app restarted: search, stream, everything, with an
     * error about a disposed realm rather than about the rule that overran.
     *
     * Rebuilt lazily on next use, which also re-runs `jsLib` — the only state
     * lost is `src.cache`, which is TTL-bounded scratch space by definition.
     */
    if (this.realm && !this.realm.disposed) return Promise.resolve(this.realm)
    if (this.realm) {
      this.realm = undefined
      this.realmSetup = undefined
    }
    this.realmSetup ??= this.buildRealm()
    return this.realmSetup
  }

  private async buildRealm(): Promise<JsRealm> {
    const js = this.deps.js
    if (!js) throw new Error('no js service')

    // Before the realm exists, so `src.vars.get` — which cannot await — has
    // its values by the time any script can call it.
    await this.deps.vars?.load?.()

    const realm = await js.createRealm()
    const jar = this.deps.http.cookies?.jar(this.record.id)
    const hostCookies =
      this.deps.cookies ??
      (jar
        ? {
            get: async (name: string, url?: string) => {
              await jar.ready
              const cookies = url ? await jar.get(url) : await jar.all()
              const found = cookies.find((c) => c.name === name)
              return found?.value
            },
            set: async (name: string, value: string, url?: string) => {
              await jar.ready
              const parsedUrl = new URL(url || this.record.doc.sourceUrl || 'http://localhost')
              const domain = parsedUrl.hostname.replace(/^www\./, '')
              const dotDomain = domain.startsWith('.') ? domain : '.' + domain
              await jar.set([
                {
                  name,
                  value,
                  domain: dotDomain,
                  path: '/',
                  secure: true,
                  httpOnly: false,
                  expiresAt: Date.now() + 180 * 86400 * 1000,
                },
              ])
            },
            all: async (url?: string) => {
              await jar.ready
              const cookies = url ? await jar.get(url) : await jar.all()
              const res: Record<string, string> = {}
              for (const c of cookies) {
                res[c.name] = c.value
              }
              return res
            },
          }
        : undefined)

    const host = createSourceHost({
      http: this.deps.http,
      sourceId: this.record.id,
      assertAllowed: (url) => {
        this.assertAllowed(url)
      },
      vars: {
        get: (key) => this.deps.vars?.get(key),
        // Fire-and-forget for a *script*: `src.vars.put` is called from inside
        // a template placeholder, which has nowhere to await. A failure there
        // is logged by the writer rather than surfaced to the rule.
        put: (key, value) => void this.deps.vars?.put(key, value),
      },
      cookies: hostCookies,
      // A document's own log lines reach the app logger as always, and an
      // active trace as well — on the test screen they are the narration of
      // what a script did between its requests.
      log: (message) => {
        this.deps.log?.(message)
        this.tracing?.log(message)
      },
    })

    for (const [name, fn] of Object.entries(host.functions)) {
      realm.expose(name, fn as (...args: unknown[]) => unknown)
    }
    // The shim first, so a document's own `jsLib` can use `src`.
    await realm.preload(SRC_SHIM)
    if (this.record.doc.jsLib) await realm.preload(this.record.doc.jsLib)

    this.realm = realm
    return realm
  }

  get capabilities(): Capabilities {
    return capabilitiesFor(this.record.doc, {
      ...(this.seekable !== undefined ? { seekable: this.seekable } : {}),
      searchable: this.searchable,
      searchArtists: this.searchArtists,
      browsable: this.browsable,
      recommendable: this.recommendable,
      lyrics: this.lyricable,
      library: this.librariable,
    })
  }

  /**
   * The provider handed to `ctx.sources`.
   *
   * Optional members are **absent, not stubbed**: this slice serves the
   * required core and nothing else, which makes it the regression test that
   * every screen checks `capabilities` before reaching for a member.
   */
  /**
   * Whether this document's search rules can actually run in this build.
   *
   * A document may describe a search whose rules need an engine this build
   * does not have — `@css:` without a markup parser, `@js:` without `ctx.js`.
   * Declaring `search: true` then produces a capability the UI offers and the
   * runtime cannot honour, which is exactly the over-declaration deriving
   * capabilities exists to prevent (docs/06 §1.3).
   */
  private get searchable(): boolean {
    const doc = this.record.doc
    if (!doc.searchUrl || !doc.ruleSearch?.trackList) return false
    return rulesRunnable(
      [
        // `header` is rendered on every request this source makes, so a header
        // rule needing a missing engine fails the search just as surely as the
        // search rules would — and was passing the gate, producing exactly the
        // over-declaration §1.3 exists to prevent.
        ...(doc.header ? [doc.header] : []),
        ...Object.values(doc.ruleSearch).filter((r): r is string => typeof r === 'string'),
      ],
      [doc.searchUrl],
      { js: this.deps.js !== undefined },
    )
  }

  /**
   * Whether this document can search *artists*, on the same two-part test as
   * `searchable`. A document may point the artist rules at their own URL or
   * at the track search's document; both shapes run through the same test.
   */
  private get searchArtists(): boolean {
    const doc = this.record.doc
    if (!doc.searchArtistUrl && !doc.searchUrl) return false
    if (!doc.ruleSearchArtist?.trackList) return false
    return rulesRunnable(
      [
        ...(doc.header ? [doc.header] : []),
        ...Object.values(doc.ruleSearchArtist).filter((r): r is string => typeof r === 'string'),
      ],
      [doc.searchArtistUrl ?? doc.searchUrl!],
      { js: this.deps.js !== undefined },
    )
  }

  /**
   * Whether this build can actually browse this document.
   *
   * Same two-part test as `searchable`, for the same reason: the document has
   * to describe it, *and* the engines its rules need have to exist here.
   * `exploreUrl` is excluded — a URL template needs no engine.
   */
  private get browsable(): boolean {
    const doc = this.record.doc
    if (!doc.exploreUrl || !doc.ruleExplore?.trackList) return false
    return rulesRunnable(
      [
        ...(doc.header ? [doc.header] : []),
        ...Object.values(doc.ruleExplore).filter((r): r is string => typeof r === 'string'),
        // `ruleTrackList` is what a descent lands on. A document whose explore
        // rules run but whose track listing cannot is browsable *to a dead
        // end*, which is worse than not offering the button.
        ...Object.values(doc.ruleTrackList ?? {}).filter((r): r is string => typeof r === 'string'),
      ],
      [doc.exploreUrl],
      { js: this.deps.js !== undefined },
    )
  }

  /**
   * Whether this build can actually serve this document's recommendation feed.
   *
   * Same two-part test as `browsable`, minus the descent: the rule has to be
   * described and runnable. `recommendUrl` is optional — a source whose
   * recommendations are a curated list rather than an endpoint lets the rule
   * build its rows itself, so only the rule is required here.
   */
  private get recommendable(): boolean {
    const doc = this.record.doc
    if (!doc.ruleRecommend?.trackList) return false
    return rulesRunnable(
      [
        ...(doc.header ? [doc.header] : []),
        ...Object.values(doc.ruleRecommend).filter((r): r is string => typeof r === 'string'),
      ],
      [...(doc.recommendUrl ? [doc.recommendUrl] : [])],
      { js: this.deps.js !== undefined },
    )
  }

  /**
   * Whether an album screen can be served.
   *
   * `ruleAlbum` describes the album's own fields; `ruleTrackList` its songs.
   * Both are needed — an album detail with no tracks is a screen with nothing
   * on it — and both have to be runnable here.
   */
  private get albumable(): boolean {
    const doc = this.record.doc
    if (!doc.ruleAlbum?.title || !doc.ruleTrackList?.trackList) return false
    return rulesRunnable(
      [
        ...(doc.header ? [doc.header] : []),
        ...Object.values(doc.ruleAlbum).filter((r): r is string => typeof r === 'string'),
        ...Object.values(doc.ruleTrackList).filter((r): r is string => typeof r === 'string'),
      ],
      [],
      { js: this.deps.js !== undefined },
    )
  }

  private get lyricable(): boolean {
    const doc = this.record.doc
    if (!doc.ruleLyric?.lyric) return false
    return rulesRunnable(
      [
        ...(doc.header ? [doc.header] : []),
        ...Object.values(doc.ruleLyric).filter((r): r is string => typeof r === 'string'),
      ],
      [],
      { js: this.deps.js !== undefined },
    )
  }

  private get artistable(): boolean {
    const doc = this.record.doc
    if (!doc.ruleArtist) return false
    return rulesRunnable(
      Object.values(doc.ruleArtist).filter((r): r is string => typeof r === 'string'),
      [],
      { js: this.deps.js !== undefined },
    )
  }

  private get playlistable(): boolean {
    const doc = this.record.doc
    if (!doc.rulePlaylist) return false
    return rulesRunnable(
      Object.values(doc.rulePlaylist).filter((r): r is string => typeof r === 'string'),
      [],
      { js: this.deps.js !== undefined },
    )
  }

  private get librariable(): boolean {
    const doc = this.record.doc
    if (!doc.ruleLibrary?.list) return false
    return rulesRunnable(
      Object.values(doc.ruleLibrary).filter((r): r is string => typeof r === 'string'),
      [],
      { js: this.deps.js !== undefined },
    )
  }

  provider(): MediaProvider {
    // `capabilities` is a getter, not a value. Snapshotting it at registration
    // froze `streaming.seekable` at its default of true, so what the HEAD
    // probe learned never reached the UI — an over-declaration of exactly the
    // kind deriving capabilities exists to prevent (docs/11 §4.10).
    const capabilities = () => this.capabilities
    // `MediaProvider & { debug }`: the tracer is a structural extra that
    // `ctx.sources` looks for (docs/06 §10) rather than part of the interface
    // every provider must satisfy — `plugin-source-local` has no rules to
    // trace and should not have to pretend otherwise.
    const provider: MediaProvider & { debug(step: DebugStep): AsyncIterable<TraceEvent> } = {
      sourceId: this.record.id,
      displayName: this.record.name,
      get capabilities() {
        return capabilities()
      },
      auth: this.auth,
      getTrack: (id) => this.getTrack(id),
      resolveStream: (id, prefs) => this.resolveStream(id, prefs),
      ping: () => this.ping(),
      // `search` is present when *either* interface is runnable, not just when
      // tracks are: a backend that only offers a user/artist search still has
      // an interface the search screen can toggle, and hiding it behind the
      // track capability made that search unreachable.
      ...(this.searchable || this.searchArtists
        ? { search: (q, page) => this.search(q, page) }
        : {}),
      ...(this.browsable ? { browse: (nodeId, page) => this.browse(nodeId, page) } : {}),
      ...(this.recommendable ? { recommend: (page?: PageRequest) => this.recommend(page) } : {}),
      ...(this.albumable ? { getAlbum: (id: string, page?: PageRequest) => this.getAlbum(id, page) } : {}),
      ...(this.artistable ? { getArtist: (id: string) => this.getArtist(id) } : {}),
      ...(this.playlistable ? { getPlaylist: (id: string, page?: PageRequest) => this.getPlaylist(id, page) } : {}),
      ...(this.lyricable ? { getLyrics: (id: string) => this.getLyrics(id) } : {}),
      ...(this.librariable
        ? {
            library: {
              list: (kind, page) => this.libraryList(kind, page),
              setSaved: async () => {},
              createPlaylist: async () => '',
              addToPlaylist: async () => {},
              removeFromPlaylist: async () => {},
              reorderPlaylist: async () => {},
              deletePlaylist: async () => {},
            },
          }
        : {}),
      // Always present: a source whose rules cannot run is exactly the one a
      // user needs to trace, so gating this on a capability would withdraw the
      // tool at the moment it is wanted.
      debug: (step: DebugStep) => this.debug(step),
    }
    return provider
  }

  async getTrack(id: string): Promise<Track> {
    const payload = (await this.payloadFor(id)) ?? {}
    /*
     * The payload is the search/browse row the track came from, so it carries
     * the identity a bare id cannot: who made it, how long it is, what cover
     * it wears. A payload-less track (the URN known but the row lost) still
     * answers with what the id alone can say.
     *
     * ⚠️ Every list-rule value arrives as text — `evaluateParsed` maps to
     * `string[]` by contract — so the duration a document wrote as a number
     * comes back as `"228000"` and needs the same coercion a track row gets.
     */
    const title =
      typeof payload.title === 'string' && payload.title.trim()
        ? payload.title
        : lastSegment(this.record.sourceUrl)
    const artist = typeof payload.artist === 'string' ? payload.artist : undefined
    const artists: Track['artists'] = artist
      ? [
          {
            urn: formatUrn({
              sourceId: this.record.id,
              kind: 'artist',
              id:
                typeof payload.artistId === 'string' && payload.artistId
                  ? payload.artistId
                  : artistKey(artist),
            }),
            name: artist,
            role: 'main',
            ordinal: 0,
          },
        ]
      : []
    let durationMs: number | undefined
    try {
      durationMs = coerceDuration(payload.durationMs, this.record.id, 'getTrack')
    } catch {
      // A payload duration the backend wrote oddly is dropped, not fatal —
      // getTrack is an identity answer, not a re-run of the rules.
    }
    return {
      urn: formatUrn({ sourceId: this.record.id, kind: 'track', id }),
      title,
      artists,
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(typeof payload.album === 'string' && payload.album ? { albumTitle: payload.album } : {}),
      ...(typeof payload.artwork === 'string' && payload.artwork
        ? { artwork: { id: payload.artwork, sourceUrl: payload.artwork } }
        : {}),
      available: true,
    }
  }

  /**
   * Search the backend.
   *
   * Render `searchUrl`, fetch it, run `ruleSearch` over what came back. The
   * page number is 1-based and reaches the template as `{{page}}`; a document
   * that ignores it simply returns the same page, which is why the runtime
   * stops when a page repeats rather than trusting `hasMore`.
   *
   * `query.types` is honoured per half: a query naming `['artist']` fetches
   * and runs only the artist rules, a query naming nothing gets everything the
   * source can serve. That is what lets the search screen put a toggle on each
   * *interface* a source has — songs and artists — instead of one switch for
   * the whole source (docs/06 §4.1).
   */
  async search(query: SearchQuery, page?: PageRequest): Promise<SearchResult> {
    const doc = this.record.doc
    const wantsTracks = !query.types?.length || query.types.includes('track')
    const wantsArtists =
      (!query.types?.length || query.types.includes('artist')) &&
      this.searchArtists &&
      !!doc.ruleSearchArtist
    const trackSearch = wantsTracks && this.searchable && doc.searchUrl && doc.ruleSearch

    if (!trackSearch && !wantsArtists) {
      throw new RuleError(
        query.types?.length
          ? `this source cannot search for ${query.types.join(' or ')}`
          : 'this source has no searchUrl or ruleSearch',
        { block: 'ruleSearch', field: 'trackList' },
        this.record.id,
      )
    }

    const pageNumber = pageNumberOf(page)
    const scope: TemplateScope = {
      source: this.sourceScope(),
      key: query.text,
      page: pageNumber,
      baseUrl: this.record.sourceUrl,
    }

    const result: SearchResult = {}
    /** The track search's fetch, reused by artist rules that share its document. */
    let fetched: Awaited<ReturnType<typeof fetchDocument>> | undefined

    if (trackSearch) {
      // A URL template, not a selector: it builds the request rather than
      // selecting out of a response, so `=` is optional (docs/06 §2.3).
      const rendered = await evaluateUrlTemplate(
        doc.searchUrl!,
        scope,
        { block: 'searchUrl', field: 'searchUrl', sourceId: this.record.id },
        this.js,
      )
      const target = parseUrlObject(rendered)
      this.assertAllowed(target.url)

      fetched = await this.withReauth(() =>
        this.fetchChecked(target, scope, 'searchUrl'),
      )

      const { rows, dropped, incomplete, firstError } = await evaluateListRule(doc.ruleSearch!, {
        document: fetched.value,
        scope: { ...scope, baseUrl: fetched.baseUrl },
        sourceId: this.record.id,
        block: 'ruleSearch',
        ...(this.js ? { js: this.js } : {}),
      })
      if (incomplete > 0) {
        this.deps.log?.(
          `${this.record.id}: ruleSearch left ${incomplete} optional field(s) unset: ${String(firstError)}`,
        )
      }
      if (dropped > 0) {
        // Counted rather than hidden: a search quietly returning three of
        // twenty results reads as a thin backend, not as a broken rule.
        this.deps.log?.(
          `${this.record.id}: ruleSearch dropped ${dropped} result(s) missing trackId or title`,
        )
      }

      const tracks = rows.map((row) => rowToTrack(row, this.record.id, 'ruleSearch'))

      /*
       * The payload is what makes `ruleStream` work hours later and offline from
       * the search that produced the track (docs/06 §4). `ctx.sources` writes it
       * to `tracks.raw_json`; `scopeFor` reads it back as `{{track.*}}`.
       *
       * Without it, resolution can only see the URN's id — so a document whose
       * stream URL needs anything else (`{{track.quality}}` from `$.suffix`, a
       * per-item token, a CDN path) worked during the search that fetched it and
       * failed after a restart, which is the hardest kind of bug to attribute.
       */
      const payloads: Record<string, unknown> = {}
      for (const [i, row] of rows.entries()) {
        const track = tracks[i]
        if (track) payloads[track.urn] = payloadFor(row)
      }

      result.tracks = {
        items: tracks,
        // The backend rarely says, and inventing a total produces a progress
        // bar that lies (docs/06 §4.3).
        hasMore: tracks.length > 0,
        ...(tracks.length > 0 ? { cursor: String(pageNumber + 1) } : {}),
      }
      result.payloads = payloads
    }

    /*
     * Artists, when the document describes how to search for them.
     *
     * The artist rules either run over the track search's document (no URL of
     * their own) or over a second fetch. A failing artist search degrades
     * rather than fails the search: tracks the user asked for must not vanish
     * because a secondary endpoint answered badly.
     */
    if (wantsArtists) {
      try {
        const artistDoc = doc.searchArtistUrl
          ? await this.fetchSearchDocument(doc.searchArtistUrl, scope, 'searchArtistUrl')
          : fetched ?? (await this.fetchSearchDocument(doc.searchUrl!, scope, 'searchUrl'))
        const artistRows = await evaluateListRule(doc.ruleSearchArtist!, {
          document: artistDoc.value,
          scope: { ...scope, baseUrl: artistDoc.baseUrl },
          sourceId: this.record.id,
          block: 'ruleSearchArtist',
          ...(this.js ? { js: this.js } : {}),
        })
        const artists = artistRows.rows
          .map((row) => artistFromRow(row, this.record.id))
          .filter((a): a is Artist => a !== undefined)
        result.artists = {
          items: artists,
          hasMore: artists.length > 0,
          ...(artists.length > 0 ? { cursor: String(pageNumber + 1) } : {}),
        }
      } catch (error) {
        this.deps.log?.(
          `${this.record.id}: artist search failed (tracks kept): ${String(error)}`,
        )
      }
    }

    return result
  }

  /**
   * One search fetch, shared by the track and artist halves of `search`.
   *
   * The artist rules either run over the track search's document (no URL of
   * their own) or over a second fetch; both come through here so the login
   * check and the trace attribution are the same shape.
   */
  private async fetchSearchDocument(
    urlTemplate: string,
    scope: TemplateScope,
    block: string,
  ): Promise<Awaited<ReturnType<typeof fetchDocument>>> {
    const rendered = await evaluateUrlTemplate(
      urlTemplate,
      scope,
      { block, field: block, sourceId: this.record.id },
      this.js,
    )
    const target = parseUrlObject(rendered)
    this.assertAllowed(target.url)
    return this.withReauth(() => this.fetchChecked(target, scope, block))
  }

  /** Headers the document declares, rendered against the current scope. */
  private async headers(scope: TemplateScope): Promise<Record<string, string> | undefined> {
    const rule = this.record.doc.header
    if (!rule) return undefined
    const rendered = await evaluateRule(rule, scope, {
      block: 'header',
      field: 'header',
      sourceId: this.record.id,
    }, this.js)
    try {
      const parsed: unknown = JSON.parse(rendered)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v
      return Object.keys(out).length > 0 ? out : undefined
    } catch {
      throw new RuleError(
        'header must render to a JSON object',
        { block: 'header', field: 'header' },
        this.record.id,
      )
    }
  }

  /**
   * Walk the source's own hierarchy.
   *
   * Three stages, and which one applies is carried by the node id rather than
   * inferred:
   *
   *   (no node)  `exploreUrl`  → the source's top-level sections
   *   'explore'  `ruleExplore` → what a section contains, usually albums
   *   'tracks'   `ruleTrackList` → the tracks inside one of those
   *
   * docs/06 §4 draws this as one pipeline because it is: fetch a document,
   * run a list rule over it, and decide per row whether it is a leaf or
   * another node. Only the rule changes between stages.
   */
  async browse(nodeId?: string, page?: PageRequest): Promise<BrowseResult> {
    const doc = this.record.doc
    if (!doc.exploreUrl || !doc.ruleExplore) {
      throw new RuleError(
        'this source has no exploreUrl or ruleExplore',
        { block: 'ruleExplore', field: 'trackList' },
        this.record.id,
      )
    }

    const pageNumber = pageNumberOf(page)
    const scope: TemplateScope = {
      source: this.sourceScope(),
      page: pageNumber,
      baseUrl: this.record.sourceUrl,
    }

    const node = nodeId
      ? decodeNode(nodeId, this.record.id)
      : await this.rootNode(doc.exploreUrl, scope)
    // The root may resolve to a list of sections rather than to a URL, in
    // which case there is nothing to fetch and the sections *are* the answer.
    if (Array.isArray(node)) return { items: node, hasMore: false }

    const rule = node.stage === 'tracks' ? (doc.ruleTrackList ?? doc.ruleExplore) : doc.ruleExplore
    const block = node.stage === 'tracks' ? 'ruleTrackList' : 'ruleExplore'

    const target = parseUrlObject(node.url)
    this.assertAllowed(target.url)
    const fetched = await this.withReauth(() => this.fetchChecked(target, scope, block))

    const { rows, dropped, incomplete, firstError } = await evaluateListRule(rule, {
      document: fetched.value,
      scope: { ...scope, baseUrl: fetched.baseUrl },
      sourceId: this.record.id,
      block,
      // ⚠️ Browse rules may be scripts (`@js:` trackList on a document whose
      // rows are computed, not selected) — the sandbox has to reach this call
      // exactly as it reaches the search path's. Omitting it meant a document
      // that was declared browsable failed its first descent with
      // RuleEngineUnavailableError.
      ...(this.js ? { js: this.js } : {}),
    })
    if (dropped > 0) {
      this.deps.log?.(
        `${this.record.id}: ${block} dropped ${dropped} row(s) missing trackId or title`,
      )
    }
    if (incomplete > 0) {
      this.deps.log?.(
        `${this.record.id}: ${block} left ${incomplete} optional field(s) unset: ${String(firstError)}`,
      )
    }

    const items = rows.map((row) => this.rowToEntry(row, node.stage))

    /*
     * Payloads for the leaves only.
     *
     * A leaf is a track, and a track has to still resolve after a restart by
     * the same route a searched one does (docs/06 §4). A node is a place, not
     * a thing — nothing caches it and nothing plays it.
     */
    const payloads: Record<string, unknown> = {}
    for (const [i, row] of rows.entries()) {
      const entry = items[i]
      if (!entry?.urn) continue
      /*
       * A node's payload keeps its `childUrl` alongside the backend's own
       * fields. That is what `getAlbum` reads back: the URL of the album's
       * document, which nothing else in the app knows and which cannot be
       * derived from an id.
       */
      payloads[entry.urn] = payloadFor(row)
    }

    return {
      items,
      hasMore: items.length > 0,
      ...(items.length > 0 ? { cursor: String(pageNumber + 1) } : {}),
      payloads,
    }
  }

  /**
   * One page of the source's curated recommendations.
   *
   * The explore half of `browse`, standing alone: render the optional seed
   * URL, run the `ruleRecommend` list rule over what it answered (or over
   * nothing, when the rule builds its rows itself), and map the rows exactly
   * as explore rows are mapped — which is what makes a recommendation card
   * and a browse row the same thing to every screen downstream.
   */
  async recommend(page?: PageRequest): Promise<BrowseResult> {
    const doc = this.record.doc
    if (!doc.ruleRecommend?.trackList) {
      throw new RuleError('this source has no ruleRecommend', { block: 'ruleRecommend', field: 'trackList' }, this.record.id)
    }

    const pageNumber = pageNumberOf(page)
    const scope: TemplateScope = {
      source: this.sourceScope(),
      page: pageNumber,
      baseUrl: this.record.sourceUrl,
    }

    let document: unknown = null
    let baseUrl = this.record.sourceUrl
    if (doc.recommendUrl) {
      const rendered = await evaluateUrlTemplate(
        doc.recommendUrl,
        scope,
        { block: 'recommendUrl', field: 'recommendUrl', sourceId: this.record.id },
        this.js,
      )
      const target = parseUrlObject(rendered)
      this.assertAllowed(target.url)
      const fetched = await this.withReauth(() => this.fetchChecked(target, scope, 'ruleRecommend'))
      document = fetched.value
      baseUrl = fetched.baseUrl
    }

    const { rows, dropped, incomplete, firstError } = await evaluateListRule(doc.ruleRecommend, {
      document,
      scope: { ...scope, baseUrl },
      sourceId: this.record.id,
      block: 'ruleRecommend',
      ...(this.js ? { js: this.js } : {}),
    })
    if (dropped > 0) {
      this.deps.log?.(
        `${this.record.id}: ruleRecommend dropped ${dropped} row(s) missing trackId or title`,
      )
    }
    if (incomplete > 0) {
      this.deps.log?.(
        `${this.record.id}: ruleRecommend left ${incomplete} optional field(s) unset: ${String(firstError)}`,
      )
    }

    const items = rows.map((row) => this.rowToEntry(row, 'explore'))

    const payloads: Record<string, unknown> = {}
    for (const [i, row] of rows.entries()) {
      const entry = items[i]
      if (!entry?.urn) continue
      payloads[entry.urn] = payloadFor(row)
    }

    return {
      items,
      hasMore: rows.length > 0,
      ...(rows.length > 0 ? { cursor: String(pageNumber + 1) } : {}),
      payloads,
    }
  }

  /**
   * The top of the tree: either a list of sections, or one URL to run explore on.
   *
   * docs/06 §2.1 calls `exploreUrl` "a JSON array of { title, url }, or a
   * rule". Both readings are useful and they are told apart by what the render
   * produces, not by a flag: a source with one browsable list writes the URL,
   * and one with several writes the array.
   */
  private async rootNode(
    exploreUrl: string,
    scope: TemplateScope,
  ): Promise<BrowseEntry[] | BrowseNode> {
    const rendered = await evaluateUrlTemplate(
      exploreUrl,
      scope,
      { block: 'exploreUrl', field: 'exploreUrl', sourceId: this.record.id },
      this.js,
    )

    const sections = parseSections(rendered)
    if (!sections) return { stage: 'explore', url: rendered }

    return sections.map((section) => ({
      id: encodeNode({ stage: 'explore', url: section.url }, this.record.id),
      title: section.title,
      kind: 'folder' as const,
      leaf: false,
    }))
  }

  /**
   * One list row as a browse entry.
   *
   * `childUrl` decides leaf from node, exactly as docs/06 §2.2 says: an item
   * carrying one is somewhere to go, an item without one is something to play.
   * `kind` is the document's own label where it gave a valid one — it drives
   * the icon and nothing else, so an unrecognised value falls back rather than
   * failing the browse.
   */
  private rowToEntry(row: Record<string, unknown>, stage: BrowseStage): BrowseEntry {
    const child = typeof row.childUrl === 'string' ? row.childUrl.trim() : ''
    const declared = typeof row.kind === 'string' ? row.kind.trim() : ''
    const kind = (BROWSE_KINDS as readonly string[]).includes(declared)
      ? (declared as BrowseEntry['kind'])
      : child
        ? 'folder'
        : 'track'

    const entry: BrowseEntry = {
      // A node's id carries where to go next; a leaf's is the backend's own
      // id, which is what `resolveStream` will be handed.
      id: child
        ? encodeNode({ stage: nextStage(stage), url: child }, this.record.id)
        : String(row.trackId),
      title: String(row.title),
      kind,
      leaf: !child,
    }
    const artist = typeof row.artist === 'string' ? row.artist : undefined
    if (artist) entry.subtitle = artist
    if (typeof row.artwork === 'string') entry.artwork = { id: row.artwork, sourceUrl: row.artwork }

    /*
     * Identity, where the row has one — for nodes too.
     *
     * An album in an explore listing is both somewhere to go *and* something
     * with an identity worth caching, and treating "no urn" as "descend" meant
     * albums were never cached. `getAlbum` then had no document URL to fetch,
     * so the `childUrl → ruleAlbum → ruleTrackList` half of the pipeline had
     * nowhere to start.
     */
    const id = typeof row.trackId === 'string' ? row.trackId : undefined
    if (id) {
      entry.urn = formatUrn({
        sourceId: this.record.id,
        kind: kind === 'album' ? 'album' : kind === 'artist' ? 'artist' : 'track',
        id,
      })
    }
    return entry
  }


  /**
   * Run one feature of this source with everything it does on show.
   *
   * The transport behind the test screen: each `DebugStep` kind maps onto one
   * `MediaProvider` operation, and while it runs every HTTP request the
   * operation makes becomes a trace line (through the `http` getter), every
   * `src.log` line the document prints is mirrored in, and the operation's
   * whole output is handed back as a `value` event. Three properties do the
   * work (docs/06 §10):
   *
   *  - **It streams.** A request to a server that has stopped answering shows
   *    as an `http` line with no status and nothing after it — which is the
   *    diagnosis. Collecting first would show nothing until it gave up.
   *  - **It redacts.** A trace is what gets pasted into a forum thread, and a
   *    Subsonic URL carries a password hash and its salt as a matter of course.
   *  - **A missing feature is an answer, not a crash.** A source whose
   *    document has no `ruleAlbum` block has no album lookup to run, and the
   *    trace says so plainly.
   */
  debug(step: DebugStep): AsyncIterable<TraceEvent> {
    const collector = new TraceCollector(this.secrets())

    // Started, not awaited: the caller iterates while this runs, which is the
    // point. Everything it can throw is reported into the trace instead.
    void this.runTraced(step, collector)
    return collector
  }

  private async runTraced(step: DebugStep, collector: TraceCollector): Promise<void> {
    // ⚠️ One step at a time. Two concurrent traces would interleave into one
    // stream and each would look like the other's requests had failed.
    if (this.tracing) {
      collector.error(new Error('a trace is already running for this source'))
      collector.close()
      return
    }
    this.tracing = collector
    try {
      const doc = this.record.doc
      switch (step.kind) {
        case 'search': {
          if (!doc.searchUrl && !hasRules(doc.ruleSearch)) {
            collector.error(new Error('this source does not implement search — its document has no searchUrl or ruleSearch'))
            break
          }
          const result = await this.search({ text: step.text }, pageOf(step.page))
          const items = result.tracks?.items ?? []
          collector.value('search result', result)
          collector.result(
            items.length > 0
              ? `${items.length} track(s); first: ${items[0]!.title}`
              : 'the rules ran and matched nothing',
          )
          break
        }
        case 'browse': {
          if (!doc.exploreUrl && !hasRules(doc.ruleExplore)) {
            collector.error(new Error('this source does not implement browse — its document has no exploreUrl or ruleExplore'))
            break
          }
          const page = await this.browse(step.nodeId, pageOf(step.page))
          collector.value('browse result', page)
          collector.result(
            page.items.length > 0
              ? `${page.items.length} entr(ies); first: ${page.items[0]!.title}`
              : 'the rules ran and matched nothing',
          )
          break
        }
        case 'album': {
          if (!hasRules(doc.ruleAlbum)) {
            collector.error(new Error('this source does not implement album lookup — its document has no ruleAlbum block'))
            break
          }
          const detail = await this.getAlbum(step.id)
          collector.value('album detail', detail)
          collector.result(`"${detail.title}": ${detail.tracks?.length ?? 0} track(s)`)
          break
        }
        case 'artist': {
          if (!hasRules(doc.ruleArtist)) {
            collector.error(new Error('this source does not implement artist lookup — its document has no ruleArtist block'))
            break
          }
          const detail = await this.getArtist(step.id)
          collector.value('artist detail', detail)
          collector.result(
            `"${detail.name}": ${detail.albums?.length ?? 0} album(s), ` +
              `${detail.topTracks?.length ?? 0} track(s)`,
          )
          break
        }
        case 'playlist': {
          if (!hasRules(doc.rulePlaylist)) {
            collector.error(new Error('this source does not implement playlist lookup — its document has no rulePlaylist block'))
            break
          }
          const detail = await this.getPlaylist(step.id, pageOf(step.page))
          collector.value('playlist detail', detail)
          collector.result(`"${detail.name}": ${detail.tracks?.length ?? 0} track(s)`)
          break
        }
        case 'lyrics': {
          if (!hasRules(doc.ruleLyric)) {
            collector.error(new Error('this source does not implement lyrics — its document has no ruleLyric block'))
            break
          }
          const lyrics = await this.getLyrics(step.id)
          collector.value('lyrics', lyrics ?? null)
          collector.result(lyrics ? 'lyrics found' : 'no lyrics for this track')
          break
        }
        case 'library': {
          if (!doc.ruleLibrary?.list) {
            collector.error(new Error('this source does not implement a library list — its document has no ruleLibrary.list'))
            break
          }
          const page = await this.libraryList(step.list, pageOf(step.page))
          collector.value('library page', page)
          collector.result(`${page.items.length} item(s)`)
          break
        }
        case 'stream': {
          const handle = await this.resolveStream(step.id, {
            quality: step.quality ?? 'normal',
            saveData: false,
            acceptFormats: [],
          })
          collector.value('stream handle', handle)
          collector.result(
            handle.kind === 'remote'
              ? `resolved to ${handle.seekable ? 'a seekable' : 'a non-seekable'} stream`
              : 'resolved to a local file',
          )
          break
        }
        case 'http': {
          // The same scoped HTTP a rule's request would use — allowlist,
          // cookies, rate limits — with the body handed back whole instead of
          // parsed by a rule. The http line itself comes from `tracedHttp`,
          // so a request that never answers still shows.
          const target = parseUrlObject(step.url)
          this.assertAllowed(target.url)
          const started = Date.now()
          const fetched = await fetchDocument(
            tracedHttp(this.deps.http, collector),
            {
              url: target.url,
              options: {
                ...target.options,
                method: step.method,
                ...(step.headers ? { headers: step.headers } : {}),
                ...(step.body !== undefined ? { body: step.body } : {}),
              },
            },
            undefined,
            { sourceId: this.record.id, block: 'debug' },
          )
          collector.value(
            `HTTP ${fetched.status} body (${Date.now() - started}ms, ${fetched.text.length} chars)`,
            fetched.text,
          )
          break
        }
        case 'js': {
          const evaluator = this.js
          if (!evaluator) {
            collector.error(new Error('this build has no JavaScript sandbox, so scripts cannot run'))
            break
          }
          let args: Record<string, unknown> = {}
          if (step.argsJson && step.argsJson.trim()) {
            let parsed: unknown
            try {
              parsed = JSON.parse(step.argsJson)
            } catch (error) {
              collector.error(new Error(`arguments are not valid JSON: ${String(error)}`))
              break
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              collector.error(new Error('arguments must be a JSON object — its keys become variables'))
              break
            }
            args = parsed as Record<string, unknown>
          }
          const started = Date.now()
          // `source` in scope, matching what a rule would see; the user's
          // arguments override it, so a deliberate `source: …` still works.
          const result = await evaluator(step.code, { source: this.sourceScope(), ...args })
          collector.value(`return value (${Date.now() - started}ms)`, result)
          break
        }
      }
    } catch (error) {
      // A RuleError knows which block and field produced it — attribution
      // that costs nothing to carry and saves a round of guessing.
      collector.error(error, error instanceof RuleError ? error.rule : undefined)
    } finally {
      this.tracing = undefined
      collector.close()
    }
  }

  /**
   * `{{source.*}}` — url, name, and the per-source variable.
   *
   * `var` is documented scope (docs/06 §3.2) and is how a Subsonic document
   * reaches the credentials the user typed. It was missing, so every document
   * written to the published example failed on its first request with
   * "{{source.var}} resolved to nothing" — and the fix looked like a rule bug
   * rather than a missing binding.
   */
  private sourceScope(): { url: string; name: string; var?: string } {
    const variable = this.deps.vars?.get('var')
    return {
      url: this.record.sourceUrl,
      name: this.record.name,
      ...(variable === undefined ? {} : { var: variable }),
    }
  }

  /**
   * Values that must never appear in a trace, whatever they look like.
   *
   * The source variable and everything a script stored. Redaction by *shape*
   * catches `t=` and `password=`; this catches the password itself, wherever
   * a document decided to put it.
   */
  private secrets(): string[] {
    const out: string[] = []
    const add = (value: string | undefined) => {
      if (!value || value.length < 3) return
      out.push(value)
    }

    const variable = this.deps.vars?.get('var')
    if (variable) {
      add(variable)
      // A `user:password` variable is usually split before use, so the halves
      // are what actually reach a URL — the whole string never appears.
      for (const part of variable.split(':')) add(part)
    }

    // ⚠️ And every field the login form declared. A `form` source keeps its
    // password under whatever id the document chose, so a list that knew only
    // about `var` redacted nothing at all for the flow where the credential is
    // most obviously a credential.
    for (const field of this.record.doc.loginUi ?? []) add(this.deps.vars?.get(field.id))

    return out
  }

  /**
   * Perform the document's `loginUrl` request.
   *
   * The stored fields are in scope as `{{login.*}}`, so a document writes its
   * own body — form-encoded, JSON, whatever the backend wants — rather than
   * the runtime guessing at a shape. Whatever session the response sets lands
   * in the source's cookie jar on the way past, which is the entire mechanism
   * for most self-hosted backends.
   */
  private async login(): Promise<void> {
    const url = this.record.doc.loginUrl
    if (!url) throw new AuthError('this source declares a login form but no loginUrl')

    const login: Record<string, unknown> = {}
    for (const field of this.record.doc.loginUi ?? []) {
      const value = this.deps.vars?.get(field.id)
      if (value !== undefined) login[field.id] = value
    }

    const scope: TemplateScope = {
      source: this.sourceScope(),
      baseUrl: this.record.sourceUrl,
      ...({ login } as Partial<TemplateScope>),
    }
    const rendered = await evaluateUrlTemplate(
      url,
      scope,
      { block: 'loginUrl', field: 'loginUrl', sourceId: this.record.id },
      this.js,
    )
    const target = parseUrlObject(rendered)
    this.assertAllowed(target.url)

    try {
      await fetchDocument(this.http, target, await this.headers(scope), {
        sourceId: this.record.id,
        block: 'loginUrl',
      })
    } catch (error) {
      /*
       * A refused login is an `AuthError` whatever the backend called it. A
       * 403 arriving as a `CapabilityError` or a 500 as a `ProviderError`
       * would each send the retry logic somewhere unhelpful — the caller's
       * question is only ever "did the credentials work?".
       */
      if (error instanceof AuthError) throw error
      throw new AuthError(
        `login failed for ${this.record.id}: ${String(error)}`,
        this.record.id,
        { cause: error },
      )
    }
  }

  private async createQrSession(): Promise<QrCodeSession> {
    if (!this.record.doc.loginQrJs) {
      throw new AuthError('source document has no loginQrJs', this.record.id)
    }
    const evaluated = await this.js!(this.record.doc.loginQrJs, {})
    const sessionData = (evaluated && typeof evaluated === 'object' ? evaluated : {}) as Record<string, unknown>
    const code = String(sessionData.code ?? sessionData.url ?? '')
    const key = String(sessionData.key ?? sessionData.qrcode_key ?? '')
    const expiresAt = typeof sessionData.expiresAt === 'number' ? sessionData.expiresAt : undefined

    return {
      code,
      key,
      ...(expiresAt ? { expiresAt } : {}),
      poll: async () => {
        if (!this.record.doc.loginPollJs) return 'expired'
        const pollRes = await this.js!(this.record.doc.loginPollJs, { key })
        let state: 'pending' | 'scanned' | 'confirmed' | 'expired' = 'pending'
        let token: string | undefined
        if (typeof pollRes === 'string') {
          state = pollRes as 'pending' | 'scanned' | 'confirmed' | 'expired'
        } else if (pollRes && typeof pollRes === 'object') {
          const obj = pollRes as Record<string, unknown>
          state = (obj.state ?? (obj.code === 0 ? 'confirmed' : 'pending')) as
            | 'pending'
            | 'scanned'
            | 'confirmed'
            | 'expired'
          const dataObj =
            obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : undefined
          token =
            typeof obj.token === 'string'
              ? obj.token
              : typeof obj.refresh_token === 'string'
                ? obj.refresh_token
                : typeof dataObj?.refresh_token === 'string'
                  ? dataObj.refresh_token
                  : undefined
        }
        if (state === 'confirmed') {
          if (token) {
            await this.deps.vars?.put('refresh_token', token)
          }
          this.auth.markAuthenticated()
        }
        return state
      },
    }
  }

  private async refreshSession(): Promise<void> {
    if (!this.record.doc.loginRefreshJs) return
    const res = await this.js!(this.record.doc.loginRefreshJs, {})
    if (res && typeof res === 'object') {
      const obj = res as Record<string, unknown>
      const token = (obj.token ?? obj.refresh_token) as string | undefined
      if (token) {
        await this.deps.vars?.put('refresh_token', token)
      }
    }
    this.auth.markAuthenticated()
  }

  /**
   * Run a request, and re-authenticate once if the session turned out to be over.
   *
   * ⚠️ Once. A retry loop against a backend that answers 401 to everything is
   * a login storm, and the second failure is information — it means the stored
   * credentials are wrong, not stale, which needs the user rather than another
   * attempt.
   */
  private async withReauth<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      const canRefresh =
        this.auth.flow.kind === 'form' ||
        (this.auth.flow.kind === 'qrcode' && !!this.record.doc.loginRefreshJs)
      if (!(error instanceof AuthError) || !canRefresh) {
        // Nothing to re-run for a `variable` source: its credentials are
        // static, so an expired session there needs the user.
        if (error instanceof AuthError) this.auth.markExpired()
        throw error
      }
      try {
        await this.auth.refresh()
      } catch {
        this.auth.markExpired()
        throw error
      }
      try {
        return await run()
      } catch (again) {
        if (again instanceof AuthError) this.auth.markExpired()
        throw again
      }
    }
  }

  /**
   * One album: its own fields, and the tracks on it.
   *
   * The last leg of docs/06 §4's pipeline — `childUrl` → `ruleAlbum` →
   * `ruleTrackList`. The album's document URL comes from the payload a browse
   * stored, because it is a URL the *backend* chose and nothing about an id
   * implies it.
   */
  async getAlbum(id: string, page?: PageRequest): Promise<AlbumDetail> {
    const doc = this.record.doc
    const site = { block: 'ruleAlbum', field: 'title' }
    if (!doc.ruleAlbum || !doc.ruleTrackList) {
      throw new RuleError('this source has no ruleAlbum or ruleTrackList', site, this.record.id)
    }

    const payload = (await this.deps.albumPayload?.(id)) ?? {}
    let url = typeof payload.childUrl === 'string' ? payload.childUrl : undefined

    const pageReq: PageRequest = page ?? { limit: 30 }
    const scope: TemplateScope = {
      source: this.sourceScope(),
      album: { id, ...payload },
      page: pageReq,
      baseUrl: this.record.sourceUrl,
    }

    if (!url && doc.ruleAlbum.childUrl) {
      url = await evaluateUrlTemplate(
        doc.ruleAlbum.childUrl,
        scope,
        { block: 'ruleAlbum', field: 'childUrl', sourceId: this.record.id },
        this.js,
      )
    }

    if (!url) {
      /*
       * Not "no such album": the album may be perfectly real and simply never
       * browsed to on this device. Saying which of the two it is saves the
       * user looking for a backend problem that is not there.
       */
      throw new RuleError(
        `no stored document url for album ${id} — browse to it once, so its childUrl is cached`,
        site,
        this.record.id,
      )
    }

    let finalUrl = url
    if (url.includes('{{')) {
      finalUrl = await evaluateUrlTemplate(
        url,
        scope,
        { block: 'ruleAlbum', field: 'childUrl', sourceId: this.record.id },
        this.js,
      )
    } else if (page?.cursor) {
      try {
        const parsedUrl = new URL(finalUrl)
        if (parsedUrl.searchParams.has('page_num')) {
          parsedUrl.searchParams.set('page_num', page.cursor)
          finalUrl = parsedUrl.toString()
        } else if (parsedUrl.searchParams.has('pn')) {
          parsedUrl.searchParams.set('pn', page.cursor)
          finalUrl = parsedUrl.toString()
        } else if (parsedUrl.searchParams.has('page')) {
          parsedUrl.searchParams.set('page', page.cursor)
          finalUrl = parsedUrl.toString()
        }
      } catch {
        // Fall back to original finalUrl if URL parsing fails
      }
    }

    const target = parseUrlObject(finalUrl)
    this.assertAllowed(target.url)
    const fetched = await this.withReauth(() => this.fetchChecked(target, scope, 'ruleAlbum'))

    const albumScope: TemplateScope = { ...scope, baseUrl: fetched.baseUrl }
    const field = async (name: string, rule: string | undefined): Promise<string | undefined> => {
      if (!rule) return undefined
      const values = await evaluate(rule, {
        document: fetched.value,
        scope: albumScope,
        site: { block: 'ruleAlbum', field: name, sourceId: this.record.id },
        vars: new Map(),
        ...(this.js ? { js: this.js } : {}),
      })
      return values[0]
    }

    /*
     * `trackListUrl` means the songs live in a *different* document from the
     * album's own fields — common on backends that page a long tracklist. When
     * it is absent the same document holds both, which is the Subsonic shape.
     */
    const listUrl = await field('trackListUrl', doc.ruleAlbum.trackListUrl)
    let listDocument: unknown = fetched.value
    let listBase = fetched.baseUrl
    if (listUrl) {
      const listTarget = parseUrlObject(listUrl)
      this.assertAllowed(listTarget.url)
      const listFetched = await fetchDocument(this.http, listTarget, await this.headers(scope), this.traceSite('ruleTrackList'))
      listDocument = listFetched.value
      listBase = listFetched.baseUrl
    }

    const { rows, dropped, incomplete, firstError } = await evaluateListRule(doc.ruleTrackList, {
      document: listDocument,
      scope: { ...albumScope, baseUrl: listBase },
      sourceId: this.record.id,
      block: 'ruleTrackList',
      ...(this.js ? { js: this.js } : {}),
    })
    if (dropped > 0 || incomplete > 0) {
      this.deps.log?.(
        `${this.record.id}: ruleTrackList dropped ${dropped} row(s), left ${incomplete} field(s) unset` +
          (firstError ? `: ${String(firstError)}` : ''),
      )
    }

    const albumUrn = formatUrn({ sourceId: this.record.id, kind: 'album', id })
    const tracks = rows.map((row) => {
      const track = rowToTrack(row, this.record.id, 'ruleTrackList')
      // The listing rarely repeats the album it is a listing *of*.
      track.albumUrn ??= albumUrn
      return track
    })

    const payloads: Record<string, unknown> = {}
    for (const [i, row] of rows.entries()) {
      const track = tracks[i]
      if (track) payloads[track.urn] = payloadFor(row)
    }

    const artist = await field('artist', doc.ruleAlbum.artist)
    const year = numberOr(await field('year', doc.ruleAlbum.year))
    const trackCount = numberOr(await field('trackCount', doc.ruleAlbum.trackCount))
    const artwork = await field('artwork', doc.ruleAlbum.artwork)

    const currentPn = page?.cursor ? Number.parseInt(page.cursor, 10) : 1
    const limit = pageReq.limit ?? 30
    let hasMore: boolean
    let nextCursor: string | undefined

    if (trackCount !== undefined && !Number.isNaN(trackCount)) {
      hasMore = currentPn * limit < trackCount
      nextCursor = hasMore ? String(currentPn + 1) : undefined
    } else {
      hasMore = rows.length >= limit
      nextCursor = hasMore ? String(currentPn + 1) : undefined
    }

    return {
      urn: albumUrn,
      title: (await field('title', doc.ruleAlbum.title)) ?? String(payload.title ?? id),
      artists: artist
        ? [
            {
              urn: formatUrn({ sourceId: this.record.id, kind: 'artist', id: artistKey(artist) }),
              name: artist,
              role: 'main',
              ordinal: 0,
            },
          ]
        : [],
      ...(year !== undefined ? { year } : {}),
      ...(trackCount !== undefined ? { trackCount } : {}),
      ...(artwork ? { artwork: { id: artwork, sourceUrl: artwork } } : {}),
      tracks,
      payloads,
      hasMore,
      ...(nextCursor ? { cursor: nextCursor } : {}),
    }
  }

  /**
   * Lyrics for one track.
   *
   * Evaluated against the track's stored payload rather than a fresh fetch
   * where the document allows it: `ruleLyric.lyric` is often a template over
   * `{{track.*}}` that names a `.lrc` beside the audio, and refetching a
   * search to find that would be absurd.
   */
  async getLyrics(id: string): Promise<Lyrics | undefined> {
    const rules = this.record.doc.ruleLyric
    if (!rules) return undefined

    const payload = (await this.deps.trackPayload?.(id)) ?? {}
    const scope: TemplateScope = {
      source: this.sourceScope(),
      track: { ...payload, id },
      baseUrl: this.record.sourceUrl,
    }

    /*
     * Two shapes, told apart by what the rule produces. A rule yielding a URL
     * means "fetch this and the body is the lyrics"; anything else *is* the
     * lyrics. Documents write both, and requiring a flag to say which would be
     * a field every author forgets.
     */
    const produced = await evaluateRule(
      rules.lyric,
      scope,
      { block: 'ruleLyric', field: 'lyric', sourceId: this.record.id },
      this.js,
    ).catch(() => undefined)
    if (!produced) return undefined

    let content = produced
    if (/^https?:\/\//i.test(produced.trim())) {
      const target = parseUrlObject(produced.trim())
      this.assertAllowed(target.url)
      const fetched = await fetchDocument(this.http, target, await this.headers(scope), this.traceSite('ruleLyric'))
      content = fetched.text
    }
    if (!content.trim()) return undefined

    const declared = rules.format
      ? await this.renderOptionalIn('ruleLyric', 'format', rules.format, scope)
      : undefined
    const offsetMs = numberOr(
      rules.offsetMs
        ? await this.renderOptionalIn('ruleLyric', 'offsetMs', rules.offsetMs, scope)
        : undefined,
    )

    // Sniffed when the document does not say: `[mm:ss.xx]` is what makes a
    // lyric sheet scroll rather than sit there, and it is unambiguous.
    const format: LyricsFormat =
      declared === 'lrc' || declared === 'ttml' || declared === 'plain'
        ? declared
        : /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(content)
          ? 'lrc'
          : 'plain'

    return {
      format,
      content,
      synced: format === 'lrc' || format === 'ttml',
      ...(offsetMs !== undefined ? { offsetMs } : {}),
    }
  }

  /** `renderOptional`, for a block other than `ruleStream`. */
  private async renderOptionalIn(
    block: string,
    field: string,
    rule: string,
    scope: TemplateScope,
  ): Promise<string | undefined> {
    return evaluateRule(rule, scope, { block, field, sourceId: this.record.id }, this.js)
  }

  private async evaluateJsOrRule<T = unknown>(
    rule: string,
    scope: TemplateScope,
    site: RuleSite,
  ): Promise<T> {
    const trimmed = rule.trim()
    if (trimmed.startsWith('@js:')) {
      if (!this.js) throw new RuleError('JS engine required', site, this.record.id)
      return (await this.js(trimmed.slice(4), scope)) as T
    }
    const jsMatch = trimmed.match(/^=(?:\{\{@js:([\s\S]+?)\}\}|@js:([\s\S]+))$/)
    if (jsMatch) {
      if (!this.js) throw new RuleError('JS engine required', site, this.record.id)
      const code = jsMatch[1] ?? jsMatch[2] ?? ''
      return (await this.js(code, scope)) as T
    }
    return (await evaluateRule(rule, scope, site, this.js)) as unknown as T
  }

  async getArtist(id: string): Promise<ArtistDetail> {
    const rules = this.record.doc.ruleArtist
    if (!rules) {
      throw new RuleError('no ruleArtist in source document', { block: 'ruleArtist', field: 'artist' }, this.record.id)
    }
    const scope: TemplateScope = {
      source: this.sourceScope(),
      id,
      artist: { id },
      baseUrl: this.record.sourceUrl,
    }

    const artistUrn = formatUrn({ sourceId: this.record.id, kind: 'artist', id })

    if (rules.artist) {
      const result = await this.withReauth(() =>
        this.evaluateJsOrRule<Record<string, unknown>>(rules.artist!, scope, {
          block: 'ruleArtist',
          field: 'artist',
          sourceId: this.record.id,
        }),
      )
      if (result && typeof result === 'object') {
        const topTracks: Track[] = Array.isArray(result.topTracks)
          ? result.topTracks.map((t: unknown) => {
              const trackObj = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
              return {
                urn:
                  (trackObj.urn as string | undefined) ||
                  formatUrn({
                    sourceId: this.record.id,
                    kind: 'track',
                    id: String(trackObj.id),
                  }),
                title: (trackObj.title as string | undefined) || '',
                artists: (trackObj.artists as Track['artists']) || [
                  { urn: artistUrn, name: (result.name as string | undefined) || id, role: 'main', ordinal: 0 },
                ],
                ...(trackObj.durationMs !== undefined ? { durationMs: trackObj.durationMs as number } : {}),
                ...(trackObj.artwork
                  ? {
                      artwork:
                        typeof trackObj.artwork === 'string'
                          ? { id: trackObj.artwork, sourceUrl: trackObj.artwork }
                          : (trackObj.artwork as ArtworkRef),
                    }
                  : {}),
                available: true,
              }
            })
          : []

        const payloads: Record<string, unknown> = result.payloads
          ? { ...(result.payloads as Record<string, unknown>) }
          : {}
        if (!result.payloads && Array.isArray(result.topTracks)) {
          for (const [idx, item] of result.topTracks.entries()) {
            const track = topTracks[idx]
            if (track) {
              const tid = track.urn.split(':').pop()!
              payloads[track.urn] = {
                ...((item && typeof item === 'object' ? item : {}) as Record<string, unknown>),
                id: tid,
              }
            }
          }
        }

        return {
          urn: (result.urn as string | undefined) || artistUrn,
          name: (result.name as string | undefined) || id,
          ...(result.bio ? { bio: result.bio as string } : {}),
          ...(result.artwork
            ? {
                artwork:
                  typeof result.artwork === 'string'
                    ? { id: result.artwork, sourceUrl: result.artwork }
                    : (result.artwork as ArtworkRef),
              }
            : {}),
          albums: Array.isArray(result.albums)
            ? result.albums.map((a: unknown) => {
                const albumObj = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>
                return {
                  urn:
                    (albumObj.urn as string | undefined) ||
                    formatUrn({
                      sourceId: this.record.id,
                      kind: 'album',
                      id: String(albumObj.id),
                    }),
                  title: (albumObj.title as string | undefined) || (albumObj.name as string | undefined) || '',
                  artists: (albumObj.artists as AlbumDetail['artists']) || [
                    { urn: artistUrn, name: (result.name as string | undefined) || id, role: 'main', ordinal: 0 },
                  ],
                  ...(albumObj.artwork
                    ? {
                        artwork:
                          typeof albumObj.artwork === 'string'
                            ? { id: albumObj.artwork, sourceUrl: albumObj.artwork }
                            : (albumObj.artwork as ArtworkRef),
                      }
                    : {}),
                }
              })
            : [],
          topTracks,
          payloads,
        }
      }
    }

    const name = rules.name ? await this.renderOptionalIn('ruleArtist', 'name', rules.name, scope) : id
    const bio = rules.bio ? await this.renderOptionalIn('ruleArtist', 'bio', rules.bio, scope) : undefined
    const artwork = rules.artwork ? await this.renderOptionalIn('ruleArtist', 'artwork', rules.artwork, scope) : undefined

    return {
      urn: artistUrn,
      name: name || id,
      ...(bio ? { bio } : {}),
      ...(artwork ? { artwork: { id: artwork, sourceUrl: artwork } } : {}),
      albums: [],
      topTracks: [],
    }
  }

  async getPlaylist(id: string, page?: PageRequest): Promise<PlaylistDetail> {
    const rules = this.record.doc.rulePlaylist
    if (!rules) {
      throw new RuleError('no rulePlaylist in source document', { block: 'rulePlaylist', field: 'playlist' }, this.record.id)
    }
    const scope: TemplateScope = {
      source: this.sourceScope(),
      id,
      playlist: { id },
      page: page ?? { limit: 50 },
      baseUrl: this.record.sourceUrl,
    }

    const playlistUrn = formatUrn({ sourceId: this.record.id, kind: 'playlist', id })

    if (rules.playlist) {
      const result = await this.withReauth(() =>
        this.evaluateJsOrRule<Record<string, unknown>>(rules.playlist!, scope, {
          block: 'rulePlaylist',
          field: 'playlist',
          sourceId: this.record.id,
        }),
      )
      if (result && typeof result === 'object') {
        const rawItems: unknown[] = Array.isArray(result.items)
          ? (result.items as unknown[])
          : Array.isArray(result.songs)
            ? (result.songs as unknown[])
            : []
        const items: PlaylistItem[] = rawItems.map((rawItem: unknown, idx: number) => {
          const item = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<string, unknown>
          const trackId = String(item.id || item.onlineId || idx)
          const trackUrn =
            (item.trackUrn as string | undefined) ||
            (item.urn as string | undefined) ||
            formatUrn({ sourceId: this.record.id, kind: 'track', id: trackId })
          return {
            id: String(item.itemId || item.id || idx),
            trackUrn,
            position: (item.position as string | undefined) || String(idx),
            ...(item.addedAt !== undefined ? { addedAt: item.addedAt as number } : {}),
          }
        })
        const tracks: Track[] = rawItems.map((rawItem: unknown, idx: number) => {
          const item = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<string, unknown>
          const trackId = String(item.id || item.onlineId || idx)
          const trackUrn =
            (item.trackUrn as string | undefined) ||
            (item.urn as string | undefined) ||
            formatUrn({ sourceId: this.record.id, kind: 'track', id: trackId })
          const itemArtist = item.artist && typeof item.artist === 'object' ? (item.artist as Record<string, unknown>) : undefined
          const artistName =
            (typeof item.artist === 'string' ? item.artist : undefined) ||
            (typeof itemArtist?.name === 'string' ? itemArtist.name : undefined) ||
            (typeof result.owner === 'string' ? result.owner : '') ||
            ''
          return {
            urn: trackUrn,
            title: (item.title as string | undefined) || '',
            artists: (item.artists as Track['artists']) || (artistName
              ? [
                  {
                    urn: formatUrn({
                      sourceId: this.record.id,
                      kind: 'artist',
                      id: String(item.artistId || itemArtist?.id || artistKey(artistName)),
                    }),
                    name: artistName,
                    role: 'main',
                    ordinal: 0,
                  },
                ]
              : []),
            durationMs: (item.durationMs as number | undefined) ?? (typeof item.duration === 'number' ? item.duration * 1000 : undefined),
            artwork:
              (item.cover || item.coverWebUrl || item.pic || item.artwork)
                ? {
                    id: String(item.cover || item.coverWebUrl || item.pic || item.artwork),
                    sourceUrl: String(item.cover || item.coverWebUrl || item.pic || item.artwork),
                  }
                : undefined,
            available: true,
          }
        })
        const payloads: Record<string, unknown> = result.payloads
          ? { ...(result.payloads as Record<string, unknown>) }
          : {}
        if (!result.payloads) {
          for (const [idx, item] of rawItems.entries()) {
            const track = tracks[idx]
            if (track) {
              const tid = track.urn.split(':').pop()!
              payloads[track.urn] = {
                ...((item && typeof item === 'object' ? item : {}) as Record<string, unknown>),
                id: tid,
              }
            }
          }
        }

        return {
          urn:
            (result.urn as string | undefined) ||
            // A document may canonicalise the playlist's id — a fav folder
            // reached as a bare number or a pasted URL is still one playlist,
            // and every spelling of it must resolve to one URN.
            (typeof result.id === 'string' && result.id
              ? formatUrn({ sourceId: this.record.id, kind: 'playlist', id: result.id })
              : playlistUrn),
          name: (result.name as string | undefined) || (result.title as string | undefined) || id,
          ...(result.description ? { description: String(result.description) } : {}),
          ...(result.artwork
            ? {
                artwork:
                  typeof result.artwork === 'string'
                    ? { id: result.artwork, sourceUrl: result.artwork }
                    : (result.artwork as ArtworkRef),
              }
            : result.cover
              ? { artwork: { id: String(result.cover), sourceUrl: String(result.cover) } }
              : {}),
          ...(result.owner
            ? {
                owner:
                  typeof result.owner === 'string'
                    ? result.owner
                    : (result.owner && typeof result.owner === 'object'
                        ? ((result.owner as Record<string, unknown>).name as string | undefined)
                        : undefined),
              }
            : {}),
          items,
          tracks,
          payloads,
          hasMore: Boolean(result.hasMore),
          ...(result.cursor ? { cursor: String(result.cursor) } : {}),
          ...(result.trackCount !== undefined
            ? { trackCount: Number(result.trackCount) }
            : { trackCount: items.length }),
        }
      }
    }

    return {
      urn: playlistUrn,
      name: id,
      items: [],
      hasMore: false,
    }
  }

  async libraryList(
    kind: 'track' | 'album' | 'artist' | 'playlist',
    page?: PageRequest,
  ): Promise<Paged<{ urn: string; addedAt?: number }>> {
    const rules = this.record.doc.ruleLibrary
    if (!rules?.list) {
      return { items: [], hasMore: false }
    }
    const scope: TemplateScope = {
      source: this.sourceScope(),
      kind,
      page: page ?? { limit: 50 },
      baseUrl: this.record.sourceUrl,
    }
    const result = await this.withReauth(() =>
      this.evaluateJsOrRule<Record<string, unknown> | unknown[]>(rules.list!, scope, {
        block: 'ruleLibrary',
        field: 'list',
        sourceId: this.record.id,
      }),
    )
    if (result && !Array.isArray(result) && typeof result === 'object' && Array.isArray(result.items)) {
      const itemsList = result.items as unknown[]
      return {
        items: itemsList.map((rawItem: unknown) => {
          const item = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<string, unknown>
          return {
            urn:
              typeof rawItem === 'string'
                ? rawItem
                : (item.urn as string | undefined) ||
                  formatUrn({
                    sourceId: this.record.id,
                    kind,
                    id: String(item.id),
                  }),
            ...(item.addedAt !== undefined ? { addedAt: item.addedAt as number } : {}),
          }
        }),
        hasMore: (result.hasMore as boolean | undefined) ?? false,
        ...(result.total !== undefined ? { total: result.total as number } : {}),
        ...(result.cursor ? { cursor: result.cursor as string } : {}),
      }
    }
    if (Array.isArray(result)) {
      return {
        items: result.map((rawItem: unknown) => {
          const item = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<string, unknown>
          return {
            urn:
              typeof rawItem === 'string'
                ? rawItem
                : (item.urn as string | undefined) ||
                  formatUrn({
                    sourceId: this.record.id,
                    kind,
                    id: String(item.id),
                  }),
            ...(item.addedAt !== undefined ? { addedAt: item.addedAt as number } : {}),
          }
        }),
        hasMore: false,
        total: result.length,
      }
    }
    return { items: [], hasMore: false }
  }

  /**
   * The moment a URN becomes bytes.
   *
   * Everything in scope here is either the document's own (`source`), stored
   * with the track (`track`), or the caller's (`prefs`). A rule that reaches
   * for anything else fails with a `RuleError` naming itself, which is what
   * makes the difference between "this source needs updating" and "something
   * went wrong".
   */
  async resolveStream(id: string, prefs: StreamPrefs): Promise<StreamHandle> {
    const rules = this.record.doc.ruleStream
    if (!rules) {
      throw new RuleError(
        `source ${this.record.id} has no ruleStream`,
        { block: 'ruleStream', field: 'url' },
        this.record.id,
      )
    }

    const scope = await this.scopeFor(id, prefs)
    const target = await evaluateRule(
      rules.url,
      scope,
      { block: 'ruleStream', field: 'url', sourceId: this.record.id },
      this.js,
    )

    // The one artifact that leaves this package and is fetched by something
    // else: `ctx.audio` loads it directly, outside the source's scoped http.
    // Without this check the egress allowlist would govern one optional HEAD
    // and nothing that actually moves bytes — nominal, not real.
    this.assertAllowed(target)

    const declaredSeekable = rules.seekable
      ? (await this.renderOptional('seekable', rules.seekable, scope)) !== 'false'
      : undefined
    const probe = declaredSeekable === undefined ? await this.probe(target) : undefined

    const mimeType = (await this.renderOptional('mimeType', rules.mimeType, scope)) ?? probe?.mimeType
    const byteLength =
      numberOr(await this.renderOptional('byteLength', rules.byteLength, scope)) ?? probe?.byteLength
    const expiresAt = numberOr(await this.renderOptional('expiresAt', rules.expiresAt, scope))
    const bitrateKbps = numberOr(await this.renderOptional('bitrateKbps', rules.bitrateKbps, scope))
    const quality = await this.streamQuality(rules.quality, scope)
    const headers = parseHeaders(await this.renderOptional('headers', rules.headers, scope))

    this.seekable = declaredSeekable ?? probe?.seekable ?? this.seekable ?? true

    return {
      kind: 'remote',
      target,
      seekable: this.seekable,
      ...(mimeType ? { mimeType } : {}),
      ...(byteLength ? { byteLength } : {}),
      ...(bitrateKbps ? { bitrateKbps } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      // What actually got served, in the app's vocabulary — so the player can
      // say "you asked for lossless; this is the 192K stream".
      ...(quality ? { quality } : {}),
      ...(headers ? { headers } : {}),
    }
  }

  /**
   * The served tier, as the app names tiers.
   *
   * A value outside `StreamQuality` is a document bug rather than a
   * preference to ignore: the UI would label the stream with something that
   * is not a tier, and nothing downstream can compare it. Absent or empty
   * means the document does not report one, which is fine; unknown is not.
   */
  private async streamQuality(
    rule: string | undefined,
    scope: TemplateScope,
  ): Promise<StreamQuality | undefined> {
    const rendered = await this.renderOptional('quality', rule, scope)
    if (rendered === undefined || rendered.trim() === '') return undefined
    const value = rendered.trim()
    if (!(STREAM_QUALITIES as readonly string[]).includes(value)) {
      throw new RuleError(
        `ruleStream.quality produced ${JSON.stringify(rendered)}, which is not a quality tier`,
        { block: 'ruleStream', field: 'quality' },
        this.record.id,
      )
    }
    return value as StreamQuality
  }

  /**
   * Cheap by contract: one HEAD against the base URL, and no rules run.
   *
   * "Reachable" is the question, not "healthy". A server that refuses HEAD or
   * demands credentials is reachable — reporting it unreachable would make the
   * source list say the network is down when the network is fine.
   */
  async ping(): Promise<boolean> {
    try {
      const res = await this.deps.http({
        url: this.record.sourceUrl,
        method: 'HEAD',
        timeoutMs: 5000,
      })
      if (res.status === 405 || res.status === 501) return true
      if (res.status === 401 || res.status === 403) return true
      return res.status < 500
    } catch {
      return false
    }
  }

  private async scopeFor(id: string, prefs: StreamPrefs): Promise<TemplateScope> {
    const payload = await this.payloadFor(id)
    return {
      source: this.sourceScope(),
      // `id` last, so a stored payload carrying its own `id` cannot displace
      // the one the caller asked to resolve — that would resolve a stream for
      // a different track and look like a backend bug.
      track: { ...(payload ?? {}), id },
      prefs: { ...prefs },
      baseUrl: this.record.sourceUrl,
    }
  }

  private async payloadFor(id: string): Promise<Record<string, unknown> | undefined> {
    if (!this.deps.trackPayload) return undefined
    return this.deps.trackPayload(id)
  }

  /** Optional rules resolve to `undefined` when absent, and throw when broken. */
  private async renderOptional(
    field: string,
    rule: string | undefined,
    scope: TemplateScope,
  ): Promise<string | undefined> {
    if (!rule) return undefined
    return evaluateRule(rule, scope, {
      block: 'ruleStream',
      field,
      sourceId: this.record.id,
    }, this.js)
  }

  /** Refuse a URL to a host this source did not declare. */
  private assertAllowed(target: string): void {
    let host: string
    try {
      // `hostname` keeps IPv6 brackets and may carry a trailing FQDN dot;
      // `declaredHostMatches` normalises both, so `example.org.` cannot get
      // one verdict here and another at the HTTP gate.
      host = new URL(target).hostname
    } catch {
      throw new ProviderError(`ruleStream.url produced a malformed URL`, this.record.id)
    }
    if (!hostAllowedBy(host, this.record.allowedHosts)) {
      throw new UnavailableError(
        `${this.record.id} did not declare ${host}; add it to allowedHosts and re-import`,
        this.record.id,
      )
    }
  }

  /**
   * Ask the server what it will serve.
   *
   * ⚠️ A status code is not a diagnosis, and collapsing them all into
   * `NotFoundError` made three separate lies: a HEAD-refusing server (405/501,
   * which the code itself called common) was reported as a dead URL; an
   * expired session (401/403) skipped the re-login path; and a transient 500
   * became non-retryable, so a blip halted playback and a health check killed
   * a live source.
   */
  private get http(): HttpService {
    return this.tracing ? tracedHttp(this.deps.http, this.tracing) : this.deps.http
  }

  /**
   * Fetch, then ask the document whether the session is still good.
   *
   * `loginCheckJs` exists because no HTTP status reliably signals "the server
   * started answering with the login page again" — plenty of backends serve
   * that with a 200 (docs/06 §5). The document is the only thing that knows,
   * so it is asked, and a `false` becomes an `AuthError` the retry path
   * already understands.
   */
  /**
   * The site for a feature's fetch. During a test-screen run it mirrors the
   * body into the trace — the user asked for the HTTP answer, not only the
   * status line, and this is the one place the decoded text exists before
   * the rule that parses it.
   */
  private traceSite(block: string): FetchSite {
    return {
      sourceId: this.record.id,
      block,
      ...(this.tracing
        ? { onBody: (text: string) => this.tracing?.value(`HTTP body — ${block}`, text) }
        : {}),
    }
  }

  private async fetchChecked(
    target: ReturnType<typeof parseUrlObject>,
    scope: TemplateScope,
    block: string,
  ): Promise<Awaited<ReturnType<typeof fetchDocument>>> {
    const fetched = await fetchDocument(this.http, target, await this.headers(scope), this.traceSite(block))

    const check = this.record.doc.loginCheckJs
    if (check && this.js) {
      const ok = await this.js(check, { ...scope, result: fetched.value } as TemplateScope)
      if (ok === false) {
        throw new AuthError(`the session for ${this.record.id} is no longer valid`, this.record.id)
      }
    }
    return fetched
  }

  private async probe(
    url: string,
  ): Promise<{ seekable: boolean; byteLength?: number; mimeType?: string } | undefined> {
    let head
    try {
      head = await this.deps.http({ url, method: 'HEAD' })
    } catch (error) {
      // Transport failure. Not fatal: plenty of servers dislike HEAD, and the
      // player's own error path handles a target that turns out to be dead.
      if (error instanceof NetworkError) return undefined
      throw error
    }

    if (head.status < 400) {
      const length = Number(head.headers['content-length'] ?? '')
      const mimeType = head.headers['content-type']
      return {
        seekable: (head.headers['accept-ranges'] ?? '').includes('bytes'),
        ...(Number.isFinite(length) && length > 0 ? { byteLength: length } : {}),
        ...(mimeType ? { mimeType } : {}),
      }
    }

    // The server answered, and what it said matters.
    if (head.status === 405 || head.status === 501) return undefined // no HEAD; assume playable
    if (head.status === 404 || head.status === 410) {
      throw new NotFoundError(`${head.status} for ${url}`, this.record.id)
    }
    if (head.status === 401 || head.status === 403) {
      throw new AuthError(`${head.status} for ${url}`, this.record.id)
    }
    if (head.status === 429) {
      throw new RateLimitError(`rate limited by ${new URL(url).hostname}`, 60_000, this.record.id)
    }
    if (head.status >= 500) {
      throw new NetworkError(`${head.status} from ${url}`, this.record.id)
    }
    throw new ProviderError(`${head.status} for ${url}`, this.record.id)
  }
}

/** A page cursor is an opaque string that happens to be a number here. */
function pageNumberOf(page: PageRequest | undefined): number {
  const parsed = Number(page?.cursor ?? '1')
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1
}

/** Whether every rule in a set uses only engines this build can run. */
/**
 * Whether every engine these rules reach exists in this build.
 *
 * `rules` are selectors and are parsed. `urlTemplates` are **not**: a URL
 * template is interpolated, not selected with, so parsing `{{source.url}}/x`
 * as a rule infers a CSS selector and declares the whole document unrunnable
 * — which is precisely what happened to the shipped Subsonic fixture the first
 * time `searchUrl` was added to this check.
 *
 * They are still checked, for one thing: `{{@js:…}}`. A document whose auth
 * lives in its URL is unsearchable without a sandbox however good its rules
 * are, and reporting otherwise is the over-declaration deriving capabilities
 * exists to prevent.
 */
function rulesRunnable(
  rules: readonly (string | undefined)[],
  urlTemplates: readonly (string | undefined)[],
  opts: { js: boolean },
): boolean {
  if (!opts.js && [...rules, ...urlTemplates].some((r) => r && TEMPLATE_JS.test(r))) return false

  return rules.every((rule) => {
    if (!rule) return true
    try {
      return parseRule(rule).alternatives.every((alt) =>
        alt.parts.every((part) =>
          part.atoms.every((atom) => engineAvailable(atom.engine, { js: opts.js })),
        ),
      )
    } catch {
      // A rule this build cannot even parse is not runnable. Refusing the
      // capability is right; the author sees the syntax error when they run it.
      return false
    }
  })
}

/** `{{@js:…}}` — a script inside a template placeholder. */
const TEMPLATE_JS = /\{\{\s*@js:/

function numberOr(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function parseHeaders(value: string | undefined): Record<string, string> | undefined {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') out[k] = v
    }
    return Object.keys(out).length ? out : undefined
  } catch {
    return undefined
  }
}

function lastSegment(url: string): string {
  try {
    const path = new URL(url).pathname
    return decodeURIComponent(path.split('/').filter(Boolean).pop() ?? url)
  } catch {
    return url
  }
}

/**
 * What gets stored as a track's `raw_json`.
 *
 * The backend's own element *plus* the fields the document's rules produced,
 * with the rules winning. Both are needed and neither is enough:
 *
 *  - The raw element is what `{{track.id}}` means for a Subsonic song, and it
 *    carries fields no rule bothered to name.
 *  - The evaluated fields are what the author actually asked for — `quality`
 *    from `$.suffix`, a `streamUrl` assembled from three parts — and several
 *    of them have nowhere else to go: `rowToTrack` maps only the members
 *    `Track` has, so `quality` would otherwise be computed and discarded.
 *
 * Rules win a collision because they are the author's stated intent about that
 * name; the raw element merely happened to use it.
 */
function payloadFor(row: Record<string, unknown>): Record<string, unknown> {
  const { raw, ...evaluated } = row
  const base =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  return { ...base, ...evaluated }
}

/**
 * One artist-search row as an `Artist`.
 *
 * The ListRule fields are track-shaped (`trackId`/`title`), so an artist row
 * borrows them: `trackId` is the backend's id for the person and `title` is
 * their name. A row without either is dropped rather than turned into a
 * nameless artist — the same rule a track row is held to.
 */
function artistFromRow(
  row: Record<string, unknown>,
  sourceId: string,
): Artist | undefined {
  const id = row.trackId !== undefined ? String(row.trackId).trim() : ''
  const name = typeof row.title === 'string' ? row.title.trim() : ''
  if (!id || !name) return undefined
  return {
    urn: formatUrn({ sourceId, kind: 'artist', id }),
    name,
    ...(typeof row.artwork === 'string' && row.artwork
      ? { artwork: { id: row.artwork, sourceUrl: row.artwork } }
      : {}),
  }
}

/* ── browse nodes ─────────────────────────────────────────────────────── */

/** Which rule a node's document should be read with. */
type BrowseStage = 'explore' | 'tracks'

interface BrowseNode {
  stage: BrowseStage
  url: string
}

/** Descending from a section lands on tracks. There is no deeper stage. */
function nextStage(from: BrowseStage): BrowseStage {
  return from === 'explore' ? 'tracks' : 'tracks'
}

const BROWSE_KINDS = ['folder', 'album', 'artist', 'playlist', 'track', 'genre'] as const

/**
 * A node id: the stage and the URL to fetch, encoded together.
 *
 * Self-contained rather than a key into a map the runtime keeps, because a
 * shell restores its navigation stack after a restart and a map would not
 * have survived it — the user would come back to a folder that no longer
 * exists and be shown an error for having been away.
 *
 * The source id is included and checked on the way back in. It is not a
 * security boundary — the egress allowlist is, and `browse` re-checks it on
 * every fetch — but it turns "this id came from another source" from a
 * confusing cross-source fetch into a plain refusal.
 *
 * The base64url runs on `btoa`/`atob` rather than Node's `Buffer`: the
 * runtime executes in the renderer, which has no Node globals, and the
 * encoding is byte-identical to `Buffer`'s `base64url` so ids produced
 * either way round-trip.
 */
function encodeNode(node: BrowseNode, sourceId: string): string {
  const json = JSON.stringify({ v: 1, s: sourceId, t: node.stage, u: node.url })
  return `n1.${base64UrlEncode(json)}`
}

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function decodeNode(nodeId: string, sourceId: string): BrowseNode {
  const bad = (reason: string): never => {
    throw new RuleError(
      `cannot browse to ${JSON.stringify(nodeId)}: ${reason}`,
      { block: 'ruleExplore', field: 'childUrl' },
      sourceId,
    )
  }
  if (!nodeId.startsWith('n1.')) {
    // A shell passing a leaf's id back to `browse` is the likely cause, and
    // saying so beats "invalid base64".
    return bad('that is a leaf id, not a folder — leaves are played, not opened')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(base64UrlDecode(nodeId.slice(3)))
  } catch {
    return bad('it is not a node id this runtime produced')
  }
  if (!parsed || typeof parsed !== 'object') return bad('it is not a node id this runtime produced')

  const { s, t, u } = parsed as Record<string, unknown>
  if (s !== sourceId) return bad('it belongs to a different source')
  if (t !== 'explore' && t !== 'tracks') return bad('it names no stage this runtime knows')
  if (typeof u !== 'string' || !u) return bad('it carries no URL')
  return { stage: t, url: u }
}

/**
 * `[{"title":…,"url":…}]` → sections, or `undefined` when it is just a URL.
 *
 * Strict about the shape and silent about the failure: anything that is not an
 * array of titled URLs is a URL, which is the other documented spelling. An
 * array that *is* present but malformed is the one case worth refusing, since
 * a source that meant sections and typed them wrong would otherwise be told
 * its URL was unreachable.
 */
function parseSections(rendered: string): { title: string; url: string }[] | undefined {
  const text = rendered.trim()
  if (!text.startsWith('[')) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined

  const sections: { title: string; url: string }[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const { title, url } = entry as Record<string, unknown>
    if (typeof title !== 'string' || typeof url !== 'string' || !url.trim()) continue
    sections.push({ title, url: url.trim() })
  }
  return sections
}


/**
 * The body of a `@js:` expression, as a function body.
 *
 * Every real document writes an expression — `auth()`, `result.map(s => s.id)`
 * — but authors also write several statements ending in a `return`. Accepting
 * both means adding an implicit `return` only where there is not one already;
 * adding it unconditionally would turn `return x` into `return return x`.
 */
function bodyOf(expression: string): string {
  const trimmed = expression.trim()
  if (/\breturn\b/.test(trimmed) || /[;\n]/.test(trimmed)) return trimmed
  return `return (${trimmed})`
}


/**
 * `src.vars` as the runtime needs it.
 *
 * `get` is synchronous because a script reads it from inside a `{{ }}`
 * placeholder, where there is nowhere to await. `load` is the one async part,
 * and it is called once while the realm is being built — the first moment a
 * script could reach any of this.
 */
export interface SourceVars {
  load?(): Promise<void>
  get(key: string): string | undefined
  /**
   * ⚠️ Async, and awaited by `signIn`.
   *
   * A credential goes to the keychain, which is a real write that can fail —
   * a build with no `ctx.secrets` refuses rather than falling back to the
   * database. Fire-and-forget would report a successful sign-in for a password
   * that was never stored, and the user would find out on the next launch.
   */
  put(key: string, value: string): Promise<void>
}


/** A 1-based page number as the cursor a provider actually takes. */
function pageOf(page: number | undefined): PageRequest | undefined {
  return page === undefined ? undefined : { cursor: String(page) }
}


/** What `DocumentAuth` needs of the world. See `SourceDeps.signOut`. */
interface SessionStore {
  get(key: string): string | undefined
  put(key: string, value: string): Promise<void>
  clear(): Promise<void>
  /** Perform the document's `loginUrl` request. Throws `AuthError` on refusal. */
  login(): Promise<void>
  /** Start a QR code login session. */
  createQrSession?(): Promise<QrCodeSession>
  /** Refresh the current session (e.g. cookie or token refresh). */
  refresh?(): Promise<void>
  /** Drop one stored value. Used to undo a sign-in the backend refused. */
  forget?(key: string): Promise<void>
}



