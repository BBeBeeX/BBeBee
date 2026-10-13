/**
 * The `=` template evaluator — the M1 slice of the rule language.
 *
 * A rule is a selector unless it starts with `=`. This module implements the
 * `=` half and nothing else: literal text with `{{ }}` interpolation, which is
 * exactly what a stream URL needs and the smallest useful piece of the
 * language (docs/11 MD-7).
 *
 * The selector engines, combinators, `@put`/`@get` and `@js:` arrive with the
 * rest of the runtime. Until they do, a rule this module cannot understand is
 * **refused, not passed through as a literal** — see `evaluateRule`. Silently
 * treating an unrecognised rule as text is the failure mode that would make
 * every later rule bug harder to find, because the symptom appears three steps
 * downstream as a URL that is not a URL.
 *
 * Deliberately pure: no I/O, no platform, no Cordis. It takes a template and a
 * scope and returns a string, which is what makes the rule corpus runnable
 * without a network.
 *
 * See docs/06-music-sources.md §3.1–§3.2.
 */

import { RuleError } from '@BBeBee/protocol'

/** Where a rule was written, for error attribution. */
export interface RuleSite {
  block: string
  field: string
  sourceId?: string
}

/**
 * What `{{ }}` can see.
 *
 * Deliberately a plain data bag rather than a live object graph: an expression
 * evaluates against a snapshot, so nothing a rule does can reach back into the
 * runtime. The full language adds `item`, `result` and the `src` host object;
 * both arrive with the engines that need them.
 */
export interface TemplateScope {
  source?: { url?: string; var?: string; name?: string }
  track?: Record<string, unknown>
  album?: Record<string, unknown>
  artist?: Record<string, unknown>
  playlist?: Record<string, unknown>
  prefs?: Record<string, unknown>
  key?: string
  page?: number | unknown
  baseUrl?: string
  kind?: string
  /**
   * The current list element, while a `ListRule`'s fields are evaluated.
   *
   * This is what lets a field build a URL out of a sibling field —
   * `{{item.coverArt}}` — which the selector engines cannot do, because a
   * selector reaches *into* the element rather than across it.
   */
  item?: Record<string, unknown>
  [key: string]: unknown
}

const TEMPLATE_PREFIX = '='
const PLACEHOLDER = /[{]{2}([^{}]*)[}]{2}/g
/** `{{@js:expr}}` — the one placeholder that is not a path. */
const JS_PREFIX = '@js:'
/** A brace left over after every well-formed placeholder was consumed. */
const STRAY_BRACE = /[{]{2}|[}]{2}/

/** Whether a rule is a `=` template, and so within this module's slice. */
export function isTemplate(rule: string): boolean {
  return rule.startsWith(TEMPLATE_PREFIX)
}

/**
 * Evaluate a rule.
 *
 * Templates are rendered. Anything else is refused with a `RuleError` naming
 * the block and field, because the engine that would handle it does not exist
 * yet and pretending otherwise produces a wrong answer instead of a clear one.
 */
export async function evaluateRule(
  rule: string,
  scope: TemplateScope,
  site: RuleSite,
  js?: JsEvaluator,
): Promise<string> {
  if (!isTemplate(rule)) {
    throw new RuleError(
      `rule ${JSON.stringify(rule)} needs a selector engine, which this build does not have. ` +
        `Literal values must start with "=" (docs/06 §3.1).`,
      { block: site.block, field: site.field },
      site.sourceId,
    )
  }
  return renderTemplate(rule.slice(TEMPLATE_PREFIX.length), scope, site, js)
}

/**
 * Evaluate a field that is a **URL template**, not a selector.
 *
 * `searchUrl` and `exploreUrl` are not rules in the §3.1 sense: they do not
 * select out of a document — there is no document yet — they *build the
 * request that fetches one*. So `{{ }}` interpolation applies directly and a
 * leading `=` is optional, which is what docs/06 §2.3's worked example writes
 * and what rule-based sources do.
 *
 * That distinction was missing, and the cost was concrete: every source
 * written to the published example threw "needs a selector engine" on its
 * first search, and this repository's own Subsonic fixture had been quietly
 * given a `=` to make the integration test pass — the divergence hidden by
 * the thing that should have caught it.
 */
export async function evaluateUrlTemplate(
  rule: string,
  scope: TemplateScope,
  site: RuleSite,
  js?: JsEvaluator,
): Promise<string> {
  // A leading `=` is accepted and stripped, so documents written either way
  // work and neither spelling is a trap.
  const body = isTemplate(rule) ? rule.slice(TEMPLATE_PREFIX.length) : rule
  return renderTemplate(body, scope, site, js)
}

/**
 * Evaluating a `{{@js:…}}` placeholder.
 *
 * A function rather than the realm itself, so this module depends on the *idea*
 * of a sandbox and not on a particular one — and so a caller with no sandbox
 * simply passes nothing and gets the documented refusal.
 */
export type JsEvaluator = (expression: string, scope: TemplateScope) => Promise<unknown>

/**
 * Render `{{ }}` placeholders in a literal string.
 *
 * The expression grammar is deliberately tiny — a dotted path, optionally
 * through array indices — rather than "JavaScript, evaluated", with one
 * exception: `{{@js:expr}}` runs `expr` inside the source's sandbox
 * (docs/06 §3.2). That is how a Subsonic document appends its auth query
 * string to every URL, and it is the only place the template grammar reaches
 * outside itself.
 *
 * A path this cannot resolve is a `RuleError`, not an empty string: a stream
 * URL with a silently missing id fails minutes later in a way nobody can
 * diagnose. So is an unbalanced placeholder, for the same reason.
 *
 * ⚠️ Interpolation is **verbatim**, not URL-encoded. A value containing `&`,
 * `#` or a space rewrites the structure of the URL it lands in, which is
 * parameter smuggling within the source's own host. Encoding here would
 * corrupt the many rules that interpolate a whole URL or a query fragment, so
 * the encoding filter belongs in the full language (`{{x|url}}`); until it
 * exists, a document interpolating attacker-influenced text into a URL is
 * relying on its backend to be sane about it.
 */
export async function renderTemplate(
  template: string,
  scope: TemplateScope,
  site: RuleSite,
  js?: JsEvaluator,
): Promise<string> {
  /*
   * Two passes, because a placeholder may need to `await`.
   *
   * `String.replace` cannot take an async callback — it would substitute
   * `[object Promise]` into the URL and fail much later as a 404 nobody could
   * explain — so the matches are collected, resolved, and then spliced back
   * in by index.
   */
  const matches = [...template.matchAll(PLACEHOLDER)]
  const resolved: string[] = []

  for (const match of matches) {
    const path = (match[1] ?? '').trim()
    if (!path) throw ruleError('empty {{ }} placeholder', site)

    if (path.startsWith(JS_PREFIX)) {
      if (!js) {
        throw ruleError(
          `{{${path}}} needs the js engine, which this build does not have ` +
            '(docs/04 §19)',
          site,
        )
      }
      const value = await js(path.slice(JS_PREFIX.length).trim(), scope)
      resolved.push(scalar(value, path, site))
      continue
    }

    const value = resolvePath(scope, path)
    if (value === undefined || value === null) {
      throw ruleError(`{{${path}}} resolved to nothing`, site)
    }
    resolved.push(scalar(value, path, site))
  }

  let out = ''
  let cursor = 0
  for (const [i, match] of matches.entries()) {
    out += template.slice(cursor, match.index) + resolved[i]
    cursor = match.index + match[0].length
  }
  out += template.slice(cursor)

  /*
   * An unbalanced placeholder is a typo, and passing it through as literal
   * text is how it becomes a URL containing "{{track.id" that fails three
   * steps later as an unexplained 404. The module's own promise is to refuse
   * what it does not understand, and that has to include this.
   *
   * ⚠️ Checked against the **template**, with its well-formed placeholders
   * removed — never against the output. The output contains interpolated
   * data, and a track genuinely titled `Live {{2019}}` made a correct
   * template fail with a message quoting that innocent template. A remote
   * server's response cannot be allowed to invalidate the author's rule.
   */
  if (STRAY_BRACE.test(template.replace(PLACEHOLDER, ''))) {
    throw ruleError(`unbalanced {{ }} in ${JSON.stringify(template)}`, site)
  }

  return out
}

/** A placeholder interpolates a scalar. An object would stringify to nonsense. */
function scalar(value: unknown, path: string, site: RuleSite): string {
  if (value === undefined || value === null) {
    throw ruleError(`{{${path}}} resolved to nothing`, site)
  }
  if (typeof value === 'object') {
    throw ruleError(`{{${path}}} is an object; templates interpolate scalars`, site)
  }
  return String(value)
}

/**
 * Resolve a dotted path against the scope.
 *
 * Own properties only: a path may not walk the prototype chain, so
 * `{{track.constructor.name}}` resolves to nothing rather than to a foothold.
 */
function resolvePath(scope: TemplateScope, path: string): unknown {
  let current: unknown = scope
  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function ruleError(message: string, site: RuleSite): RuleError {
  return new RuleError(message, { block: site.block, field: site.field }, site.sourceId)
}
