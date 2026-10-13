/**
 * Running a parsed rule against a document.
 *
 * The pipeline, in order: alternatives (first non-empty wins), interleave,
 * concatenation, then per-atom — `@get`, engine selection, replacements, and
 * `@put` capture.
 *
 * Two rules govern everything here, and both exist because a source author is
 * debugging a rule on a phone against a backend that changed yesterday:
 *
 *  - **Absent and empty are different.** A selector matching nothing yields no
 *    values; a selector matching an empty string yields `''`. The caller
 *    decides which is a failure, because only it knows whether the field was
 *    optional (docs/06 §3.6).
 *  - **A broken rule fails loudly.** An unparseable selector is an error
 *    naming the rule, never a silent empty result — those are exactly what a
 *    valid-but-outdated rule produces, and telling them apart afterwards is
 *    impossible.
 */

import { RuleError } from '@BBeBee/protocol'
import { parseRule, type Atom, type Engine, type ParsedRule } from './parse.js'
import { queryJsonPath } from './jsonpath.js'
import { RuleSyntaxError } from './syntax-error.js'
import {
  MAX_REGEX_MATCHES,
  UnsafeRegexError,
  boundInput,
  compileRuleRegex,
} from './regex-guard.js'
import {
  renderTemplate,
  type JsEvaluator,
  type RuleSite,
  type TemplateScope,
} from './template.js'

/** What a rule is evaluated against. */
export interface RuleContext {
  /** The parsed document — JSON today; a DOM when the markup engines land. */
  document: unknown
  scope: TemplateScope
  site: RuleSite
  /** `@put` writes here and `@get` reads it. Lives for one evaluation. */
  vars?: Map<string, string>
  /**
   * The source's sandbox, when it has one.
   *
   * Optional because most rules never need it and a caller with no `ctx.js`
   * must still be able to run them — a build without a sandbox loses `@js:`
   * and nothing else. When it is absent, a `@js:` rule fails as an *engine*
   * problem rather than as a rule problem, which is the difference between
   * "this app cannot run your source" and "your source is broken".
   */
  js?: JsEvaluator
  /**
   * Where the tracer listens.
   *
   * Every atom reports what it received, what it produced and how long it
   * took — including the ones that worked, because the step that broke is
   * usually two before the empty result (docs/06 §10). Absent in normal
   * operation, so tracing costs nothing when nobody is watching.
   */
  trace?: RuleTrace
}

/** One atom's contribution to a trace. Raw: the caller redacts. */
export interface RuleTraceEntry {
  block: string
  field: string
  engine: Engine
  rule: string
  input: unknown
  output: unknown
  ms: number
}

export type RuleTrace = (entry: RuleTraceEntry) => void

/** An engine this build cannot run. Distinct from "the rule was wrong". */
/**
 * An engine this build cannot run. Distinct from "the rule was wrong".
 *
 * A `RuleError` so it carries the block and field like every other rule
 * failure (docs/06 §3.6): the tracer and the stale badge both key on that, and
 * an error that arrives without it is one the user cannot act on.
 */
export class RuleEngineUnavailableError extends RuleError {
  override readonly name = 'RuleEngineUnavailableError'
  constructor(
    readonly engine: Engine,
    site: RuleSite,
  ) {
    super(
      `the "${engine}" engine is not available in this build — ` +
        'it needs ctx.js (docs/04 §19) or a markup parser',
      { block: site.block, field: site.field },
      site.sourceId,
    )
  }
}

/** Engines that need nothing beyond this package. */
const ALWAYS: ReadonlySet<Engine> = new Set<Engine>(['template', 'json', 'regex', 'empty'])

/**
 * Whether an engine can run.
 *
 * `js` is conditional: it needs a sandbox, which is a *core service* the host
 * may or may not provide (docs/04 §19). Reporting it as available when there
 * is no realm would put a `search` button on a source whose first rule cannot
 * run — the over-declaration deriving capabilities exists to prevent.
 */
export function engineAvailable(engine: Engine, opts: { js?: boolean } = {}): boolean {
  if (engine === 'js') return opts.js === true
  return ALWAYS.has(engine)
}

/**
 * Evaluate a rule to every value it selects.
 *
 * Returns strings, because that is what a rule block's fields are. A caller
 * wanting the underlying objects — a list rule selecting elements — uses
 * `evaluateNodes`.
 */
export async function evaluate(rule: string, context: RuleContext): Promise<string[]> {
  return (await evaluateNodes(rule, context)).map(toText)
}

/** As `evaluate`, but keeping the selected values rather than stringifying. */
export async function evaluateNodes(rule: string, context: RuleContext): Promise<unknown[]> {
  return runParsed(parseOrFail(rule, context), context)
}

/**
 * Parse, or fail inside the taxonomy.
 *
 * `parseRule` throws `RuleSyntaxError`, which is not a `SourceError` — so an
 * unclosed `##` escaped as a bare `Error` past every handler that branches on
 * `code`, and the source list rendered "something went wrong" for a mistake
 * with an exact location. A malformed rule is a rule failure like any other.
 */
function parseOrFail(rule: string, context: RuleContext): ParsedRule {
  try {
    return parseRule(rule)
  } catch (error) {
    if (error instanceof RuleSyntaxError) throw asRuleError(error.message, context)
    throw error
  }
}

/** Evaluate an already-parsed rule. Saves a re-parse in a list of N items. */
export async function evaluateParsed(
  parsed: ParsedRule,
  context: RuleContext,
): Promise<string[]> {
  return (await runParsed(parsed, context)).map(toText)
}

async function runParsed(parsed: ParsedRule, context: RuleContext): Promise<unknown[]> {
  for (const alternative of parsed.alternatives) {
    const results = await runInterleave(alternative.parts, context)
    // First *non-empty* wins: this is what lets a document carry a rule for
    // the field a backend renamed and the one it renamed it to, and keep
    // working through the change.
    if (results.length > 0) return results
  }
  return []
}

async function runInterleave(
  parts: { atoms: Atom[] }[],
  context: RuleContext,
): Promise<unknown[]> {
  if (parts.length === 1) return runConcat(parts[0]!.atoms, context)

  const lists: unknown[][] = []
  // Sequential, not `Promise.all`: an atom may `@put` a variable a later one
  // reads, so evaluation order is part of the language.
  for (const part of parts) lists.push(await runConcat(part.atoms, context))
  const longest = Math.max(...lists.map((l) => l.length))
  const out: unknown[] = []
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i])
    }
  }
  return out
}

async function runConcat(atoms: Atom[], context: RuleContext): Promise<unknown[]> {
  const out: unknown[] = []
  for (const atom of atoms) out.push(...(await runAtom(atom, context)))
  return out
}

async function runAtom(atom: Atom, context: RuleContext): Promise<unknown[]> {
  // `@put` runs first: a later atom in the same rule can `@get` what it
  // stored, which is how a token lifted out of one field reaches another.
  for (const { key, rule } of atom.put) {
    const captured = await evaluate(rule, context)
    if (captured.length > 0) context.vars?.set(key, captured[0]!)
  }

  if (atom.get !== undefined) {
    const value = context.vars?.get(atom.get)
    if (value === undefined) return []
    /*
     * ⚠️ Through the replacement pipeline, like every other atom.
     *
     * `parse` keeps the replacements on a `@get` atom — refusing to drop them
     * was a fix in its own right — and then evaluation returned the stored
     * value before applying any of them. So `@get:{k}##a##X` handed back the
     * *untransformed* value: the rule looked like it worked and produced the
     * wrong text, which is the worst failure this language has.
     */
    if (atom.replacements.length === 0) return [value]
    return [applyReplacements(value, atom, context)]
  }

  if (!context.trace) {
    const selected = await select(atom, context)
    if (atom.replacements.length === 0) return selected
    return selected.map((value) => applyReplacements(toText(value), atom, context))
  }

  // Traced: report the atom whether it succeeded or threw. A trace that shows
  // only successful steps hides the one line the user is looking for.
  const started = Date.now()
  const report = (output: unknown) => {
    context.trace?.({
      block: context.site.block,
      field: context.site.field,
      engine: atom.engine,
      rule: atom.selector,
      input: context.document,
      output,
      ms: Date.now() - started,
    })
  }
  try {
    const selected = await select(atom, context)
    const out =
      atom.replacements.length === 0
        ? selected
        : selected.map((value) => applyReplacements(toText(value), atom, context))
    report(out)
    return out
  } catch (error) {
    report(`✗ ${String(error)}`)
    throw error
  }
}

async function select(atom: Atom, context: RuleContext): Promise<unknown[]> {
  if (!engineAvailable(atom.engine, { js: context.js !== undefined })) {
    throw new RuleEngineUnavailableError(atom.engine, context.site)
  }

  switch (atom.engine) {
    // An empty atom contributes nothing, so an alternative chain falls
    // through it rather than failing on it.
    case 'empty':
      return []

    case 'template':
      // A template always produces exactly one value, even an empty one: it
      // is text, not a selection, and "no match" is not a thing it can mean.
      return [await renderTemplate(atom.selector, context.scope, context.site, context.js)]

    case 'json':
      /*
       * A JSONPath against text can never match, so returning "absent" is a
       * lie about which of two very different things happened. `fetch.ts`
       * hands the body on as text when it does not parse as JSON — which is
       * exactly what a backend does when it serves an HTML login page or a
       * maintenance notice with a 200 — and a search that then reports zero
       * results reads as an empty backend.
       *
       * Erroring here is what puts the body in front of the author, via the
       * excerpt `asRuleError` attaches.
       */
      if (typeof context.document !== 'object' || context.document === null) {
        throw asRuleError(
          `${atom.selector} expects JSON, and the document is ${describe(context.document)}`,
          context,
        )
      }
      try {
        return queryJsonPath(context.document, atom.selector)
      } catch (error) {
        if (error instanceof RuleSyntaxError) throw asRuleError(error.message, context)
        throw error
      }

    case 'js': {
      /*
       * The document is bound as `result`, and the scope's members as globals.
       *
       * `result` rather than `document`: a `@js:` rule is a *post-processor*
       * in the grammar — it runs on what the previous atom selected.
       */
      const value = await context.js!(atom.selector, {
        ...context.scope,
        result: context.document,
      } as TemplateScope & { result: unknown })
      // A script returning an array means several values, exactly as a
      // selector matching several nodes does.
      return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
    }

    case 'regex':
      return runRegex(atom.selector, context)

    default:
      throw new RuleEngineUnavailableError(atom.engine, context.site)
  }
}

/**
 * A regex over the document as text.
 *
 * Capture group 1 where there is one, group 0 otherwise — the documented
 * behaviour, and the one that makes `:(\d+)kbps` mean "the number" rather
 * than "the number and the word".
 */
function runRegex(pattern: string, context: RuleContext): string[] {
  // Bounded on both sides: the pattern is refused if it can blow up, and the
  // text it runs against is capped. See `regex-guard.ts` for why a timeout is
  // not available to us.
  const text = boundInput(toText(context.document))
  let expression: RegExp
  try {
    expression = compileRuleRegex(pattern, 'g')
  } catch (error) {
    if (error instanceof UnsafeRegexError) throw asRuleError(error.message, context)
    throw asRuleError(`bad regex ${JSON.stringify(pattern)}: ${String(error)}`, context)
  }

  const out: string[] = []
  for (const match of text.matchAll(expression)) {
    out.push(match[1] ?? match[0])
    // A zero-length match would loop forever against `matchAll`'s cursor.
    if (match[0] === '') break
    if (out.length >= MAX_REGEX_MATCHES) break
  }
  return out
}

function applyReplacements(value: string, atom: Atom, context: RuleContext): string {
  let out = value
  for (const { pattern, replacement, firstOnly } of atom.replacements) {
    let expression: RegExp
    try {
      expression = compileRuleRegex(pattern, firstOnly ? '' : 'g')
    } catch (error) {
      if (error instanceof UnsafeRegexError) throw asRuleError(error.message, context)
      throw asRuleError(`bad replacement ${JSON.stringify(pattern)}: ${String(error)}`, context)
    }
    // `$&`, `$1` and `$\'` in the *replacement* are interpreted by
    // `String.replace`, so a document that meant a literal `$` silently got a
    // captured group instead. The language has no substitution syntax of its
    // own, so the replacement is literal text.
    out = boundInput(out).replace(expression, () => replacement)
  }
  return out
}

/**
 * A selected value as text.
 *
 * An object is JSON rather than `[object Object]`: a rule that selected a
 * subtree by mistake should show what it selected, because that is the fastest
 * route to seeing the mistake.
 */
export function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * A rule failure, carrying the input it failed on.
 *
 * docs/06 §3.6 promises the excerpt, and §10's "copy trace" is unusable
 * without it: "$.songs[*] matched nothing" reads identically whether the
 * backend renamed the field or served an HTML login page with a 200, and
 * those need opposite fixes. `RuleError` redacts and clips what it is given.
 */
function asRuleError(message: string, context: RuleContext): RuleError {
  return new RuleError(
    message,
    { block: context.site.block, field: context.site.field },
    context.site.sourceId,
    {
      excerpt: excerptOf(context.document),
      // Secret by provenance rather than by shape: `{{source.var}}` is where
      // a password reaches a rule, so it is scrubbed wherever it landed.
      ...(context.scope.source?.var ? { secrets: [context.scope.source.var] } : {}),
    },
  )
}

/** What the document turned out to be, for a message an author can act on. */
function describe(document: unknown): string {
  if (document === null) return 'null'
  if (document === undefined) return 'absent'
  if (typeof document === 'string') {
    const trimmed = document.trimStart()
    if (/^\s*<(?:!doctype|html|head|body)/i.test(trimmed)) return 'an HTML page'
    if (trimmed.startsWith('<')) return 'markup'
    return 'text'
  }
  return `a ${typeof document}`
}

/** Cap on what is stringified for an excerpt. Bounds the *error* path's cost. */
const EXCERPT_SOURCE_LIMIT = 4096

/**
 * The document as a short string.
 *
 * Sliced before `JSON.stringify` where it can be — a rule that fails once per
 * row over a large response would otherwise serialise the whole document on
 * every one of those failures, turning a broken rule into a slow app.
 */
function excerptOf(document: unknown): string {
  if (typeof document === 'string') return document.slice(0, EXCERPT_SOURCE_LIMIT)
  return toText(document).slice(0, EXCERPT_SOURCE_LIMIT)
}
