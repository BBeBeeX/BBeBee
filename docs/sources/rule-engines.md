# Source Rule Engines & Selectors

> **Legacy Reference:** Formerly `docs/06-music-sources.md §3`.

## 3. The rule language

One language, used for every field in [spec.md §2.2](./spec.md#22-the-rule-blocks). It is small on purpose: a rule
is one line in a form field, and a source author is debugging it on a phone.

### 3.1 Engines and prefixes

The prefix picks the engine. With no prefix, the engine is inferred from the shape of the rule and
the content type of the document being evaluated.

| Form | Engine | Applies to |
|---|---|---|
| `@css:h3 a@text` · a bare CSS selector | CSS selection with an `@attr` / `@text` / `@html` tail. **Parses but not yet implemented** — evaluating one raises `RuleEngineUnavailableError` | HTML, XML |
| `@json:$.a.b[0]` · a rule starting `$.` | JSONPath | JSON |
| `@xpath://div[@id="t"]/text()` · a rule starting `//` | XPath. **Parses but not yet implemented** — evaluating one raises `RuleEngineUnavailableError` | HTML, XML |
| `:(\d+)kbps` | Regular expression; capture group 1, or group 0 if there is none | Any text |
| `@js:` … · `<js>` … `</js>` | Sandboxed JavaScript ([runtime.md §8](./runtime.md#8-trust-what-an-imported-source-can-and-cannot-do)) — only when a `ctx.js` implementation is loaded | Any |
| `=` … | Literal template — the rest is text with `{{ }}` interpolation, never a selector | Any |

The engines that actually evaluate today are **template, JSONPath, regex and literal** (plus
`@js:` where a sandbox exists). `@css:` and `@xpath:` are recognised by the parser so documents
using them import cleanly, but no rule block of those kinds runs yet.

Inference exists so that the common case is short. It is also the one place the language can
surprise you, so the rule is written down rather than left to taste: **a rule is a selector unless
it starts with `=`.** A constant `"audio/mpeg"` with no `=` is a CSS selector for an element type
that does not exist, and the interpreter will tell you so rather than quietly returning the
string.

**The URL fields are the exception, and the only one.** `searchUrl` and `exploreUrl` are *URL
templates*, not selectors: there is no document to select from at the point they are rendered —
they are what produces the document. So they are interpolated as templates whether or not they
start with `=`, and the leading `=` is optional there. Every other field in the document follows
the selector rule above.

This is stated rather than implied because the two readings are indistinguishable by eye and
diverge silently: a `searchUrl` treated as a selector produces a CSS error naming an engine the
author never asked for, and the fix — adding an `=` — makes the symptom disappear without anyone
learning which reading was correct.

### 3.2 Templates and scope

`{{ }}` evaluates an expression and inlines the result. Inside a template, the following are in
scope:

| Name | Meaning |
|---|---|
| `source.url` | The document's `sourceUrl` |
| `source.var` | The per-source variable the user typed (credentials, a cookie, a region) |
| `key` | The search text — only inside `searchUrl` |
| `page` | 1-based page number — `searchUrl`, `exploreUrl`, and any paged list |
| `baseUrl` | The URL the current document was fetched from; relative links resolve against it |
| `item` | The current list element, when evaluating a `ListRule` field |
| `result` | The value produced so far in a chain ([§3.3](#33-combinators-and-post-processing)) |
| `track`, `album` | The stored entity, when evaluating `ruleStream` or `ruleLyric` |
| `prefs` | The active `StreamPrefs` ([runtime.md §6](./runtime.md#6-stream-resolution)) — quality, `saveData`, formats |
| `src` | The host object of [runtime.md §8](./runtime.md#8-trust-what-an-imported-source-can-and-cannot-do) — `md5`, `get`, `cache`, `vars`, … |

⚠️ **A bare `{{ }}` is a path, not an expression.** `{{track.id}}` and `{{page}}` resolve a dotted
path against the scope above and nothing more — `{{(page-1)*50}}` is *not* evaluated and fails as
an unresolvable path. Only `{{@js:…}}` reaches the sandbox, and it needs one: a build without
`ctx.js` reports the affected capability absent rather than running the rule.

The split is deliberate. Making every placeholder a script would put the sandbox on the path of
every URL a source builds — including in builds that have no sandbox — to serve an arithmetic case
that `@js:` already covers explicitly.

### 3.3 Combinators and post-processing

| Syntax | Meaning |
|---|---|
| `a || b` | First non-empty result wins. The idiom for a backend that renamed a field |
| `a && b` | Concatenate every result, in order |
| `a %% b` | Interleave the lists — `a[0], b[0], a[1], b[1], …`. N-way: `a %% b %% c` round-robins all three, and a list that runs out is skipped rather than padded |
| `rule##pattern##replacement` | Regex-replace the result. `##pattern##` with no replacement deletes |
| `rule##pattern##replacement###` | The trailing `###` makes it replace-first rather than replace-all |
| `{{rule}}` inside a `=` template | Inline evaluation |

`||` is the single most useful thing in the language: it is how a shared source survives a backend
that adds a field without removing the old one, and it is why a well-written source keeps working
through a site redesign that breaks a badly written one.

### 3.4 Variables and state

Three scopes, three lifetimes:

| Scope | Written by | Lives in | Cleared by |
|---|---|---|---|
| `@put:{k:rule}` / `@get:{k}` | A rule, mid-evaluation | The current evaluation only | Finishing the call |
| `src.cache.put(k, v, ttlMs)` | `@js:` | Memory, per source, TTL-bounded | TTL, unload, or "clear cache" |
| `src.vars.put(k, v)` | `@js:` | `source_vars` ([schema.md §4.1](../data-model/schema.md#41-sources-accounts-and-sessions)) | Sign-out, or removing the source |

`@put` exists for the pattern every scraped backend needs — pull a token out of the search page,
use it in the stream URL two calls later — without making that token global or persistent.
`src.vars` is for what must survive a restart, and is treated as credential-grade storage: it is
not exported with the source, not logged, and cleared by sign-out.

### 3.5 URL objects

Any rule that produces a URL may instead produce a **URL object**: the URL, a comma, and a JSON
options blob. This is legado's syntax and it is kept because it is compact enough to live in a
form field.

```
https://api.example.org/search,{"method":"POST","body":"q={{key}}","headers":{"X-Api":"…"},"charset":"gbk"}
```

| Option | Effect |
|---|---|
| `method` | `GET` (default), `POST`, `HEAD` |
| `body` | Request body; templated |
| `headers` | Merged over the document's `header` |
| `charset` | Decode a non-UTF-8 response |
| `retry` | Attempts before the call is an error; default 1 |
| `webView` | ⚠️ Render in a hidden web view and take the result DOM. Desktop only, off by default, and it is the one option that gives a source a full browser — see [runtime.md §8](./runtime.md#8-trust-what-an-imported-source-can-and-cannot-do). **Not implemented**: the option is currently ignored rather than honoured, so a document relying on it fetches normally and its rules run against the raw response |

### 3.6 What the interpreter guarantees

Rules come from strangers and are evaluated against documents that changed since the rule was
written. The interpreter's contract is about that, not about expressiveness:

- **Absent and empty are different.** A selector that matches nothing yields *absent*; a selector
  that matches an empty string yields `''`. Optional fields tolerate absent; required ones raise
  `RuleError` naming the rule ([authoring.md §7](./authoring.md#7-errors)).
- **Coercion is explicit and total.** `durationMs` runs through a numeric coercion that accepts
  `213`, `"3:33"`, and `"213.4s"` and rejects everything else with the rule id, rather than
  writing `NaN` into the catalogue.
- **Every evaluation is bounded.** Wall-clock, memory, output size, and HTTP calls per rule are
  all capped. A runaway `@js:` block fails its rule; it does not hang the app
  ([runtime.md §8](./runtime.md#8-trust-what-an-imported-source-can-and-cannot-do)).
- **Relative URLs resolve against `baseUrl`**, always, so a source never has to concatenate paths.
- **Nothing a rule returns is trusted as markup.** Results are text and are rendered as text. A
  title containing `<script>` is a title.
- **Failure is attributable.** Every error carries the source id, the rule block, the field, and
  the input excerpt — which is what makes [authoring.md §10](./authoring.md#10-diagnosing-a-broken-source) possible.

---

