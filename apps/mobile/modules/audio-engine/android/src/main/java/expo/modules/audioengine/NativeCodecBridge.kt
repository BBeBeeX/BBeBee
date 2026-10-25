package expo.modules.audioengine

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Base64
import org.bbebee.audio.BBeBeeAudioEngine
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import org.json.JSONArray
import org.json.JSONObject

/**
 * The codec-side native bridge behind the `bbebeeNativeCodec` seam.
 *
 * Two services live here, deliberately in the same Expo module as the mpv
 * surface because they share the one prebuilt `libbbebee_audio_jni.so`:
 *
 * - **Batch artwork extraction** — a worker pool over `MediaMetadataRetriever`
 *   (the platform's own tag reader), sized like the desktop fork pool
 *   (`min(max(cpus, 2), 4)`). Parsing embedded covers off the JS thread is
 *   the entire point: `music-metadata` in `core-codec-mobile` is pure JS, so
 *   the inherited in-process path parses on Hermes and stalls the UI during
 *   scan storms. Per-file failures answer `null` — the positional,
 *   never-throwing shape `CodecService.readArtworkBatch` promises.
 * - **FFmpeg transcoding** — the C++ `Transcoder` exposed through JNI. The
 *   native layer only accepts real filesystem paths, so `content://` inputs
 *   are copied into the cache directory first and outputs staged there and
 *   streamed to the destination afterwards; `file://` and absolute paths
 *   pass through untouched. Temp files are cleaned by a watchdog thread that
 *   polls the job state the JS layer is polling anyway.
 */
object NativeCodecBridge {

    /** One retry-free answer per input URI, positional, `null` for "no cover". */
    private const val PER_FILE_TIMEOUT_SECONDS = 10L

    /**
     * Fixed pool, desktop parity: artwork extraction is CPU-bound, so more
     * than the core count buys nothing and fewer than two wastes the batch.
     */
    private val artworkPool by lazy {
        val cores = Runtime.getRuntime().availableProcessors()
        Executors.newFixedThreadPool(minOf(maxOf(cores, 2), 4)) { runnable ->
            Thread(runnable, "bbebee-artwork-pool").apply { isDaemon = true }
        }
    }

    /**
     * Extract embedded covers for many URIs off the calling thread.
     *
     * Accepts `file://`, `content://`, and absolute paths — the same URI
     * vocabulary `ctx.fs` speaks. The result is positional: entry `i`
     * corresponds to `uris[i]`, and every per-file failure (unreadable,
     * unsupported, timed out, no embedded art) is `null` rather than an
     * error, because the desktop contract spells misses as `undefined`.
     */
    fun readArtworkBatch(context: Context?, uris: List<String>): List<String?> {
        if (uris.isEmpty()) return emptyList()
        if (context == null) return uris.map { null }

        val futures = uris.map { uri ->
            artworkPool.submit(
                Callable {
                    extractArtwork(context, uri)
                },
            )
        }

        return futures.map { future ->
            try {
                future.get(PER_FILE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            } catch (_: TimeoutException) {
                // A hung retriever keeps its worker occupied; cancel so the
                // pool recovers once the underlying call unwinds.
                future.cancel(true)
                null
            } catch (_: Exception) {
                null
            }
        }
    }

    private fun extractArtwork(context: Context, uri: String): String? {
        val retriever = MediaMetadataRetriever()
        try {
            if (uri.startsWith("content://") || uri.startsWith("file://")) {
                retriever.setDataSource(context, Uri.parse(uri))
            } else {
                retriever.setDataSource(uri)
            }
            val artwork = retriever.embeddedPicture ?: return null
            return Base64.encodeToString(artwork, Base64.NO_WRAP)
        } catch (_: Exception) {
            return null
        } finally {
            try {
                retriever.release()
            } catch (_: Exception) {
                // Nothing to salvage from a retriever that refused to die.
            }
        }
    }

    // ---------------------------------------------------------------------
    // Transcode plumbing
    // ---------------------------------------------------------------------

    private fun jsonObject(vararg pairs: Pair<String, Any?>): String {
        val obj = JSONObject()
        for ((key, value) in pairs) {
            obj.put(key, value ?: JSONObject.NULL)
        }
        return obj.toString()
    }

    private fun errorAnswer(jobId: String, message: String): String =
        jsonObject("ok" to false, "jobId" to jobId, "error" to message)

    /**
     * Resolve a transcode input to a native filesystem path.
     *
     * Returns the path plus an optional cleanup thunk: `content://` URIs
     * cannot be `fopen`ed from C++, so they are copied into the cache
     * directory first and the copy is deleted when the job finishes.
     */
    private fun stageInput(context: Context, uri: String, jobId: String): Pair<String, (() -> Unit)?> {
        if (uri.startsWith("content://")) {
            val staged = File(context.cacheDir, "bbebee-transcode-in-$jobId")
            context.contentResolver.openInputStream(Uri.parse(uri))?.use { input ->
                staged.outputStream().use { output -> input.copyTo(output) }
            } ?: throw IllegalStateException("Cannot open content URI: $uri")
            return staged.absolutePath to { staged.delete() }
        }
        if (uri.startsWith("file://")) {
            return Uri.parse(uri).path!! to null
        }
        return uri to null
    }

    /**
     * Resolve a transcode output. Direct-`file` outputs transcode in place;
     * `content://` destinations (a SAF tree the user picked) are staged in
     * the cache and streamed to the resolver after the encoder is done.
     */
    private fun stageOutput(context: Context, uri: String, jobId: String): Pair<String, (String) -> Unit> {
        if (uri.startsWith("content://")) {
            val staged = File(context.cacheDir, "bbebee-transcode-out-$jobId")
            return staged.absolutePath to { stagedPath ->
                val stagedFile = File(stagedPath)
                try {
                    context.contentResolver.openOutputStream(Uri.parse(uri))?.use { output ->
                        stagedFile.inputStream().use { input -> input.copyTo(output) }
                    }
                } finally {
                    stagedFile.delete()
                }
            }
        }
        if (uri.startsWith("file://")) {
            return Uri.parse(uri).path!! to { /* written in place */ }
        }
        return uri to { /* written in place */ }
    }

    /**
     * Register the transcode job with the C++ transcoder and hand back the
     * JSON answer verbatim. A watchdog thread polls the job state — the same
     * state the JS progress poller reads — and deletes the staged files once
     * the job settles, so cancellation and failure clean up without the JS
     * side knowing about the staging.
     *
     * The desktop-only options (`bitDepth`, `vbr`/`vbrQuality`,
     * `volumeGainDb`, the fades) are accepted here for the native layer to
     * rule on. ⚠️ The pinned engine surface (`BBeBeeAudioEngine.nativeTranscode`
     * v1.1.0 — paths, format, bitrate, rate, channels, trim) has no receiver
     * for them, and a job started with them would silently ignore exactly the
     * options the caller asked for. So the ones present are named in the start
     * answer's `unsupported` list — the engine layer's own ruling, which the
     * JS side turns into one warning instead of a guessed drop list. The
     * desktop ffmpeg equivalents the engine must adopt to honour them:
     *
     * | option          | ffmpeg arg (as `core-codec-desktop` builds it)                  |
     * |-----------------|------------------------------------------------------------------|
     * | `bitDepth`      | flac: `-sample_fmt s32`/`s16`; wav: `pcm_s24le/32le/16le`; aiff: `pcm_s24be/16be` |
     * | `vbr`+`vbrQuality` | mp3: `-q:a <0..9>`; vorbis: `-q:a <0..10>` (else falls back to `-b:a`) |
     * | `volumeGainDb`  | `-af volume=<db>dB`                                             |
     * | `fadeInSeconds` | `-af afade=t=in:ss=0:d=<sec>`                                    |
     * | `fadeOutSeconds`| `-af afade=t=out:st=<end-fade>:d=<sec>`                          |
     *
     * When the engine grows a receiver for these (a filters/args export), map
     * through that table, delete the `unsupported` block, and the JS side
     * needs no change — the warning disappears with the report.
     */
    fun transcode(
        context: Context?,
        jobId: String,
        inputUri: String,
        outputUri: String,
        format: String,
        bitrate: String,
        sampleRate: Int,
        channels: Int,
        startSec: Double,
        endSec: Double,
        bitDepth: Int? = null,
        vbr: Boolean? = null,
        vbrQuality: Double? = null,
        volumeGainDb: Double? = null,
        fadeInSeconds: Double? = null,
        fadeOutSeconds: Double? = null,
    ): String {
        if (context == null) {
            return errorAnswer(jobId, "no Android context available")
        }

        val input: Pair<String, (() -> Unit)?>
        val output: Pair<String, (String) -> Unit>
        try {
            input = stageInput(context, inputUri, jobId)
            output = stageOutput(context, outputUri, jobId)
        } catch (e: Exception) {
            return errorAnswer(jobId, e.message ?: "failed to stage transcode URIs")
        }

        val answer = BBeBeeAudioEngine.nativeTranscode(
            jobId,
            input.first,
            output.first,
            format,
            bitrate,
            sampleRate,
            channels,
            startSec,
            endSec,
        )
        val parsed = JSONObject(answer)
        if (parsed.optBoolean("ok", false)) {
            // The ruling on the extended options, from the layer that owns the
            // engine surface — see the KDoc table for the mapping the engine
            // must adopt before these stop being "unsupported".
            val unsupported = buildList {
                if (bitDepth != null) add("bitDepth")
                if (vbr == true && vbrQuality != null) {
                    add("vbr")
                    add("vbrQuality")
                }
                if (volumeGainDb != null) add("volumeGainDb")
                if (fadeInSeconds != null) add("fadeInSeconds")
                if (fadeOutSeconds != null) add("fadeOutSeconds")
            }
            if (unsupported.isNotEmpty()) {
                parsed.put("unsupported", JSONArray(unsupported))
            }
            val settledJobId = parsed.optString("jobId", jobId)
            Thread {
                awaitJobSettled(settledJobId)
                input.second?.invoke()
                output.second(output.first)
            }.apply {
                isDaemon = true
                name = "bbebee-transcode-watchdog-$settledJobId"
                start()
            }
        } else {
            // The job never started; nothing will poll for it, so the staged
            // copy would outlive the attempt without this.
            input.second?.invoke()
        }
        return parsed.toString()
    }

    private fun awaitJobSettled(jobId: String) {
        while (true) {
            val state = JSONObject(BBeBeeAudioEngine.nativeGetTranscodeState(jobId))
            if (state.optBoolean("done", false) || !state.optBoolean("found", false)) return
            try {
                Thread.sleep(500)
            } catch (_: InterruptedException) {
                return
            }
        }
    }
}
