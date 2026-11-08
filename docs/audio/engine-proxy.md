# Engine proxy support — the `BBeBeeX/B_Be_Bee-audio-engine` change

The monorepo side of proxy-marked playback is engine-agnostic: `LoadOptions.proxy`
crosses the bridge as a **boolean**, and the platform layer behind it (the desktop
sidecar's audio host, the mobile bridge) translates the wish. What the translation
does depends on whether the engine build honours a per-load proxy. This document is
the spec for that engine change — applied in `B_Be_Bee-audio-engine`, then shipped
through the existing `audio-engine.version.json` pin + `scripts/fetch-audio-engine.mjs`
flow (SHA256-verified, full/slim packages).

## The wire contract (already implemented in the monorepo)

Load/append action options gain one field:

```json
{ "action": "load", "uri": "https://cdn.example/track.flac",
  "options": { "strategy": "stream", "headers": {"Referer": "…"}, "proxyUrl": "http://user:pass@127.0.0.1:7890" } }
```

- `proxyUrl` is resolved by the audio host from the custodied proxy config — the
  renderer never sees it. `http/https` proxies only: **socks5 stays on the loopback
  relay** (the monorepo's fallback), because libavformat's socks support through
  `http-proxy` is not something we rely on.
- The engine sets mpv's `http-proxy` property **for this one file** and clears it
  (`""`) when the next load/append carries no `proxyUrl` — engine-global, exactly
  the semantics the existing `http-header-fields` property already has (set before
  each load/append; the gapless-appended file inherits what was last set).
- The `ready` message and `engineStatus` gain `proxySupported: true` — the monorepo
  gates the `proxyUrl` hand-off on it, because an older build silently ignores
  unknown load options and would play direct (the one failure a blocked host
  cannot recover from). Absent field = not supported.

## Desktop engine (C++)

In the load/append action handler, where `options.headers` is already read:

```cpp
// options is the JSON object under "options"; proxyUrl optional.
const json proxy = options.value("proxyUrl", json::value_t::null);
const char* proxy = proxy.is_string() ? proxy.get<std::string>().c_str() : "";
if (_mpv) mpv_set_property_string(_mpv, "http-proxy", proxy);
// …existing http-header-fields set + loadfile/append unchanged…
```

And the `ready` answer gains the capability flag:

```cpp
json ready = { {"type", "ready"}, {"mpvAvailable", mpv_ok}, {"pcmTapAvailable", tap_ok},
               {"proxySupported", true} };
```

## Android JNI (`engine/jni/bbebee_audio_jni.cpp`)

Two new exports (the 2-arg `nativeLoadEx`/`nativeAppend` stay for compatibility —
the Kotlin module feature-detects by catching `UnsatisfiedLinkError`):

```cpp
JNIEXPORT jstring JNICALL
Java_org_bbebee_audio_BBeBeeAudioEngine_nativeLoadExProxy(
    JNIEnv* env, jclass, jstring uri, jstring headers, jstring proxy_url) {
  // set http-proxy (or clear) → delegate to the existing nativeLoadEx path
}

JNIEXPORT jstring JNICALL
Java_org_bbebee_audio_BBeBeeAudioEngine_nativeAppendProxy(
    JNIEnv* env, jclass, jstring uri, jstring headers, jstring proxy_url) {
  // set http-proxy (or clear) → delegate to the existing nativeAppend path
}
```

The `ready`/engine-status JSON gains `"proxySupported": true`, same as desktop.

## iOS — no engine change

`BbebeeMpvCore` drives the bundled `mpv.framework` directly from this monorepo
(`apps/mobile/modules/audio-engine/ios/`), so iOS proxy support is implemented
in-repo: `loadEx:headers:proxy:` / `appendUri:headers:proxy:` set the `http-proxy`
property and the Expo module exposes `loadExProxy`/`appendProxy`.

## What the monorepo does with it (recap)

| engine build | proxy-marked stream (http/https proxy) | proxy-marked stream (socks5) |
|---|---|---|
| honours `proxyUrl` (`proxySupported: true`) | engine dials the proxy itself — relay unused | loopback relay (unchanged) |
| older build | loopback relay rewrite (URI swapped before `loadfile`, headers registered server-side) | loopback relay |

The relay (`apps/desktop/sidecar/relay.ts` on desktop, the `BbebeeHttpProxy`
module's relay on mobile) remains the fallback until the pinned engine floor
bumps past the change above; at that point it can be retired and the
`isProxySupported()` gate flips by construction.

## Verification matrix (engine repo, before release)

1. http proxy → http target, https target (CONNECT): playback, seek (Range through
   the proxy), gapless append of a proxied next track.
2. proxy with Basic auth: 407 → auth → playback.
3. `proxyUrl` cleared by the next unproxied load: a direct stream must not hit the
   proxy (and the reverse: a proxied load right after a direct one must not miss it).
4. `ready` reports `proxySupported: true`; the monorepo log shows the
   `proxyUrl`-mode hand-off (no relay registration line).
