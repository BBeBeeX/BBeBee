import type { HttpService, JsService, LyricSearchQuery, LyricSourceDefinition } from '@BBeBee/protocol'

/**
 * Checks whether an outbound target URL is allowed by the source's allowedHosts.
 */
export function checkAllowedHost(urlStr: string, allowedHosts?: string[]): void {
  if (!allowedHosts || allowedHosts.length === 0) return
  let hostname: string
  try {
    const url = new URL(urlStr)
    hostname = url.hostname.toLowerCase()
  } catch {
    throw new Error(`Invalid URL for httpFetch: "${urlStr}"`)
  }

  const isAllowed = allowedHosts.some((pattern) => {
    const target = pattern.toLowerCase().trim()
    return hostname === target || hostname.endsWith(`.${target}`)
  })

  if (!isAllowed) {
    throw new Error(
      `Outbound HTTP request to host "${hostname}" is blocked: not in allowedHosts (${allowedHosts.join(', ')})`,
    )
  }
}

/**
 * Safe fetch bridge exposed to the sandbox.
 */
export async function safeHttpFetch(
  url: string,
  options?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    timeoutMs?: number
  },
  httpService?: HttpService,
  allowedHosts?: string[],
): Promise<{
  status: number
  text: () => Promise<string>
  json: () => Promise<unknown>
  body: string
}> {
  checkAllowedHost(url, allowedHosts)

  const timeoutMs = options?.timeoutMs ?? 8000

  if (httpService) {
    const method = (options?.method?.toUpperCase() ?? 'GET') as
      | 'GET'
      | 'POST'
      | 'PUT'
      | 'DELETE'
      | 'HEAD'
      | 'PATCH'
    const resp = await httpService({
      url,
      method,
      headers: options?.headers,
      body: options?.body,
      timeoutMs,
    })
    const textData = await resp.text()
    return {
      status: resp.status,
      text: async () => textData,
      json: async () => {
        try {
          return JSON.parse(textData)
        } catch {
          return null
        }
      },
      body: textData,
    }
  }

  // Fallback to global web fetch
  const res = await fetch(url, {
    method: options?.method ?? 'GET',
    headers: options?.headers,
    body: options?.body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const textData = await res.text()
  return {
    status: res.status,
    text: async () => textData,
    json: async () => {
      try {
        return JSON.parse(textData)
      } catch {
        return null
      }
    },
    body: textData,
  }
}

export interface SandboxServices {
  js?: JsService
  http?: HttpService
}

/**
 * Executes a third-party lyric source script within an isolated sandbox.
 * Strictly limits input to only `{ title, artist, duration }`.
 */
export async function executeLyricSource(
  source: LyricSourceDefinition,
  rawQuery: LyricSearchQuery,
  services: SandboxServices = {},
): Promise<unknown> {
  // Enforce strict data boundary: title, artist, duration, and optional source config
  const sanitizedQuery = Object.freeze({
    title: String(rawQuery.title ?? ''),
    artist: String(rawQuery.artist ?? ''),
    duration: Math.round(Number(rawQuery.duration ?? 0)),
    ...(source.config !== undefined ? { config: Object.freeze({ ...source.config }) } : {}),
  })

  // 1. If QuickJS realm service (ctx.js) is available, use real engine realm
  if (services.js) {
    const realm = await services.js.createRealm({
      timeoutMs: 4000,
      budgetMs: 12000,
      memoryBytes: 16 * 1024 * 1024,
    })

    try {
      realm.expose('httpFetch', async (urlArg: unknown, optionsArg?: unknown) => {
        const url = String(urlArg ?? '')
        const options =
          optionsArg && typeof optionsArg === 'object'
            ? (optionsArg as Record<string, unknown>)
            : {}
        const result = await safeHttpFetch(
          url,
          {
            method: typeof options.method === 'string' ? options.method : undefined,
            headers:
              typeof options.headers === 'object' && options.headers !== null
                ? (options.headers as Record<string, string>)
                : undefined,
            body: typeof options.body === 'string' ? options.body : undefined,
            timeoutMs: typeof options.timeoutMs === 'number' ? options.timeoutMs : undefined,
          },
          services.http,
          source.allowedHosts,
        )
        return {
          status: result.status,
          body: result.body,
        }
      })

      // Script runner wrapper with standard Web API polyfills for QuickJS realm
      const runner = `
      (async () => {
        // Polyfill URLSearchParams if missing
        if (typeof URLSearchParams === 'undefined') {
          globalThis.URLSearchParams = class URLSearchParams {
            constructor(init) {
              this._entries = [];
              if (typeof init === 'string') {
                const s = init.startsWith('?') ? init.slice(1) : init;
                if (s) {
                  for (const pair of s.split('&')) {
                    const idx = pair.indexOf('=');
                    if (idx !== -1) {
                      this._entries.push([decodeURIComponent(pair.slice(0, idx)), decodeURIComponent(pair.slice(idx + 1))]);
                    } else {
                      this._entries.push([decodeURIComponent(pair), '']);
                    }
                  }
                }
              } else if (Array.isArray(init)) {
                this._entries = init.map(([k, v]) => [String(k), String(v)]);
              } else if (init && typeof init === 'object') {
                for (const [k, v] of Object.entries(init)) {
                  if (v !== undefined && v !== null) {
                    this._entries.push([String(k), String(v)]);
                  }
                }
              }
            }
            append(k, v) { this._entries.push([String(k), String(v)]); }
            set(k, v) {
              const key = String(k);
              const val = String(v);
              let replaced = false;
              this._entries = this._entries.filter(([ek]) => {
                if (ek === key) {
                  if (!replaced) { replaced = true; return true; }
                  return false;
                }
                return true;
              });
              if (replaced) {
                const idx = this._entries.findIndex(([ek]) => ek === key);
                this._entries[idx] = [key, val];
              } else {
                this._entries.push([key, val]);
              }
            }
            get(k) {
              const item = this._entries.find(([ek]) => ek === String(k));
              return item ? item[1] : null;
            }
            getAll(k) {
              return this._entries.filter(([ek]) => ek === String(k)).map(([, v]) => v);
            }
            has(k) {
              return this._entries.some(([ek]) => ek === String(k));
            }
            delete(k) {
              this._entries = this._entries.filter(([ek]) => ek !== String(k));
            }
            toString() {
              return this._entries
                .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
                .join('&');
            }
          };
        }

        // Polyfill basic URL if missing
        if (typeof URL === 'undefined') {
          globalThis.URL = class URL {
            constructor(urlStr, base) {
              let full = String(urlStr);
              if (base) {
                full = String(base).replace(/\\/+$/, '') + '/' + full.replace(/^\\/+/, '');
              }
              this.href = full;
              const qIdx = full.indexOf('?');
              const hashIdx = full.indexOf('#');
              let pathAndQuery = full;
              if (hashIdx !== -1) {
                this.hash = full.slice(hashIdx);
                pathAndQuery = full.slice(0, hashIdx);
              } else {
                this.hash = '';
              }
              if (qIdx !== -1) {
                this.search = pathAndQuery.slice(qIdx);
                this.searchParams = new URLSearchParams(this.search);
                this.pathname = pathAndQuery.slice(0, qIdx);
              } else {
                this.search = '';
                this.searchParams = new URLSearchParams();
                this.pathname = pathAndQuery;
              }
            }
            toString() { return this.href; }
          };
        }

        // Wrap httpFetch with .json() and .text() convenience methods
        const __rawHttpFetch__ = typeof httpFetch === 'function' ? httpFetch : undefined;
        if (__rawHttpFetch__) {
          httpFetch = async function(url, options) {
            const rawRes = await __rawHttpFetch__(url, options);
            if (!rawRes) return rawRes;
            const bodyStr = typeof rawRes.body === 'string' ? rawRes.body : '';
            return {
              status: rawRes.status,
              statusText: rawRes.status === 200 ? 'OK' : 'Status ' + rawRes.status,
              ok: rawRes.status >= 200 && rawRes.status < 300,
              body: bodyStr,
              text: async () => bodyStr,
              json: async () => {
                try {
                  return JSON.parse(bodyStr);
                } catch (_) {
                  return null;
                }
              },
            };
          };
        }

        // User script
        const config = typeof __config__ === 'object' && __config__ !== null ? __config__ : {};
        ${source.script}

        if (typeof searchLyrics === 'function') {
          return await searchLyrics(__query__);
        }
        if (typeof main === 'function') {
          return await main(__query__);
        }
        if (typeof getLyrics === 'function') {
          return await getLyrics(__query__);
        }
        return null;
      })()
      `

      return await realm.eval(runner, { __query__: sanitizedQuery, __config__: source.config ?? {} })
    } finally {
      realm.dispose()
    }
  }

  // 2. Fallback execution when ctx.js is not present (e.g. testing or environments without native QuickJS)
  const boundHttpFetch = async (url: string, options?: Parameters<typeof safeHttpFetch>[1]) => {
    const res = await safeHttpFetch(url, options, services.http, source.allowedHosts)
    return {
      status: res.status,
      text: res.text,
      json: res.json,
      body: res.body,
    }
  }

  // Strictly shadow dangerous host variables
  const wrappedFunction = new Function(
    '__query__',
    'httpFetch',
    'config',
    'window',
    'document',
    'process',
    'require',
    'global',
    'globalThis',
    `"use strict";
     ${source.script}
     if (typeof searchLyrics === 'function') return searchLyrics(__query__);
     if (typeof main === 'function') return main(__query__);
     if (typeof getLyrics === 'function') return getLyrics(__query__);
     return null;`,
  )

  const executionPromise = Promise.resolve().then(() =>
    wrappedFunction(
      sanitizedQuery,
      boundHttpFetch,
      source.config ?? {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ),
  )

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Lyric source execution timed out after 10000ms')), 10000),
  )

  return await Promise.race([executionPromise, timeoutPromise])
}
