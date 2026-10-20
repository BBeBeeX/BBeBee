/**
 * Pilot targets for `scripts/verify-plugin-pilot.mjs`.
 *
 * The verification loop itself is target-agnostic: it assembles,
 * packs, validates, installs, loads, updates and uninstalls whatever
 * package a target describes. Everything package-specific lives here
 * as data (plus two small assertion hooks), so pointing the loop at
 * another plugin is a new entry in this map — never an edit to the
 * loop. Select a target with `node scripts/verify-plugin-pilot.mjs
 * <name>`; the default is `visualizer`.
 *
 * Target shape:
 *
 *   pluginId / npmName   publication identity (registry entry id —
 *                        a kebab slug — and the lowercase npm name).
 *   versions             [initial, updated]: two consecutive versions
 *                        the loop installs, then updates between. The
 *                        update path's default range is `^<installed>`,
 *                        so pick a pair that range can cross (a patch
 *                        bump under 0.x `^` semantics).
 *   source               'assembled' (default): the package is built
 *                        from `featureDir` (+ `uiDir`) by
 *                        assemble-plugin.mjs. 'own': a prebuilt package
 *                        authored in combined layout (the third-party
 *                        shape) — `featureDir` is the package root,
 *                        its own build.mjs builds it, and the loop
 *                        stages it verbatim, asserting the tarball
 *                        equals the publishable set its `files` field
 *                        declares.
 *   featureDir / uiDir   repo-relative package directories (`uiDir`
 *                        may be null for a headless-only package).
 *   entry                registry entry fields other than `id`/`npm`
 *                        (the loop injects those from the identity
 *                        above, so they cannot drift apart).
 *   entryFile            repo-relative path to a ready-made registry
 *                        entry JSON, used verbatim instead of `entry`
 *                        (its `id`/`npm` are asserted against the
 *                        target identity).
 *   entryFileName        file name the entry is submitted under in
 *                        the fixture registry (the registry's
 *                        `{github-owner}-{name}.json` convention —
 *                        independent of the entry id). Defaults to
 *                        `<pluginId>.json`.
 *   dependencyPackages   [{ target, version }]: other targets in this
 *                        map, assembled and served as registry
 *                        packages this target's entry depends on.
 *                        The loop asserts the install closure pulls
 *                        them in, in order, and (for such targets)
 *                        runs a negative control with the dependency
 *                        entry removed from the index.
 *   expectClosure        registry ids the install plan must resolve
 *                        as the dependency closure, in install order
 *                        (default: []).
 *   activationChain      registry ids to load and apply into the
 *                        stage-4 context before the target itself
 *                        (e.g. the closure member whose service the
 *                        target consumes — activated for real from
 *                        its installed directory).
 *   worldManifests       repo-relative `BBeBee.plugin.json` paths whose
 *                        `contributes.services` seed the install-time
 *                        service-availability composition.
 *   syntheticManifests   manifest objects for services a shell provides
 *                        at runtime without a manifest file.
 *   edgeServices         plain service values provided on the real
 *                        Cordis context at activation time. The loop
 *                        itself supplies a recording `ui` stub and a
 *                        functional `settings` stub; a target value
 *                        under the same key overrides the loop's.
 *   activationSettled    optional poll predicate for activation.
 *   updateMarker         { file, find, tag }: in the update round the
 *                        loop copies the feature package, replaces
 *                        `find` with `find + ' — ' + tag` in the built
 *                        `file`, and re-assembles as `versions[1]`.
 *   verifyActivation     optional hook for target-specific activation
 *                        assertions: ({ check, uiCalls, ctx,
 *                        headlessMod, uiMod, mods }) => void. `mods`
 *                        maps every activated registry id (chain +
 *                        target) to its installed { headless, ui }
 *                        module objects.
 *   verifyUpdate         optional hook asserting the update's marker
 *                        is observable after reload: ({ check,
 *                        uiCalls, ctx, mods, tag }) => void.
 */

export const TARGETS = {
  visualizer: {
    pluginId: 'bbebeex-visualizer', // registry entry id (kebab slug)
    // Publication name: npm (and the registry validator) only accept
    // lowercase names, so the monorepo scope `@BBeBee` cannot be
    // published as-is — the package is assembled under this name.
    npmName: '@bbebee/plugin-visualizer',
    versions: ['0.1.0', '0.1.1'],
    featureDir: 'packages/feature/plugin-visualizer',
    uiDir: 'packages/ui/plugin-visualizer-ui-desktop',
    entry: {
      name: 'Audio Visualizer',
      author: 'BBeBee Team',
      description: 'Real-time audio spectrum and waveform visualization service with desktop views.',
      repo: 'https://github.com/BBeBeeX/BBeBee',
      services: ['audio', 'player', 'settings', 'ui'],
      provides: ['visualizer'],
      platforms: ['desktop'],
      category: 'ui-enhancement',
      dependencies: [],
      compositors: ['now-playing.visualizer'],
      i18n: ['en', 'zh'],
    },
    worldManifests: [
      'packages/core/core-audio-mpv/BBeBee.plugin.json',
      'packages/feature/plugin-settings/BBeBee.plugin.json',
      'packages/feature/plugin-player/BBeBee.plugin.json',
      // `ui` is contributed by the real @BBeBee/plugin-ui manifest
      // (contributes.services: ['ui']) — no synthetic stand-in. An
      // earlier round of this pilot synthesized a fake ui-kit manifest
      // on the mistaken premise that the shell provides `ui` without
      // one; the registry entry below lists `ui` in `services`, and it
      // is this real manifest that makes it available.
      'packages/feature/plugin-ui/BBeBee.plugin.json',
    ],
    edgeServices: {
      audio: { activeEngineName: 'webaudio' },
      player: {},
    },
    activationSettled: ({ uiCalls, ctx }) => uiCalls.registerView.length >= 2 && Boolean(ctx.get('visualizer')),
    updateMarker: {
      file: 'dist/index.js',
      find: 'Show animated music frequency and waveform effects in the player, with custom styles and colors',
      tag: 'pilot build 0.1.1',
    },
    verifyActivation({ check, uiCalls, ctx, headlessMod }) {
      check(
        'UI registered its views on the real Cordis context',
        JSON.stringify(uiCalls.registerView.map(([id]) => id)) ===
          JSON.stringify(['visualizer.canvas', 'visualizer.settings']),
        JSON.stringify(uiCalls.registerView.map(([id]) => id)),
      )
      check(
        'UI contributed its now-playing slot',
        uiCalls.contribute.some((d) => d.kind === 'slot' && d.slot === 'now-playing.visualizer'),
        JSON.stringify(uiCalls.contribute),
      )
      check(
        'headless service initialized and contributed its settings section',
        uiCalls.contribute.some((d) => d.kind === 'settings' && d.section === 'playback'),
        JSON.stringify(uiCalls.contribute),
      )
      check(
        'ctx.visualizer is the installed package’s own VisualizerPlugin instance',
        ctx.get('visualizer') instanceof headlessMod.VisualizerPlugin,
      )
    },
    verifyUpdate({ check, uiCalls, tag }) {
      check(
        'reloaded plugin exposes the new marker through its settings contribution',
        uiCalls.contribute.some(
          (d) => d.kind === 'settings' && String(d.description ?? '').includes(tag),
        ),
        JSON.stringify(uiCalls.contribute),
      )
    },
  },

  // The third-party-style example: a combined package authored by hand
  // in `examples/` (not assembled from monorepo pairs), whose registry
  // entry depends on the visualizer package and whose UI consumes the
  // `visualizer` service the closure installs. The world deliberately
  // does NOT seed the visualizer manifest as a builtin: at plan time
  // the service is covered by the closure entry's declared `provides`,
  // at install time by the downloaded package's real manifest.
  'visualizer-meters': {
    pluginId: 'bbebee-plugin-visualizer-meters',
    npmName: 'bbebee-plugin-visualizer-meters',
    versions: ['0.1.0', '0.1.1'],
    source: 'own',
    featureDir: 'examples/visualizer-meters',
    uiDir: null,
    entryFile: 'examples/visualizer-meters/registry-entry.json',
    entryFileName: 'bbebeex-visualizer-meters.json',
    dependencyPackages: [{ target: 'visualizer', version: '0.1.0' }],
    expectClosure: ['bbebeex-visualizer'],
    activationChain: ['bbebeex-visualizer'],
    worldManifests: [
      'packages/core/core-audio-mpv/BBeBee.plugin.json',
      'packages/feature/plugin-settings/BBeBee.plugin.json',
      'packages/feature/plugin-player/BBeBee.plugin.json',
      'packages/feature/plugin-ui/BBeBee.plugin.json',
    ],
    edgeServices: {
      audio: { activeEngineName: 'webaudio' },
      player: {},
    },
    activationSettled: ({ uiCalls, ctx }) =>
      Boolean(ctx.get('visualizer')) &&
      uiCalls.registerView.some(([id]) => id === 'visualizer-meters.canvas'),
    updateMarker: {
      file: 'dist/index.js',
      find: 'Default mode and palette for the spectrogram / spectrum / VU meter views',
      tag: 'pilot build 0.1.1',
    },
    verifyActivation({ check, uiCalls, ctx, mods }) {
      check(
        'meters UI registered its two views',
        JSON.stringify(
          uiCalls.registerView.filter(([id]) => id.startsWith('visualizer-meters.')).map(([id]) => id),
        ) === JSON.stringify(['visualizer-meters.canvas', 'visualizer-meters.settings']),
        JSON.stringify(uiCalls.registerView.map(([id]) => id)),
      )
      check(
        'meters UI contributed the now-playing visualizer slot',
        uiCalls.contribute.some(
          (d) => d.kind === 'slot' && d.slot === 'now-playing.visualizer' && d.id === 'visualizer-meters.canvas',
        ),
        JSON.stringify(uiCalls.contribute),
      )
      check(
        'meters headless contributed its settings card metadata',
        uiCalls.contribute.some(
          (d) => d.kind === 'settings' && d.id === 'visualizer-meters.settings' && d.section === 'playback',
        ),
        JSON.stringify(uiCalls.contribute),
      )
      check(
        'ctx.visualizer is the closure-installed visualizer package’s own instance',
        ctx.get('visualizer') instanceof mods['bbebeex-visualizer'].headless.VisualizerPlugin,
      )
    },
    verifyUpdate({ check, uiCalls, tag }) {
      check(
        'reloaded meters exposes the new marker through its settings contribution',
        uiCalls.contribute.some(
          (d) =>
            d.kind === 'settings' &&
            d.id === 'visualizer-meters.settings' &&
            String(d.description ?? '').includes(tag),
        ),
        JSON.stringify(uiCalls.contribute),
      )
    },
  },
}
