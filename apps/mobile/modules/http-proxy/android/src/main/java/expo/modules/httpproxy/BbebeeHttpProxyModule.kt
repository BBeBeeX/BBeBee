package expo.modules.httpproxy

import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.TimeUnit
import okhttp3.Authenticator
import okhttp3.Credentials
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route

/**
 * `BbebeeHttpProxy` — one stateless, proxy-dialing HTTP call per invocation.
 *
 * The JS adapter (`modules/http-proxy/index.ts`) installs this module's
 * surface as `globalThis.bbebeeProxyHttp`, the seam `HttpRn` uses for
 * requests the settings marked `useProxy`. The proxy config travels with
 * every call — there is no native state to invalidate when settings change.
 *
 * Redirects are deliberately NOT followed: `HttpNode.followRedirects` loops
 * in JS so every hop re-checks the host allowlist and re-injects cookies.
 *
 * Supported proxy shapes:
 *  - `http`/`https` (TLS-to-proxy) with Basic auth — `Proxy.Type.HTTP` +
 *    `proxyAuthenticator`;
 *  - `socks5` **without** auth — `Proxy.Type.SOCKS` (the local-Clash case).
 *    Java's SOCKS socket has no user/password hook OkHttp can reach, so
 *    authenticated SOCKS5 is refused up front rather than silently
 *    connecting unauthenticated — the caller sees the error instead of a
 *    proxy that drops or mangles the exchange.
 *
 * Everything is an `AsyncFunction` on purpose: the blocking `execute()` runs
 * on the module's dedicated thread, never the JS thread.
 */
class BbebeeHttpProxyModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("BbebeeHttpProxy")

        AsyncFunction("proxyFetch") { options: Map<String, Any?>, promise: Promise ->
            try {
                promise.resolve(proxyFetch(options))
            } catch (e: Exception) {
                promise.reject("E_HTTP_PROXY", e.message ?: "proxied fetch failed", e)
            }
        }
    }

    private fun proxyFetch(options: Map<String, Any?>): Map<String, Any?> {
        val url = options["url"] as? String ?: throw IllegalArgumentException("url is required")
        val method = (options["method"] as? String ?: "GET").uppercase()
        val headersIn = options["headers"] as? Map<*, *> ?: emptyMap<Any, Any>()
        val bodyBase64 = options["bodyBase64"] as? String
        val timeoutMs = (options["timeoutMs"] as? Number)?.toLong() ?: 30_000L
        val proxyOptions = options["proxy"] as? Map<*, *>
            ?: throw IllegalArgumentException("proxy config is required")

        val protocol = proxyOptions["protocol"] as? String ?: "http"
        val host = proxyOptions["host"] as? String ?: throw IllegalArgumentException("proxy host is required")
        val port = (proxyOptions["port"] as? Number)?.toInt()
            ?: throw IllegalArgumentException("proxy port is required")
        val username = proxyOptions["username"] as? String
        val password = proxyOptions["password"] as? String

        val builder = OkHttpClient.Builder()
            // One-shot call: no shared pool to keep alive between requests, and
            // `callTimeout` bounds the whole exchange so a dead proxy cannot
            // hold the module thread forever.
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .callTimeout(timeoutMs + 5_000, TimeUnit.MILLISECONDS)
            .followRedirects(false)
            .followSslRedirects(false)

        when (protocol) {
            "socks5" -> {
                if (!username.isNullOrEmpty() || !password.isNullOrEmpty()) {
                    throw IllegalArgumentException(
                        "authenticated SOCKS5 proxies are not supported on this platform; use an HTTP proxy or a proxy without credentials",
                    )
                }
                builder.proxy(Proxy(Proxy.Type.SOCKS, InetSocketAddress.createUnresolved(host, port)))
            }
            else -> {
                // `https` here means TLS to the proxy itself; OkHttp dials the
                // proxy address as given and CONNECT-tunnels to the target.
                builder.proxy(Proxy(Proxy.Type.HTTP, InetSocketAddress.createUnresolved(host, port)))
                if (!username.isNullOrEmpty() || !password.isNullOrEmpty()) {
                    val credentials = Credentials.basic(username ?: "", password ?: "")
                    builder.proxyAuthenticator(Authenticator { _: Route?, response: Response ->
                        if (response.request.header("Proxy-Authorization") != null) {
                            null // Already offered; a second challenge is a refusal.
                        } else {
                            response.request.newBuilder()
                                .header("Proxy-Authorization", credentials)
                                .build()
                        }
                    })
                }
            }
        }

        val requestBuilder = Request.Builder().url(url)
        for ((name, value) in headersIn) {
            if (name is String && value is String) requestBuilder.header(name, value)
        }
        if (bodyBase64 != null && method != "GET" && method != "HEAD") {
            val bytes = Base64.decode(bodyBase64, Base64.DEFAULT)
            val mediaType = headersIn.entries
                .firstOrNull { (it.key as? String)?.lowercase() == "content-type" }
                ?.value as? String
            requestBuilder.method(method, bytes.toRequestBody(mediaType?.toMediaTypeOrNull()))
        } else if (method != "GET" && method != "HEAD") {
            requestBuilder.method(method, ByteArray(0).toRequestBody(null))
        } else {
            requestBuilder.method(method, null)
        }

        val client = builder.build()
        client.newCall(requestBuilder.build()).execute().use { response ->
            val bytes = response.body?.bytes() ?: ByteArray(0)
            val headerPairs = ArrayList<List<String>>()
            for (name in response.headers.names()) {
                // `values(name)` keeps every occurrence separate — what
                // `listSetCookies` needs for multi-cookie sign-ins.
                for (value in response.headers.values(name)) {
                    headerPairs.add(listOf(name, value))
                }
            }
            return mapOf(
                "status" to response.code,
                "statusText" to (response.message ?: ""),
                "url" to response.request.url.toString(),
                "headers" to headerPairs,
                "bodyBase64" to Base64.encodeToString(bytes, Base64.DEFAULT),
            )
        }
    }
}
