# @BBeBee/source-rules

Layer 4 (feature) — the **pure-logic implementation** of BBeBee's "music source rule language": parsing, evaluation, template expansion, JSONPath, regex guarding.

## Overview

> Pure logic: no Cordis, no platform SDK, and no I/O of any kind. It takes a rule and a scope and returns a value; every fetch belongs to `plugin-source-runtime`.

The payoff of purity: real source-document corpora can be replayed against recorded HTTP fixtures with **no network**. ESLint specifically bans `cordis` and `@BBeBee/kernel` inside this package; the only dependency is `@BBeBee/protocol` (just for `RuleError`).

**Consumers**: the only I/O context is the sibling `plugin-source-runtime` (the rule evaluator, and the provider of networking and the sandbox).

**Maturity**: partially implemented (the M1 slice). `=` templates, JSONPath, regex, and `@js:` are available; the markup parsers for the `css` and `xpath` engines have not landed yet and throw `RuleEngineUnavailableError` when used (so capability derivation never offers a button that would fail).

## Design philosophy

One thread running through every file: **an author debugging rules on a phone, against a backend that changed yesterday**. Hence — absence and empty string are separated; bad rules fail loudly carrying a document excerpt and attribution (block/field/sourceId); syntax errors are precise to the character and include a fix hint; mistyped operators are recognized as typos rather than silently swallowed; regexes from strangers are vetted and bounded in both directions; evaluation is traceable atom by atom.

## Source files

### `src/parse.ts` — rule parsing

Parses one line of rule into an evaluation pipeline. Grammar precedence: **`||` loosest, then `%%`, tightest `&&`** (`a && b || c` means "a then b, otherwise c"):

```
rule        := alternative ( '||' alternative )*      // the first non-empty one wins
alternative := concat ( '%%' concat )*                // interleave
concat      := atom ( '&&' atom )*                    // concatenate
atom        := ( '@put:{…}' | '@get:{…}' )* engine-selector replacement*
replacement := '##' pattern ( '##' replacement )? '###'?
```

- **`parseRule(rule): ParsedRule`** — the main entry. "Pure and total: an unparseable rule is still a rule that fails" (a parse failure is also deterministic behavior; it throws `RuleSyntaxError`).
- **`inferEngine(selector)`** — when unprefixed, infers: `=` → `template`; `$.`/`$[` → `json`; `//` → `xpath`; `:` → `regex`; **everything else is `css`**. A bare constant is therefore a **selector**, not a literal (literals must be written `=`), and the interpreter rejects it rather than quietly returning the text.
- Internal details: `scanRegions` first protects the `##…##` regex bodies and `{…}` directive bodies (**an unclosed `##` swallowing operators is a syntax error**, not a silent truncation); `matchBrace` counts braces (so bodies may contain nested templates); `takeReplacements` handles the `###` suffix (replace only the first match) and a trailing odd segment (= delete); `<js>…</js>` is the block form of `@js:`, anchored at both ends; an empty atom → `engine: 'empty'` (contributes nothing at evaluation, letting the `||` chain pass through); the residue of a mistyped operator (e.g. `$.a|||$.b` splits out `|$.b`) is an explicit error with the hint "if it really is a selector, write `@css:`".
- Types: `Engine`, `Replacement`, `Atom`, `Concat`, `Interleave`, `ParsedRule` (`source` keeps the original text for error reporting and the tracer).

### `src/template.ts` — `=` templates and `{{ }}` expansion

- **`TemplateScope`** — the **plain data snapshot** `{{ }}` can see (deliberately not a live object graph; rules cannot reach back into the runtime): `{ source?, track?, album?, prefs?, key?, page?, baseUrl?, item? }`; `item` is the current row element when evaluating list-rule fields.
- **`JsEvaluator`** — a **function abstraction** of the sandbox, not the realm itself; a caller without a sandbox passes `undefined` and receives a documented rejection.
- **`isTemplate(rule)`** — whether the rule starts with `=`.
- **`evaluateRule(rule, scope, site, js?)`** — evaluates one field rule. A non-`=` rule always throws `RuleError` — **rejected, not passed through as a literal** ("treating an unrecognized rule as text" is the hardest failure mode to debug).
- **`evaluateUrlTemplate(rule, scope, site, js?)`** — evaluates **URL template fields** (`searchUrl`/`exploreUrl`). They are not rules: they do not select from a document, they **construct the request that fetches one**, so `{{ }}` interpolates directly and the **leading `=` is optional**.
- **`renderTemplate(template, scope, site, js?)`** — the core renderer:
  - `{{@js:expr}}` is the **only placeholder that is not a path**; without a sandbox it throws `RuleError`;
  - paths are **dotted paths + array indices**, not JavaScript evaluation; only **own properties** are walked (`{{track.constructor.name}}` resolves to empty rather than providing a foothold);
  - resolving to empty / yielding an object → `RuleError` — a stream URL missing one id becomes an undiagnosable 404 three steps later; better to fail here;
  - two passes (first collect the placeholders and await each one, then stitch back — `String.replace` cannot take an async callback);
  - **unbalanced `{{ }}` throws**, and only the **template itself** is checked (after stripping legitimate placeholders) — a remote song genuinely titled `Live {{2019}}` must not make a correct template fail;
  - ⚠️ interpolation is verbatim, with no URL encoding (an encoding filter like `{{x|url}}` belongs to the full language).

### `src/evaluate.ts` — the evaluator

Two overarching laws: **"absent" and "empty string" are different things** (a selector matching zero nodes → zero values; matching an empty string → `''`, and the caller decides which counts as failure); **bad rules must fail loudly** (an unparseable selector is an error carrying the rule name, never a silent empty result — that would be indistinguishable after the fact from "a valid but stale rule").

- **`RuleContext`** — `{ document, scope, site, vars?, js?, trace? }`. `document` is the parsed document (JSON today; a DOM once the markup engines land); `vars` backs `@put`/`@get`; when `js` is missing, a `@js:` rule fails as an **engine problem, not a rule problem** — "this app cannot run your source" and "your source is broken" are two different messages.
- **`engineAvailable(engine, { js? })`** — `template/json/regex/empty` always available; `js` only with a sandbox; `css`/`xpath` currently unavailable.
- **`evaluate(rule, ctx): Promise<string[]>`** / **`evaluateNodes`** (keeps raw values; used by list rules to select elements) / **`evaluateParsed`** (reuses an already-parsed rule, skipping N re-parses).
- **The evaluation pipeline**: `runParsed` tries each `alternative` in order and **the first to produce a non-empty result wins** (the mechanism that keeps working when "the backend renamed a field and the document carries both the old and new rules"); `runInterleave` **executes sequentially, not `Promise.all`** (an earlier atom may `@put` a variable a later one `@get`s), then interleaves by index rotation; in `runAtom`, `@put` runs first and `@get` **must pass through the replacement pipeline** (there was once a bug returning the untransformed value — "the worst failure of this language": it looks like it works and produces wrong text).
- **Engine dispatch**: `json` → the document must be an object, otherwise the `RuleError` message uses `describe()` to say what the document actually is (`an HTML page`/`text`/…) — when a backend answers a 200 with an HTML login page, if JSONPath "returns empty when nothing matches" against text, search would render as an empty backend; `js` → the document is bound as **`result`** (`@js:` is a post-processor running on whatever the previous atom selected); `regex` → global matching, preferring capture group 1 and falling back to the whole match, breaking immediately on zero-length matches, capped at `MAX_REGEX_MATCHES`; `css`/`xpath` → `RuleEngineUnavailableError`.
- **`toText(value)`** — objects → `JSON.stringify`: seeing JSON makes a wrongly selected subtree obvious far sooner than `[object Object]`.
- **`asRuleError`** — carries block/field, sourceId, and a **document excerpt** (truncated to 4096 before serialization), and is **redacted by provenance**: as long as `scope.source.var` exists it is added to secrets.

### `src/jsonpath.ts` — a deliberate JSONPath subset

Not a general implementation: real documents only use a few shapes, and full JSONPath's filter expressions would inject a scripting surface into the half of the language that should stay **declarative** — computation belongs to `@js:`, behind the sandbox.

```
$                 root
.name  ['name']   property (single or double quotes)
[0] [-1]          index, negative counts from the end
[*]  .*           all elements/values
..name            all named descendants
```

Everything else throws `RuleSyntaxError` at **parse time** (dialect `'JSONPath'`) — "no results" is exactly what a valid-but-wrong path returns, and the two are indistinguishable after the fact. Explicitly rejected: `..*`, filters, slices, unions, leading-zero indices.

- **`parseJsonPath(path): Step[]`** — one lexing pass; evaluation becomes walking steps; **`queryJsonPath(root, path)`** — all matches in document order.
- Safety details: the property-name whitelist is `[A-Za-z0-9_\-@:+~]` (`-`/`@` included — real documents have `subsonic-response` and `@attributes`; `| & # $ { }` excluded — `$.a|b` is a mistyped `||`, not a property named `a|b`); property steps only walk own properties (`$.constructor` cannot fish `Object` out of parsed JSON); the wildcard uses a loop rather than spread (`push(...huge)` blows the stack past ~100k elements); `..name` recursion is depth-capped at 512 (a deeply nested document from a stranger once blew the stack).

### `src/regex-guard.ts` — ReDoS protection

Rule patterns come from **imported documents**, and the JS regex engine is backtracking and **uninterruptible** (no timer, worker, or signal can stop it; 24 characters of input measured 372ms; 50,000 characters never returns). This is an **honest partial solution** — reject patterns that can explode + limit how much text is fed to them; its self-assessment is accurate: **"this is a bound, not a proof"**.

- **`isUnsafeRegex(pattern)`** — a **small state machine, not a regex** ("using a regex to detect dangerous regexes is a lovely way to get bitten twice"). Detects: a quantifier applied to a group that itself contains a quantifier (`(a+)+`), or a quantifier applied to a group containing a top-level alternation (`(a|aa)+`). Details: a lone `?` does not count; `{n}` counts as multiplication **when it closes a group** (`(.*a){20}b` ≙ `(.*a)+`) but not inline within a body (`(a{2})+` is genuinely safe); skipped inside character classes.
- **`compileRuleRegex(pattern, flags)`** — vetted before compiled; unsafe or a compile throw both normalize to `UnsafeRegexError` (the rejection happens where the author can fix it, instead of freezing someone's phone).
- **`boundInput(text)`** — truncated to `MAX_REGEX_INPUT` (256 KiB); per-rule match cap `MAX_REGEX_MATCHES` (10,000).

### `src/syntax-error.ts` — the unified syntax error

`RuleSyntaxError extends Error { rule, dialect }`, with `dialect: 'rule' | 'JSONPath'` preserving the real distinction of "which grammar rejected this string". The header comment records the episode of there being **two** same-named classes (one in parse.ts, one in jsonpath.ts): `e instanceof RuleSyntaxError` handled bad paths yet silently missed bad rules — same name, different identity, and the compiler said nothing.

### `src/index.ts` — the public export surface

Full re-export per module (the authoritative list of the package's API): `engineAvailable`, `evaluate`, `evaluateNodes`, `evaluateParsed`, `toText`, `parseJsonPath`, `queryJsonPath`, `parseRule`, `inferEngine`, `evaluateRule`, `evaluateUrlTemplate`, `isTemplate`, `renderTemplate`, `compileRuleRegex`, `isUnsafeRegex`, `boundInput`, `RuleSyntaxError`, `RuleEngineUnavailableError`, `UnsafeRegexError`, `MAX_REGEX_INPUT`, `MAX_REGEX_MATCHES`, and the types.

## Rule language syntax cheat sheet (as of this package's current state)

| Prefix | Engine | Status |
|---|---|---|
| `@css:` | CSS selector | **unavailable** (throws `RuleEngineUnavailableError`) |
| `@json:` / `$.`/`$[` | JSONPath | available |
| `@xpath:` / `//` | XPath | **unavailable** |
| `@js:` / `<js>…</js>` | sandboxed script | available (needs a `JsEvaluator`; the document is bound as `result`) |
| `=` | template | available |
| `:` | regex | available (global match, capture group 1) |
| no prefix | inferred | everything else → css (a bare constant is a selector, not a literal) |

| Combinator | Semantics |
|---|---|
| `\|\|` | alternatives; the first non-empty result wins |
| `%%` | interleaved merge (evaluated in order, rotated by index) |
| `&&` | concatenation |
| `##pat##repl##` | regex replace; the replacement text is a **literal** (`$1` is not interpreted); the `###` suffix replaces only the first match |
| `@put:{key:rule}` / `@get:{key}` | in-evaluation variables (`@get` passes through the replacement pipeline) |

`{{dotted.path}}` (own-property paths) and `{{@js:expr}}` (the only non-path placeholder) are the template placeholders. **Attribute-extraction functions like `@text`/`@attr:` do not exist yet** (they arrive with the markup engines).

## Related docs

- `docs/06-music-sources.md` §3/§8: the rule language, the sandbox host surface
- `packages/feature/plugin-source-runtime/README.md`: the only I/O context
- `packages/feature/plugin-source-runtime/`: the rule language's real test corpus and runtime context
