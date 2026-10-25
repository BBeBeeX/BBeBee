package expo.modules.audioengine

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import org.json.JSONArray
import org.json.JSONObject

/**
 * mpv's `audio-device-list` in Android vocabulary.
 *
 * `core-audio-mpv`'s `listOutputDevices` maps the desktop engine's answer —
 * `[{ name, description }]`, with `auto` as the default route and every other
 * id in the engine's own `<ao>/<device>` vocabulary — into `OutputDevice`s.
 * The answers produced here speak exactly that vocabulary, so the shared
 * mapping applies unchanged and no second mapping lives in the adapter.
 *
 * Device ids are stable synthetic keys (`android/<type>`, `-<n>`-suffixed when
 * one type shows up twice) rather than AudioManager's per-boot integer ids:
 * the shared service persists the chosen id across launches, and an integer
 * id would silently point at a different device after a reboot. Ids never
 * collide with the reserved `auto`/`default`.
 *
 * ⚠️ Enumeration only — this answers `mpvGetAudioDevices`; it does not emit
 * device-change events. Nothing in this module pushes events (every answer is
 * a polled `AsyncFunction`, and the desktop engine's `audio-devices` push is
 * a sidecar-supervisor concept the shared engine does not consume through the
 * bridge); mobile route changes are published by the shell through
 * `ctx.audio.emitRouteChange`, which is where an `AudioDeviceCallback`
 * belongs if one is ever wired.
 */
object AudioDevices {

    /**
     * Stable ids per Android output type. Any unknown type falls through to
     * `type_<n>`, so a new OS constant degrades to an extra row instead of a
     * crash — and since ids are compared as opaque strings downstream, the
     * spelling only has to be stable within one build.
     */
    private fun typeTag(type: Int): String = when (type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER_SAFE -> "speaker_safe"
        AudioDeviceInfo.TYPE_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "wired_headphones"
        AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired_headset"
        AudioDeviceInfo.TYPE_USB_HEADSET -> "usb_headset"
        AudioDeviceInfo.TYPE_USB_DEVICE -> "usb_device"
        AudioDeviceInfo.TYPE_USB_ACCESSORY -> "usb_accessory"
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "bt_a2dp"
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bt_sco"
        AudioDeviceInfo.TYPE_HDMI -> "hdmi"
        AudioDeviceInfo.TYPE_HDMI_ARC -> "hdmi_arc"
        AudioDeviceInfo.TYPE_HDMI_EARC -> "hdmi_earc"
        AudioDeviceInfo.TYPE_TELEPHONY -> "telephony"
        AudioDeviceInfo.TYPE_FM_TUNER -> "fm_tuner"
        AudioDeviceInfo.TYPE_LINE_ANALOG -> "line_analog"
        AudioDeviceInfo.TYPE_LINE_DIGITAL -> "line_digital"
        AudioDeviceInfo.TYPE_AUX_LINE -> "aux_line"
        AudioDeviceInfo.TYPE_DOCK -> "dock"
        AudioDeviceInfo.TYPE_BUS -> "bus"
        else -> "type_$type"
    }

    private fun typeLabel(type: Int): String = when (type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "Built-in speaker"
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "Earpiece"
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER_SAFE -> "Built-in speaker (safe)"
        AudioDeviceInfo.TYPE_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "Wired headphones"
        AudioDeviceInfo.TYPE_WIRED_HEADSET -> "Wired headset"
        AudioDeviceInfo.TYPE_USB_HEADSET -> "USB headset"
        AudioDeviceInfo.TYPE_USB_DEVICE -> "USB device"
        AudioDeviceInfo.TYPE_USB_ACCESSORY -> "USB accessory"
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "Bluetooth audio"
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "Bluetooth telephony"
        AudioDeviceInfo.TYPE_HDMI -> "HDMI"
        AudioDeviceInfo.TYPE_HDMI_ARC -> "HDMI ARC"
        AudioDeviceInfo.TYPE_HDMI_EARC -> "HDMI eARC"
        AudioDeviceInfo.TYPE_TELEPHONY -> "Telephony"
        AudioDeviceInfo.TYPE_FM_TUNER -> "FM tuner"
        AudioDeviceInfo.TYPE_LINE_ANALOG -> "Line out"
        AudioDeviceInfo.TYPE_LINE_DIGITAL -> "Digital line out"
        AudioDeviceInfo.TYPE_AUX_LINE -> "Aux line"
        AudioDeviceInfo.TYPE_DOCK -> "Dock"
        AudioDeviceInfo.TYPE_BUS -> "Bus"
        else -> "Audio output"
    }

    /**
     * The JSON answer, mpv's shape: `auto` first — the system default route,
     * as mpv's own list starts — then every output device with a stable
     * `android/<type>` id and a `product (type)` description. A missing or
     * generic product name degrades to the type label alone; the shared
     * mapping already tolerates either.
     */
    fun listJson(context: Context?): String {
        val array = JSONArray()
        array.put(
            JSONObject()
                .put("name", "auto")
                .put("description", "System default audio route"),
        )
        val audioManager =
            context?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        if (audioManager != null) {
            val seen = HashMap<String, Int>()
            audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
                .filter { it.isSink }
                .sortedBy { typeTag(it.type) to it.id } // deterministic across calls
                .forEach { device ->
                    val base = "android/${typeTag(device.type)}"
                    // `merge` returns the new count: the first of a type keeps
                    // the bare id, the second and beyond get a suffix.
                    val n = seen.merge(base, 1, Int::plus) ?: 1
                    val name = if (n == 1) base else "$base-$n"
                    val product = device.productName?.toString()?.trim().orEmpty()
                    val label = typeLabel(device.type)
                    val description =
                        if (product.isEmpty() || product.equals(label, ignoreCase = true)) {
                            label
                        } else {
                            "$product ($label)"
                        }
                    array.put(
                        JSONObject()
                            .put("name", name)
                            .put("description", description),
                    )
                }
        }
        return array.toString()
    }
}
