# Source documents

Example source strings — the thing a user imports (docs/06). They live here
rather than in `packages/` because **a music backend is not a package**: these
are data, and the only code that reads them is `plugin-source-runtime`.

Two uses:

- **Worked examples.** The shortest honest answer to "what does a source
  actually look like".
- **The corpus.** Replayed end to end against recorded HTTP fixtures, so a
  change to the rule engine that breaks a real document fails CI
  (docs/09 §6).

## What is expressible today

- **`=` templates** with `{{ }}` interpolation.
- **`@json:` / `$.…`** — JSONPath over a JSON response. Properties, indices
  (negative counts from the end), `[*]`, and `..name` descent. Filter
  expressions are deliberately refused: they are a scripting surface inside
  the declarative half of the language.
- **`:regex`** over the response text.
- **Combinators** — `||` (first non-empty), `&&` (concatenate), `%%`
  (interleave) — and `##pattern##replacement` post-processing, with `###` for
  replace-first.
- **`@put:{k:rule}` / `@get:{k}`** for a value lifted out of one field and used
  in another.
- **`searchUrl` + `ruleSearch`**, **`exploreUrl` + `ruleExplore` +
  `ruleTrackList`**, and **`ruleStream`**.
- **The catalogue round trip.** A search's rows are cached, and each item's
  raw payload with them, so `ruleStream` still resolves after a restart
  without re-running the search (docs/06 §4).
- **`@js:` and `{{@js:…}}`**, with `jsLib` and the full `src` host surface
  (docs/06 §8) — so a Subsonic document computes its own auth query.
- **Sessions & Login.** The source variable and persistent per-source cookie jar.
- **Artists & Playlists.** `ruleArtist` and `rulePlaylist` for rich catalog
  resolution.
- **Explicit Qualities.** `ruleStream.qualities` and `doc.qualities` for
  declaring supported quality tiers ('low' | 'normal' | 'high' | 'lossless' | 'hi-res').

So `subsonic.json` runs as the reference self-hosted source fixture.

## Authoring vs Distribution

A single-file JSON with a 500-line minified `jsLib` string is unpleasant to edit directly.
Instead, author sources in the `sources/` directory with two files:

- `sources/<id>/source.json`: metadata, allowedHosts, rules, and entry points.
- `sources/<id>/source.js`: unescaped JavaScript with full IDE syntax highlighting and linting.

Then build them into `fixtures/sources/` for testing and distribution:

```bash
# Compile all sources into fixtures/sources/<id>.json
pnpm build:sources

# Watch for changes and recompile automatically
pnpm watch:sources

# Unpack any single-file source back into sources/<id>/
node --experimental-strip-types scripts/sources/cli.ts --unpack fixtures/sources/subsonic.json sources/subsonic
```

Adding a document here is not how a *user* adds a source: they paste a string
into Settings → Sources → Import (docs/06 §9).
