# `core-js-mobile` — `ctx.js` for iOS and Android

The mobile implementation of the `js` service (see
`packages/protocol/src/services/js.ts` for the contract, and
`packages/core/core-js-quickjs-desktop` for the desktop twin). It exists
because React Native's Hermes implements neither `WebAssembly` nor
`eval`/`new Function`, so the desktop's QuickJS-in-WASM realm cannot exist
here: the sandbox must be an interpreter *written* in JavaScript, running as
ordinary module code inside Hermes.

## The interpreter

[`@nyariv/sandboxjs`](https://github.com/nyariv/SandboxJS) — it parses the
script into an intermediate tree and executes that tree with every property
access and prototype method call checked against a whitelist. The candidates
that lost:

- **`sval`** — supports async/await and good ES2019 coverage, but object
  literals are host objects, so `({}).constructor.constructor` walks to the
  host `Function` and compiles arbitrary host code. Unfixable without
  mutating host globals.
- **`js-interpreter`** (Neil Fraser) — a genuinely isolated object graph with
  step-level interruption, but its parser is ES5 only (no `let`, no block
  arrow bodies, no classes, no `async`/`await`). Source rules are async IIFEs
  awaiting host bridges.
- **`engine262`** — spec-complete, but not published to npm and its internals
  require host BigInt plumbing at a scale this use case cannot carry.

With sandboxjs the constructor chain *reaches* a `Function`, but the value
the script gets back is the engine's own sandboxed replacement — calling it
evaluates the code inside the sandbox. Verified for direct calls, `.call`,
`.apply`, `.bind` and the `AsyncFunction` twin; host globals (`fetch`,
`process`, `require`, `Reflect`, `Proxy`, timers) are not in the whitelist at
all. Two adjustments are made on top of the defaults (see `src/index.ts`):
`console` is removed — the desktop realm has none, and a script narrates
through `src.log` — and the whitelist gains the iterator prototypes plus
`Object.freeze`/`isFrozen`/`assign`, which the source runtime's own shim
(`SRC_SHIM`) needs to assemble itself.

The script text is additionally parsed with **acorn** before the engine sees
it, for two contract duties: acorn is the grammar gate (the engine's own
parser is lenient where the spec is not — it accepts `function (`), and it
locates the last expression statement so a `return` can be spliced in front
of it, which is what makes `eval("1 + 41")` resolve with `42` the way the
desktop's `evalCode` does.

## What the desktop contract cannot be honoured with

Without a real interpreter boundary there is no allocator and no interrupt
instruction, so three desktop behaviours degrade. Every caller that checks
`realm.disposed` and rebuilds after a breach keeps working; the differences
are in *how* a breach is reported and *what* a script can say.

| Desktop | Mobile | Consequence |
|---|---|---|
| `memoryBytes` heap ceiling → `JsMemoryError` | Not enforceable — no allocator to fail. An allocation blow-up is still stopped: the loop driving it breaches the execution quota and fails as `JsTimeoutError`. | Callers matching on `JsMemoryError` will not see it on mobile. `maxResultBytes` still caps what crosses out. |
| `timeoutMs` wall clock via interrupt handler | A tick quota derived from `timeoutMs` (`quota = timeoutMs × 500` ticks, clamped). A synchronous stretch cannot be interrupted from a single-threaded host; the quota bounds the overshoot to roughly one deadline. | An infinite loop dies *near* the deadline, deterministically, but the arrival time is load-dependent. |
| `budgetMs` wall clock for the whole call | Same wall clock, enforced host-side: a timer halts the engine and the realm is retired. Equivalent semantics. | — |

Plus two smaller gaps:

- **Dropped async work is unobservable.** The desktop realm pumps its job
  queue and reports unhandled rejections through the service. Here a promise
  the script neither returns nor awaits is never linked to the caller — and
  a *rejected* drop surfaces on the host's unhandled-rejection handler (on
  Hermes: the global error handler), not in the realm. The source runtime's
  rules always await their results, so this is an authoring-error path only.
- **A language subset.** The engine supports the ES2018–ES2020 core source
  documents actually use — `const`/`let`, arrow functions, template literals,
  destructuring, spread/rest, classes of expression (closures, object
  methods), generators, `async`/`await`, `for…of`, optional chaining,
  nullish coalescing, and the standard `JSON`/`Math`/`Date`/`String`/`Array`/
  `Map`/`Set`/`Promise` surface. **Not supported**: `class` declarations and
  expressions (no `extends`/`super`), `get`/`set` accessors in object
  literals, and anything the builtin whitelist does not name (`Object.create`,
  `Object.defineProperty`, `Reflect`, timers, `eval` on host values — the
  sandboxed `eval`/`Function` evaluate *inside* the realm).

A source document using an unsupported construct gets a `JsScriptError`
naming the syntax — the same shape as any other script bug, not a crash.

## Testing

`src/index.test.ts` runs the shared conformance suite
(`@BBeBee/protocol/conformance`, `jsConformance`) — the same checks the
desktop build runs — plus embedding-specific tests: the boundary clone in
both directions, the sandboxed-Function escape probe, the whitelist
extensions the source shim needs, and the documented gaps above.
