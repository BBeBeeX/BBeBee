/**
 * Parsing a rule into the pipeline that evaluates it.
 *
 * A rule is one line in a form field on a phone, so the syntax is dense and
 * the parse has to be forgiving about what people actually type. It is also
 * the layer where a source author's mistake either becomes a clear message or
 * a silent wrong answer three steps later — so everything here fails loudly.
 *
 * Grammar, in the order it is applied:
 *
 *     rule       := alternative ( '||' alternative )*      first non-empty wins
 *     alternative:= concat ( '%%' concat )*                interleave
 *     concat     := atom ( '&&' atom )*                    concatenate
 *     atom       := ( '@put:{…}' | '@get:{…}' )* engine-selector replacement*
 *     replacement:= '##' pattern ( '##' replacement )? '###'?
 *
 * ⚠️ Precedence is `||` loosest, then `%%`, then `&&`. And
 * it is the useful one: `a && b || c` means "a-then-b, or else c", which is
 * how a fallback for a two-part field is written.
 *
 * See docs/06-music-sources.md §3.
 */

import { RuleSyntaxError } from './syntax-error.js'

/** Which engine evaluates a selector. */
export type Engine = 'template' | 'json' | 'regex' | 'css' | 'xpath' | 'js' | 'empty'

/** A regex post-processor: `##pattern##replacement`. */
export interface Replacement {
  pattern: string
  replacement: string
  /** `###` suffix: replace the first match only, rather than all of them. */
  firstOnly: boolean
}

/** One selector, with everything attached to it. */
export interface Atom {
  engine: Engine
  /** The selector itself, prefix and replacements stripped. */
  selector: string
  replacements: Replacement[]
  /** `@put:{key:rule}` — capture the result under these names. */
  put: { key: string; rule: string }[]
  /** `@get:{key}` — this atom *is* a stored value rather than a selection. */
  get?: string
}

export interface Concat {
  atoms: Atom[]
}

export interface Interleave {
  parts: Concat[]
}

export interface ParsedRule {
  /** First non-empty wins. */
  alternatives: Interleave[]
  /** The rule as written, for error messages and the tracer. */
  source: string
}

const PREFIXES: { prefix: string; engine: Engine }[] = [
  { prefix: '@css:', engine: 'css' },
  { prefix: '@json:', engine: 'json' },
  { prefix: '@xpath:', engine: 'xpath' },
  { prefix: '@js:', engine: 'js' },
]

/**
 * Regions in which an operator is not an operator.
 *
 * Two of them, and both were being got wrong in different ways:
 *
 *  - `##…##` is a regex replacement. `##a||b##` is one alternation pattern,
 *    not two alternatives.
 *  - `{…}` is a directive body. `@put:{t:$.a||$.b}` holds a whole rule, which
 *    docs/06 §3.4 explicitly allows to contain operators and templates.
 *
 * ⚠️ An **unterminated** `##` region that swallows an operator is a syntax
 * error rather than a silent truncation. `$.title##\(live\)&&$.artist` used to
 * parse as one atom and lose the `&&$.artist` entirely — no error, a field
 * quietly missing half its value. No reading of that string is obviously
 * right, so the author is asked rather than guessed at.
 */
function scanRegions(input: string): { protectedAt: boolean[]; unterminatedHash: number } {
  const protectedAt = new Array<boolean>(input.length).fill(false)
  let unterminatedHash = -1
  let i = 0
  let braces = 0

  while (i < input.length) {
    if (braces === 0 && input.startsWith('##', i)) {
      const close = input.indexOf('##', i + 2)
      const end = close === -1 ? input.length : close + 2
      if (close === -1) unterminatedHash = i
      for (let j = i; j < end; j++) protectedAt[j] = true
      i = end
      continue
    }
    if (input[i] === '{') {
      braces++
      protectedAt[i] = true
      i++
      continue
    }
    if (input[i] === '}') {
      protectedAt[i] = true
      if (braces > 0) braces--
      i++
      continue
    }
    if (braces > 0) protectedAt[i] = true
    i++
  }
  return { protectedAt, unterminatedHash }
}

/** Split on a top-level operator, respecting the protected regions above. */
function splitTop(input: string, operator: string): string[] {
  const { protectedAt, unterminatedHash } = scanRegions(input)
  const parts: string[] = []
  let start = 0

  for (let i = 0; i <= input.length - operator.length; i++) {
    if (protectedAt[i]) continue
    if (!input.startsWith(operator, i)) continue
    parts.push(input.slice(start, i))
    i += operator.length - 1
    start = i + 1
  }
  parts.push(input.slice(start))

  // Only complain where the ambiguity actually bites: an unterminated `##`
  // that swallowed something reading as an operator.
  if (parts.length === 1 && unterminatedHash !== -1) {
    if (input.slice(unterminatedHash).includes(operator)) {
      throw new RuleSyntaxError(
        input,
        `the replacement starting at ${unterminatedHash} is not closed, so "${operator}" ` +
          `after it is part of the pattern — close it with "##" if you meant the operator`,
      )
    }
  }
  return parts
}


/**
 * Find the `}` matching the `{` at `open`.
 *
 * Counting rather than matching a regex: `@put:{k:=pre-{{source.url}}}` holds
 * a template whose braces nest, and `[^}]*` truncated it at the first one —
 * producing an inner rule of `=pre-{{source.url` and a misleading "unbalanced
 * {{ }}" from three layers down.
 */
function matchBrace(input: string, open: number): number {
  let depth = 0
  for (let i = open; i < input.length; i++) {
    if (input[i] === '{') depth++
    else if (input[i] === '}' && --depth === 0) return i
  }
  return -1
}

/** `@put:{a:rule}` / `@get:{key}`, stripped off the front of an atom. */
function takeDirectives(input: string): {
  rest: string
  put: { key: string; rule: string }[]
  get?: string
} {
  let rest = input.trim()
  const put: { key: string; rule: string }[] = []
  let get: string | undefined

  for (;;) {
    const directive = /^@(put|get):\{/.exec(rest)
    if (!directive) break

    const open = rest.indexOf('{')
    const close = matchBrace(rest, open)
    if (close === -1) {
      throw new RuleSyntaxError(input, `@${directive[1]!} is missing its closing "}"`)
    }
    const body = rest.slice(open + 1, close)

    if (directive[1] === 'get') {
      get = body.trim()
    } else {
      // Split on the *first* colon only: the value is a whole rule, and a
      // JSONPath or a template contains colons of its own.
      const colon = body.indexOf(':')
      if (colon === -1) {
        throw new RuleSyntaxError(input, '@put needs a key and a rule, as @put:{key:rule}')
      }
      put.push({ key: body.slice(0, colon).trim(), rule: body.slice(colon + 1).trim() })
    }
    rest = rest.slice(close + 1).trimStart()
  }
  return get === undefined ? { rest, put } : { rest, put, get }
}

/**
 * `sel##a##b###` → the selector plus its replacements, in order.
 *
 * Segments are separated by `##` and paired up: pattern, replacement, pattern,
 * replacement. A trailing odd segment is a pattern with an empty replacement,
 * which is how a deletion is written.
 *
 * The `###` suffix is stripped *first*, before splitting: it is a marker on
 * the whole expression, and splitting on `##` turns it into a stray `#`
 * segment that then reads as another empty pattern.
 *
 * ⚠️ A pattern that genuinely ends in `#` cannot be written without the
 * suffix being read instead. Rare enough to accept and say so, rather than
 * inventing an escape nobody would remember.
 */
function takeReplacements(input: string): { selector: string; replacements: Replacement[] } {
  const first = input.indexOf('##')
  if (first === -1) return { selector: input, replacements: [] }

  const selector = input.slice(0, first)
  let body = input.slice(first + 2)

  const firstOnly = body.endsWith('###')
  if (firstOnly) body = body.slice(0, -3)

  const segments = body.split('##')
  const replacements: Replacement[] = []
  for (let i = 0; i < segments.length; i += 2) {
    const pattern = segments[i]
    if (pattern === undefined) break
    replacements.push({
      pattern,
      replacement: segments[i + 1] ?? '',
      firstOnly: false,
    })
  }
  // The marker applies to the expression, so it lands on the last pair.
  const last = replacements[replacements.length - 1]
  if (last && firstOnly) last.firstOnly = true

  return { selector, replacements }
}

/**
 * Infer the engine when no prefix says.
 *
 * Inference is the one place the language can surprise you, so it is narrow
 * and written down: `$.` is JSONPath, `//` is XPath, a leading `:` is a
 * regex, `=` is a template, and everything else is a CSS selector. A bare
 * constant is therefore a *selector* — the interpreter says so rather than
 * quietly returning the text (docs/06 §3.1).
 */
export function inferEngine(selector: string): { engine: Engine; selector: string } {
  if (selector.startsWith('=')) return { engine: 'template', selector: selector.slice(1) }
  if (selector.startsWith('$.') || selector.startsWith('$[')) {
    return { engine: 'json', selector }
  }
  if (selector.startsWith('//')) return { engine: 'xpath', selector }
  if (selector.startsWith(':')) return { engine: 'regex', selector: selector.slice(1) }
  return { engine: 'css', selector }
}

function parseAtom(input: string): Atom {
  const { rest, put, get } = takeDirectives(input)

  if (get !== undefined) {
    // `@get:{k}` is a value, not a selection — but a replacement after it is
    // an explicitly authored transformation, and dropping it made
    // `@get:{k}##a##b` return the untransformed value with no complaint.
    const { selector, replacements } = takeReplacements(rest)
    if (selector.trim()) {
      throw new RuleSyntaxError(
        input,
        `"${selector.trim()}" follows @get:{${get}}, which is a value rather than a ` +
          'document — only a ## replacement can follow it',
      )
    }
    return { engine: 'template', selector: '', replacements, put, get }
  }

  /*
   * `<js>…</js>` is the block form of `@js:`; both reach the same engine.
   *
   * Anchored at both ends, so anything after `</js>` fails to match — and
   * falling through then inferred a *CSS selector* out of a script, which
   * fails with a message about markup that has nothing to do with the
   * mistake. A rule that opens the block is a script rule; if it does not
   * close cleanly, say so.
   */
  const trimmed = rest.trim()
  if (trimmed.startsWith('<js>')) {
    const block = /^<js>([\s\S]*)<\/js>$/.exec(trimmed)
    if (!block) {
      throw new RuleSyntaxError(
        input,
        trimmed.includes('</js>')
          ? 'has content after </js>; the script block must be the whole rule'
          : '<js> is never closed with </js>',
      )
    }
    return { engine: 'js', selector: block[1]!, replacements: [], put }
  }

  for (const { prefix, engine } of PREFIXES) {
    if (!rest.startsWith(prefix)) continue
    const { selector, replacements } = takeReplacements(rest.slice(prefix.length))
    return { engine, selector, replacements, put }
  }

  const { selector, replacements } = takeReplacements(rest)
  // An empty atom selects nothing and claims no engine. It used to fall to
  // `css`, so `$.a||||$.b` reported "the css engine is not available" and
  // lost a fallback that would have worked.
  if (!selector.trim()) return { engine: 'empty', selector: '', replacements, put }

  /*
   * A mistyped operator leaves its odd character on the front of the next
   * atom: `$.a|||$.b` splits into `$.a` and `|$.b`, and `$.a&&&$.b` into
   * `$.a` and `&$.b`. Inference then called them CSS selectors, so the report
   * was "the css engine is not available" — an engine the author never asked
   * for, in a build where fixing it would not have helped.
   *
   * ⚠️ `|div` is a real CSS namespace selector, and this refuses it. Someone
   * who means that writes `@css:|div`, which is exempt because it never
   * reaches inference; a stray pipe is the overwhelmingly likelier reading of
   * a bare one.
   */
  const stray = /^([|&%])\1*/.exec(selector.trim())
  if (stray) {
    throw new RuleSyntaxError(
      input,
      `starts with "${stray[0]}", which looks like the tail of a mistyped ` +
        `"${stray[1]!.repeat(2)}" operator — use @css: if the selector really begins with it`,
    )
  }

  const inferred = inferEngine(selector)
  return { engine: inferred.engine, selector: inferred.selector, replacements, put }
}

/** Parse a rule. Pure and total: an unparseable rule is still a rule that fails. */
export function parseRule(rule: string): ParsedRule {
  const alternatives = splitTop(rule, '||').map((alternative) => ({
    parts: splitTop(alternative, '%%').map((part) => ({
      atoms: splitTop(part, '&&').map(parseAtom),
    })),
  }))
  return { alternatives, source: rule }
}
