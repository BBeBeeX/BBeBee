// `@Inject` is a 2023-11 **standard** decorator, not the legacy TypeScript
// form. Getting this wrong produces confusing runtime errors rather than a
// compile failure, so it is called out in docs/04 §17.
//
// Configured *through* the preset rather than as a plugin of our own.
// `babel-preset-expo` always adds `@babel/plugin-proposal-decorators` itself,
// defaulting to `{ legacy: true }`; a second entry alongside it puts both
// `decorators` and `decorators-legacy` into the parser, which Babel refuses
// outright. The preset forwards this option to that same plugin.
//
// `unstable_transformImportMeta` is load-bearing for `ctx.js`: the QuickJS
// singlefile WASM variant (`@jitl/quickjs-singlefile-browser-release-sync`)
// is an ESM module whose emscripten glue reads `import.meta.url`, and Hermes
// does not implement `import.meta` at runtime — without this polyfill the
// `@bbebee/core-js-quickjs-node` import chain throws on first use on every
// Android/iOS device (the desktop shell is unaffected because the webview's
// V8 supports the syntax natively). Verified on an emulator: the exact Hermes
// error is "`import.meta` is not supported in Hermes. Enable the polyfill
// `unstable_transformImportMeta`…".
module.exports = function (api) {
  api.cache(true)
  return {
    presets: [
      [
        'babel-preset-expo',
        { decorators: { version: '2023-11' }, unstable_transformImportMeta: true },
      ],
    ],
  }
}
