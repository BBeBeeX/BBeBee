package expo.modules.httpproxy

import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import okhttp3.Authenticator
import okhttp3.Credentials
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route

/**
 * `BbebeeHttpProxy` — proxy-dialing HTTP for the app, two surfaces:
 *
 *  - `proxyFetch`: one stateless, proxy-dialing HTTP call per invocation —
 *    the seam `HttpRn` uses for requests the settings marked `useProxy`. The
 *    proxy config travels with every call — there is no native state to
 *    invalidate when settings change.
 *  - `relayRegister`: one registration in the **loopback stream relay** —
 *    the seam `core-audio-mpv` uses to give proxy-marked playback streams a
 *    URL mpv can play. mpv fetches `http://127.0.0.1:<port>/s/<token>`;
 *    the relay dials the real upstream through the registered proxy and
 *    pipes the bytes, forwarding the Range exchanges seeking depends on.
 *
 * For `proxyFetch`, redirects are deliberately NOT followed:
 * `HttpNode.followRedirects` loops in JS so every hop re-checks the host
 * allowlist and re-injects cookies. The relay, in contrast, follows them —
 * the upstream was registered by the shell, and mpv itself follows
 * redirects when it plays direct.
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
 * Everything is an `AsyncFunction` on purpose: the blocking work runs on the
 * module's dedicated thread, never the JS thread; the relay's accept loop
 * and per-connection work run on daemon threads of its own.
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

        AsyncFunction("relayRegister") { options: Map<String, Any?> ->
            relayRegister(options)
        }
    }

    // ── proxyFetch ────────────────────────────────────────────────────────

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

    // ── the loopback stream relay ─────────────────────────────────────────

    private class RelayEntry(
        val url: String,
        val headers: Map<String, String>,
        val proxy: Map<String, Any?>,
    ) {
        val createdAt: Long = System.currentTimeMillis()
        @Volatile var lastAccess: Long = createdAt
    }

    private val relayEntries = ConcurrentHashMap<String, RelayEntry>()
    private val relayServer = AtomicReference<ServerSocket?>(null)
    private val relayRandom = SecureRandom()

    /** Ceiling on live registrations — a loop must evict, not grow. */
    private val relayMaxEntries = 128
    /** Registrations outlive any sane track; a seek reuses the same token. */
    private val relayEntryTtlMs = 2 * 60 * 60 * 1000L

    private fun relayRegister(options: Map<String, Any?>): Map<String, Any?> {
        val url = options["url"] as? String ?: throw IllegalArgumentException("url is required")
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            throw IllegalArgumentException("only http/https upstreams are served")
        }
        @Suppress("UNCHECKED_CAST")
        val headers = (options["headers"] as? Map<String, String>) ?: emptyMap()
        @Suppress("UNCHECKED_CAST")
        val proxy = options["proxy"] as? Map<String, Any?>
            ?: throw IllegalArgumentException("proxy config is required")

        val server = ensureRelayServer()
        sweepRelay()

        val token = ByteArray(16).also { relayRandom.nextBytes(it) }
            .joinToString("") { "%02x".format(it) }
        relayEntries[token] = RelayEntry(url, headers, proxy)
        return mapOf("url" to "http://127.0.0.1:${server.localPort}/s/$token")
    }

    /** Lazily start the loopback listener; the port is the OS's choice. */
    private fun ensureRelayServer(): ServerSocket {
        relayServer.get()?.let { return it }
        synchronized(this) {
            relayServer.get()?.let { return it }
            val server = ServerSocket(0, 64, InetAddress.getLoopbackAddress())
            val acceptThread = Thread({
                while (!server.isClosed) {
                    val socket = try {
                        server.accept()
                    } catch (_: Exception) {
                        return@Thread
                    }
                    relayExecutor.execute { handleRelayConnection(socket) }
                }
            }, "bbebee-relay-accept")
            acceptThread.isDaemon = true
            acceptThread.start()
            relayServer.set(server)
            return server
        }
    }

    private val relayExecutor = Executors.newFixedThreadPool(4) { runnable ->
        Thread(runnable, "bbebee-relay-io").apply { isDaemon = true }
    }

    private fun sweepRelay() {
        val now = System.currentTimeMillis()
        relayEntries.entries.removeIf { now - it.value.lastAccess > relayEntryTtlMs }
        while (relayEntries.size >= relayMaxEntries) {
            relayEntries.entries
                .minByOrNull { it.value.lastAccess }
                ?.let { relayEntries.remove(it.key) }
                ?: break
        }
    }

    /** mpv's exchange-shaping headers, forwarded upstream alongside the source's own. */
    private val relayForwardedRequestHeaders =
        setOf("range", "if-range", "accept", "accept-encoding", "icy-metadata")

    /** Hop-by-hop and session-shaped response headers never handed to mpv. */
    private val relayDroppedResponseHeaders =
        setOf(
            "connection", "keep-alive", "transfer-encoding", "upgrade",
            "proxy-authenticate", "proxy-authorization", "set-cookie",
            "strict-transport-security",
        )

    private fun handleRelayConnection(socket: Socket) {
        try {
            socket.tcpNoDelay = true
            socket.soTimeout = 15_000
            val input = socket.getInputStream().bufferedReader(Charsets.ISO_8859_1)
            val requestLine = input.readLine() ?: return
            val parts = requestLine.split(" ")
            if (parts.size < 2) return
            val method = parts[0].uppercase()
            val path = parts[1]

            val requestHeaders = HashMap<String, String>()
            while (true) {
                val line = input.readLine() ?: break
                if (line.isEmpty()) break
                val idx = line.indexOf(':')
                if (idx > 0) {
                    requestHeaders[line.substring(0, idx).trim().lowercase()] = line.substring(idx + 1).trim()
                }
            }

            val token = Regex("^/s/([0-9a-f]+)$").find(path)?.groupValues?.get(1)
            val entry = token?.let { relayEntries[it] }
            val output = socket.getOutputStream()
            if (entry == null) {
                // A token is capability, not identity: unknown and expired get
                // the same flat 404, with nothing to distinguish them for a prober.
                writeSimpleResponse(output, "HTTP/1.1 404 Not Found", "not found")
                return
            }
            entry.lastAccess = System.currentTimeMillis()

            val builder = Request.Builder().url(entry.url)
            for (name in relayForwardedRequestHeaders) {
                requestHeaders[name]?.let { builder.header(name, it) }
            }
            for ((name, value) in entry.headers) builder.header(name, value)

            val call = relayClient(entry.proxy).newCall(builder.build())
            try {
                call.execute().use { response ->
                    writeRelayResponse(output, method, response)
                }
            } catch (_: Exception) {
                // Client abort or upstream failure mid-stream: the write to a
                // closed mpv socket throws, `use` closes the OkHttp response,
                // and the upstream connection is released with it.
                try {
                    socket.close()
                } catch (_: Exception) {
                    // The socket dying is the point.
                }
            }
        } catch (_: Exception) {
            try {
                socket.close()
            } catch (_: Exception) {
                // The socket dying is the point.
            }
        }
    }

    private fun writeSimpleResponse(output: OutputStream, statusLine: String, body: String) {
        val bytes = body.toByteArray(Charsets.ISO_8859_1)
        val head = "$statusLine\r\nContent-Type: text/plain\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
        output.write(head.toByteArray(Charsets.ISO_8859_1))
        output.write(bytes)
        output.flush()
    }

    private fun writeRelayResponse(output: OutputStream, method: String, response: Response) {
        val head = StringBuilder("HTTP/1.1 ${response.code} ${response.message ?: ""}\r\n")
        var contentLength: Long = -1
        var contentEncoding: String? = null
        for ((name, value) in response.headers) {
            val lower = name.lowercase()
            when {
                lower in relayDroppedResponseHeaders -> continue
                lower == "content-length" -> {
                    contentLength = value.toLongOrNull() ?: -1
                    continue
                }
                lower == "content-encoding" -> {
                    contentEncoding = value
                    continue
                }
            }
            head.append("$name: $value\r\n")
        }
        // OkHttp decodes a transparently-negotiated gzip body; the decoded
        // byte count no longer matches the upstream Content-Length, so a
        // compressed exchange is delimited by connection close instead.
        val decoded = contentEncoding != null
        if (contentLength >= 0 && !decoded) {
            head.append("Content-Length: $contentLength\r\n")
        }
        head.append("Connection: close\r\n\r\n")
        output.write(head.toString().toByteArray(Charsets.ISO_8859_1))
        output.flush()
        if (method == "HEAD") return
        response.body?.byteStream()?.use { upstream ->
            upstream.copyTo(output, 64 * 1024)
        }
        output.flush()
    }

    /** OkHttp client for one relayed stream: follows redirects, proxy per registration. */
    private fun relayClient(proxyOptions: Map<String, Any?>): OkHttpClient {
        val builder = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)

        val protocol = proxyOptions["protocol"] as? String ?: "http"
        val host = proxyOptions["host"] as? String
        val port = (proxyOptions["port"] as? Number)?.toInt()
        val username = proxyOptions["username"] as? String
        val password = proxyOptions["password"] as? String
        if (host != null && port != null && port > 0) {
            when (protocol) {
                "socks5" -> if (username.isNullOrEmpty() && password.isNullOrEmpty()) {
                    builder.proxy(Proxy(Proxy.Type.SOCKS, InetSocketAddress.createUnresolved(host, port)))
                }
                else -> {
                    builder.proxy(Proxy(Proxy.Type.HTTP, InetSocketAddress.createUnresolved(host, port)))
                    if (!username.isNullOrEmpty() || !password.isNullOrEmpty()) {
                        val credentials = Credentials.basic(username ?: "", password ?: "")
                        builder.proxyAuthenticator(Authenticator { _: Route?, response: Response ->
                            if (response.request.header("Proxy-Authorization") != null) {
                                null
                            } else {
                                response.request.newBuilder()
                                    .header("Proxy-Authorization", credentials)
                                    .build()
                            }
                        })
                    }
                }
            }
        }
        return builder.build()
    }
}
