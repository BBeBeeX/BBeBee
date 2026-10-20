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
 *   featureDir / uiDir   repo-relative package directories (`uiDir`
 *                        may be null for a headless-only package).
 *   entry                registry entry fields other than `id`/`npm`
 *                        (the loop injects those from the identity
 *                        above, so they cannot drift apart).
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
 *                        headlessMod, uiMod }) => void.
 *   verifyUpdate         optional hook asserting the update's marker
 *                        is observable after reload: ({ check,
 *                        uiCalls, tag }) => void.
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
    ],
    syntheticManifests: [
      {
        // The shell's `ui` service: ui-kit-desktop provides it at
        // runtime but ships no standard manifest file, so the
        // composition mirrors the runtime truth with a synthetic one.
        id: '@BBeBee/ui-kit-desktop',
        name: '@BBeBee/ui-kit-desktop',
        displayName: 'UI Kit (Desktop)',
        description: 'Shell UI service (synthetic manifest for the pilot composition).',
        version: '0.0.0',
        author: 'BBeBee Team',
        engines: { BBeBee: '^0.1.0' },
        enabled: true,
        dependencies: [],
        systemId: 'layer-5',
        moduleId: 'ui',
        entry: { main: './dist/index.js' },
        capabilities: [],
        contributes: { services: ['ui'] },
        effect: 'ui',
      },
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
}
