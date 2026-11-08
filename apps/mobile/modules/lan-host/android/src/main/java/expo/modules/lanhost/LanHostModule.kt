package expo.modules.lanhost

import android.annotation.SuppressLint
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.InetAddress
import java.net.MulticastSocket
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * `BbebeeLanHost` — the mobile half of `ctx.lan`: real UDP and TCP sockets,
 * the same contract `core-lan-desktop`'s sidecar host honours on the desktop.
 *
 *   - `start` binds a `MulticastSocket` (with a `MulticastLock` — without it
 *     Android silently drops multicast datagrams) and a `ServerSocket` on
 *     0.0.0.0, then pushes inbound datagrams and HTTP requests to JS as
 *     `onLanDatagram` / `onLanRequest` events.
 *   - `replyRequest` answers a parked request; an unanswered one times out
 *     (30 s) with a 504, so a crashed handler cannot hold a peer's socket.
 *   - `request` dials a peer over OkHttp; the private-address check lives in
 *     the JS adapter (this layer trusts its single gated caller).
 *   - A reply may name a `bodyFile` (with an optional inclusive
 *     `bodyFileStart`/`bodyFileEnd` slice) — that is how a local track is
 *     served to the LAN with Range/206 seeking without moving the bytes
 *     through Hermes.
 *
 * Everything is an `AsyncFunction` on purpose: blocking work runs off the JS
 * thread; the accept and receive loops run on daemon threads of their own.
 */
class LanHostModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("BbebeeLanHost")

        Events("onLanDatagram", "onLanRequest")

        AsyncFunction("start") { options: Map<String, Any?>, promise: Promise ->
            try {
                promise.resolve(start(options))
            } catch (e: Exception) {
                promise.reject("E_LAN_START", e.message ?: "lan start failed", e)
            }
        }

        AsyncFunction("stop") { promise: Promise ->
            try {
                stopInternal()
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("E_LAN_STOP", e.message ?: "lan stop failed", e)
            }
        }

        AsyncFunction("sendDatagram") { options: Map<String, Any?>, promise: Promise ->
            try {
                sendDatagram(options)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("E_LAN_DGRAM", e.message ?: "sendDatagram failed", e)
            }
        }

        AsyncFunction("request") { options: Map<String, Any?>, promise: Promise ->
            try {
                promise.resolve(request(options))
            } catch (e: Exception) {
                promise.reject("E_LAN_REQUEST", e.message ?: "request failed", e)
            }
        }

        AsyncFunction("replyRequest") { options: Map<String, Any?>, promise: Promise ->
            try {
                val id = options["id"] as? String ?: throw IllegalArgumentException("id is required")
                val parked = pending.remove(id)
                if (parked == null) {
                    // Timed out or the peer walked away — a documented no-op.
                    promise.resolve(null)
                    return@AsyncFunction
                }
                parked.complete(options)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("E_LAN_REPLY", e.message ?: "replyRequest failed", e)
            }
        }

        OnDestroy {
            stopInternal()
        }
    }

    // ── start / stop ──────────────────────────────────────────────────────

    private val udp = AtomicReference<MulticastSocket?>(null)
    private val server = AtomicReference<ServerSocket?>(null)
    private var multicastLock: Any? = null
    private var spillDir: File? = null
    private val pending = ConcurrentHashMap<String, CompletableFuture<Map<String, Any?>?>>()

    private val ioExecutor = Executors.newFixedThreadPool(8) { runnable ->
        Thread(runnable, "bbebee-lan-io").apply { isDaemon = true }
    }

    @SuppressLint("DiscouragedPrivateApi")
    private fun start(options: Map<String, Any?>): Map<String, Any?> {
        val udpPort = (options["udpPort"] as? Number)?.toInt() ?: 0
        val httpPort = (options["httpPort"] as? Number)?.toInt() ?: 0
        val group = options["multicastGroup"] as? String ?: "239.255.42.98"
        if (udp.get() != null || server.get() != null) {
            return mapOf(
                "udpPort" to udp.get()?.localPort,
                "httpPort" to server.get()?.localPort,
            )
        }

        val context = appContext.reactContext
            ?: throw IllegalStateException("lan: no application context")
        val cacheDir = context.cacheDir.resolve("bbebee-lan").apply { mkdirs() }
        spillDir = cacheDir

        // Multicast is dropped by the Wi-Fi driver unless the lock is held.
        val wifi = context.applicationContext.getSystemService(android.content.Context.WIFI_SERVICE) as? android.net.wifi.WifiManager
        if (wifi != null) {
            val lock = wifi.createMulticastLock("bbebee-lan")
            lock.setReferenceCounted(false)
            lock.acquire()
            multicastLock = lock
        }

        val socket = MulticastSocket(udpPort)
        socket.reuseAddress = true
        socket.broadcast = true
        try {
            socket.joinGroup(InetAddress.getByName(group))
        } catch (_: Exception) {
            // Some interfaces refuse group membership (hotspot, VPN). Broadcast
            // announce still works; discovery just degrades gracefully.
        }
        udp.set(socket)
        val receiveThread = Thread({
            val buffer = ByteArray(64 * 1024)
            while (!socket.isClosed) {
                try {
                    val packet = DatagramPacket(buffer, buffer.size)
                    socket.receive(packet)
                    val data = ByteArray(packet.length)
                    System.arraycopy(packet.data, packet.offset, data, 0, packet.length)
                    sendEvent(
                        "onLanDatagram",
                        mapOf(
                            "host" to (packet.address?.hostAddress ?: ""),
                            "port" to packet.port,
                            "dataBase64" to Base64.encodeToString(data, Base64.NO_WRAP),
                        ),
                    )
                } catch (_: Exception) {
                    if (socket.isClosed) return@Thread
                }
            }
        }, "bbebee-lan-udp")
        receiveThread.isDaemon = true
        receiveThread.start()

        val bound = ServerSocket(httpPort, 128, InetAddress.getByAddress(byteArrayOf(0, 0, 0, 0)))
        server.set(bound)
        val acceptThread = Thread({
            while (!bound.isClosed) {
                val client = try {
                    bound.accept()
                } catch (_: Exception) {
                    return@Thread
                }
                ioExecutor.execute { handleConnection(client) }
            }
        }, "bbebee-lan-accept")
        acceptThread.isDaemon = true
        acceptThread.start()

        return mapOf("udpPort" to socket.localPort, "httpPort" to bound.localPort)
    }

    private fun stopInternal() {
        udp.getAndSet(null)?.close()
        server.getAndSet(null)?.close()
        (multicastLock as? android.net.wifi.WifiManager.MulticastLock)?.let { lock ->
            if (lock.isHeld) lock.release()
        }
        multicastLock = null
        for (future in pending.values) future.cancel(false)
        pending.clear()
    }

    // ── datagrams ─────────────────────────────────────────────────────────

    private fun socketForSend(): MulticastSocket {
        return udp.get() ?: MulticastSocket().also { it.broadcast = true }
    }

    private fun sendDatagram(options: Map<String, Any?>) {
        val host = options["host"] as? String ?: throw IllegalArgumentException("host is required")
        val port = (options["port"] as? Number)?.toInt() ?: throw IllegalArgumentException("port is required")
        val data = Base64.decode(options["dataBase64"] as? String ?: "", Base64.NO_WRAP)
        val socket = socketForSend()
        val owned = socket !== udp.get()
        try {
            socket.send(DatagramPacket(data, data.size, InetAddress.getByName(host), port))
        } finally {
            if (owned) socket.close()
        }
    }

    // ── the HTTP server ───────────────────────────────────────────────────

    private class ParsedRequest(
        val method: String,
        val path: String,
        val headers: Map<String, String>,
        val bodyBytes: ByteArray?,
        val bodyFile: String?,
    )

    private fun handleConnection(socket: Socket) {
        try {
            socket.tcpNoDelay = true
            socket.soTimeout = 15_000
            val input = socket.getInputStream().buffered()
            val head = readHead(input) ?: return
            val lines = head.split("\r\n")
            val requestLine = lines.firstOrNull() ?: return
            val parts = requestLine.split(" ")
            if (parts.size < 2) return
            val method = parts[0].uppercase()
            val path = parts[1]

            val headers = HashMap<String, String>()
            for (line in lines.drop(1)) {
                val idx = line.indexOf(':')
                if (idx > 0) {
                    headers[line.substring(0, idx).trim().lowercase()] = line.substring(idx + 1).trim()
                }
            }

            // The body: small ones cross as base64, anything above the spill
            // threshold lands in a temp file and the event names the path.
            // Read from the same raw stream the head came off — a buffered
            // reader here would swallow body bytes into its buffer.
            val contentLength = headers["content-length"]?.toLongOrNull() ?: 0L
            var bodyBytes: ByteArray? = null
            var bodyFile: String? = null
            if (contentLength > 0) {
                if (contentLength > 8L * 1024 * 1024 * 1024) {
                    writeSimpleResponse(socket.getOutputStream(), "HTTP/1.1 413 Payload Too Large", "too large")
                    return
                }
                if (contentLength > 1024 * 1024) {
                    val file = File(spillDir ?: return, "req-${UUID.randomUUID()}.body")
                    file.outputStream().use { out ->
                        copyLimited(input, out, contentLength)
                    }
                    bodyFile = file.absolutePath
                } else {
                    val bytes = ByteArray(contentLength.toInt())
                    var read = 0
                    while (read < bytes.size) {
                        val n = input.read(bytes, read, bytes.size - read)
                        if (n < 0) break
                        read += n
                    }
                    bodyBytes = bytes.copyOf(read)
                }
            }

            val id = UUID.randomUUID().toString()
            val url = "http://${headers["host"] ?: "unknown"}$path"
            val future = CompletableFuture<Map<String, Any?>?>()
            pending[id] = future
            sendEvent(
                "onLanRequest",
                buildMap<String, Any?> {
                    put("id", id)
                    put("method", method)
                    put("url", url)
                    put("headers", headers)
                    if (bodyFile != null) put("bodyFile", bodyFile)
                    if (bodyBytes != null && bodyBytes.isNotEmpty()) {
                        put("bodyBase64", Base64.encodeToString(bodyBytes, Base64.NO_WRAP))
                    }
                },
            )

            val reply = try {
                future.get(30, TimeUnit.SECONDS)
            } catch (_: Exception) {
                pending.remove(id)
                null
            }
            val output = socket.getOutputStream()
            if (reply == null) {
                // Nobody answered: answer for them, so the peer's socket closes.
                writeSimpleResponse(output, "HTTP/1.1 504 Gateway Timeout", "lan: handler did not reply in time")
                return
            }
            writeReply(output, reply)
        } catch (_: Exception) {
            try {
                socket.close()
            } catch (_: Exception) {
                // The socket dying is the point.
            }
        } finally {
            try {
                socket.close()
            } catch (_: Exception) {
                // Already gone.
            }
        }
    }

    private fun copyLimited(input: java.io.InputStream, out: OutputStream, limit: Long) {
        val buffer = ByteArray(64 * 1024)
        var remaining = limit
        while (remaining > 0) {
            val want = minOf(buffer.size.toLong(), remaining).toInt()
            val n = input.read(buffer, 0, want)
            if (n < 0) break
            out.write(buffer, 0, n)
            remaining -= n
        }
    }

    /**
     * Read the header block off a raw stream: everything up to and including
     * the first `\r\n\r\n`, capped at 32 KB. Returns the block decoded
     * ISO-8859-1 (bytes preserved, headers are ASCII in practice), or null
     * when the peer hung up before finishing one.
     */
    private fun readHead(input: java.io.InputStream): String? {
        val window = IntArray(4)
        val out = java.io.ByteArrayOutputStream()
        var filled = 0
        while (filled < 4 || !(window[0] == 13 && window[1] == 10 && window[2] == 13 && window[3] == 10)) {
            val b = input.read()
            if (b < 0) return null
            out.write(b)
            window[0] = window[1]
            window[1] = window[2]
            window[2] = window[3]
            window[3] = b
            if (filled < 4) filled++
            if (out.size() > 32 * 1024) return null
        }
        return out.toString("ISO-8859-1")
    }

    private fun writeSimpleResponse(output: OutputStream, statusLine: String, body: String) {
        val bytes = body.toByteArray(Charsets.ISO_8859_1)
        val head = "$statusLine\r\nContent-Type: text/plain\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
        output.write(head.toByteArray(Charsets.ISO_8859_1))
        output.write(bytes)
        output.flush()
    }

    /** A file:// uri (or a bare path) back to a path, as the JS side names them. */
    private fun uriToPath(uri: String): String {
        if (uri.startsWith("file://")) {
            return java.net.URI(uri).path
        }
        return uri
    }

    private fun writeReply(output: OutputStream, reply: Map<String, Any?>) {
        val status = (reply["status"] as? Number)?.toInt() ?: 200
        val head = StringBuilder("HTTP/1.1 $status\r\n")
        var contentLengthGiven = false
        val headersIn = reply["headers"] as? Map<*, *> ?: emptyMap<Any, Any>()
        for ((name, value) in headersIn) {
            if (name is String && value is String) {
                if (name.lowercase() == "content-length") contentLengthGiven = true
                head.append("$name: $value\r\n")
            }
        }

        val bodyBase64 = reply["bodyBase64"] as? String
        val bodyFile = reply["bodyFile"] as? String
        val start = (reply["bodyFileStart"] as? Number)?.toLong()
        val end = (reply["bodyFileEnd"] as? Number)?.toLong()

        if (bodyFile != null) {
            val path = uriToPath(bodyFile)
            val file = File(path)
            val size = file.length()
            // The slice is clamped defensively: the values crossed the bridge,
            // so they are caller data, not trusted constants.
            val from = maxOf(0L, start ?: 0L).coerceAtMost(maxOf(size - 1, 0))
            val to = minOf(end ?: (size - 1), size - 1).coerceAtLeast(from)
            val length = if (size == 0L) 0L else to - from + 1
            if (!contentLengthGiven) head.append("Content-Length: $length\r\n")
            head.append("Connection: close\r\n\r\n")
            output.write(head.toString().toByteArray(Charsets.ISO_8859_1))
            output.flush()
            if (length <= 0) return
            FileInputStream(file).use { fis ->
                var remaining = from
                while (remaining > 0) {
                    val skipped = fis.skip(remaining)
                    if (skipped <= 0) break
                    remaining -= skipped
                }
                val buffer = ByteArray(64 * 1024)
                var left = length
                while (left > 0) {
                    val want = minOf(buffer.size.toLong(), left).toInt()
                    val n = fis.read(buffer, 0, want)
                    if (n < 0) break
                    output.write(buffer, 0, n)
                    left -= n
                }
            }
            output.flush()
            return
        }

        val bytes = if (bodyBase64 != null) Base64.decode(bodyBase64, Base64.NO_WRAP) else ByteArray(0)
        if (!contentLengthGiven) head.append("Content-Length: ${bytes.size}\r\n")
        head.append("Connection: close\r\n\r\n")
        output.write(head.toString().toByteArray(Charsets.ISO_8859_1))
        output.write(bytes)
        output.flush()
    }

    // ── the client ────────────────────────────────────────────────────────

    private fun request(options: Map<String, Any?>): Map<String, Any?> {
        val host = options["host"] as? String ?: throw IllegalArgumentException("host is required")
        val port = (options["port"] as? Number)?.toInt() ?: throw IllegalArgumentException("port is required")
        val method = (options["method"] as? String ?: "GET").uppercase()
        val path = (options["path"] as? String ?: "/").let { if (it.startsWith("/")) it else "/$it" }
        val headersIn = options["headers"] as? Map<*, *> ?: emptyMap<Any, Any>()
        val bodyBase64 = options["bodyBase64"] as? String
        val timeoutMs = (options["timeoutMs"] as? Number)?.toLong() ?: 30_000L

        val builder = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .callTimeout(timeoutMs + 5_000, TimeUnit.MILLISECONDS)
        val client = builder.build()

        val requestBuilder = Request.Builder().url("http://$host:$port$path")
        for ((name, value) in headersIn) {
            if (name is String && value is String) requestBuilder.header(name, value)
        }
        if (bodyBase64 != null && method != "GET" && method != "HEAD") {
            val bytes = Base64.decode(bodyBase64, Base64.NO_WRAP)
            val mediaType = headersIn.entries
                .firstOrNull { (it.key as? String)?.lowercase() == "content-type" }
                ?.value as? String
            requestBuilder.method(method, bytes.toRequestBody(mediaType?.toMediaTypeOrNull()))
        } else if (method != "GET" && method != "HEAD") {
            requestBuilder.method(method, ByteArray(0).toRequestBody(null))
        } else {
            requestBuilder.method(method, null)
        }

        client.newCall(requestBuilder.build()).execute().use { response ->
            val bytes = response.body?.bytes() ?: ByteArray(0)
            val headerMap = HashMap<String, String>()
            for (name in response.headers.names()) {
                headerMap[name.lowercase()] = response.headers.values(name).joinToString(", ")
            }
            return mapOf(
                "status" to response.code,
                "headers" to headerMap,
                "bodyBase64" to Base64.encodeToString(bytes, Base64.NO_WRAP),
            )
        }
    }
}
