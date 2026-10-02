/**
 * Standalone Native audio-engine Process.
 *
 * Runs as an independent native binary executable for crash isolation.
 * - Manages libmpv instance with direct WASAPI output (ao=wasapi)
 * - Implements in-engine DSP / 10-band EQ / Preamp / Compressor filter chain
 * - Real-time metadata / audio level analysis ("Zero-IPC for PCM")
 * - Dispatches events, position updates, and FFT spectrum frames over stdio JSON-IPC
 */

#include <iostream>
#include <string>
#include <vector>
#include <thread>
#include <atomic>
#include <mutex>
#include <chrono>
#include <cmath>
#include <cstring>
#include <algorithm>

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
static std::string getExecutableDir() {
    char path[MAX_PATH];
    DWORD len = GetModuleFileNameA(NULL, path, MAX_PATH);
    if (len > 0 && len < MAX_PATH) {
        std::string s(path, len);
        size_t pos = s.find_last_of("\\/");
        if (pos != std::string::npos) {
            return s.substr(0, pos);
        }
    }
    return "";
}
#elif defined(__APPLE__)
#include <dlfcn.h>
#include <unistd.h>
#include <libgen.h>
#include <mach-o/dyld.h>
static std::string getExecutableDir() {
    char path[1024];
    uint32_t size = sizeof(path);
    if (_NSGetExecutablePath(path, &size) == 0) {
        char* dir = dirname(path);
        if (dir) return std::string(dir);
    }
    return "";
}
#else
#include <dlfcn.h>
#include <unistd.h>
#include <libgen.h>
static std::string getExecutableDir() {
    char path[1024];
    ssize_t len = readlink("/proc/self/exe", path, sizeof(path) - 1);
    if (len != -1) {
        path[len] = '\0';
        char* dir = dirname(path);
        if (dir) return std::string(dir);
    }
    return "";
}
#endif

#include "mpv_client.h"
#include "fft.hpp"
#include "json.hpp"

using namespace audio_engine;

// Dynamic libmpv function table
struct MpvDynLib {
    void* handle = nullptr;
    fn_mpv_create create = nullptr;
    fn_mpv_initialize initialize = nullptr;
    fn_mpv_destroy destroy = nullptr;
    fn_mpv_terminate_destroy terminate_destroy = nullptr;
    fn_mpv_command command = nullptr;
    fn_mpv_command_string command_string = nullptr;
    fn_mpv_set_option set_option = nullptr;
    fn_mpv_set_option_string set_option_string = nullptr;
    fn_mpv_get_property get_property = nullptr;
    fn_mpv_set_property set_property = nullptr;
    fn_mpv_set_property_string set_property_string = nullptr;
    fn_mpv_observe_property observe_property = nullptr;
    fn_mpv_wait_event wait_event = nullptr;
    fn_mpv_error_string error_string = nullptr;
    fn_mpv_free free_data = nullptr;

    bool load(const std::string& customPath = "") {
        std::vector<std::string> candidates;
        if (!customPath.empty()) candidates.push_back(customPath);

        std::string exeDir = getExecutableDir();

#if defined(_WIN32)
        if (!exeDir.empty()) {
            candidates.push_back(exeDir + "\\mpv-2.dll");
            candidates.push_back(exeDir + "\\libmpv-2.dll");
            candidates.push_back(exeDir + "\\mpv-1.dll");
        }
        candidates.push_back("mpv-2.dll");
        candidates.push_back("libmpv-2.dll");
        candidates.push_back("mpv-1.dll");
#elif defined(__APPLE__)
        if (!exeDir.empty()) {
            candidates.push_back(exeDir + "/libmpv.2.dylib");
            candidates.push_back(exeDir + "/libmpv.dylib");
        }
        candidates.push_back("libmpv.2.dylib");
        candidates.push_back("libmpv.dylib");
        candidates.push_back("/usr/local/lib/libmpv.dylib");
        candidates.push_back("/opt/homebrew/lib/libmpv.dylib");
#else
        if (!exeDir.empty()) {
            candidates.push_back(exeDir + "/libmpv.so.2");
            candidates.push_back(exeDir + "/libmpv.so.1");
            candidates.push_back(exeDir + "/libmpv.so");
        }
        candidates.push_back("libmpv.so.2");
        candidates.push_back("libmpv.so.1");
        candidates.push_back("libmpv.so");
        candidates.push_back("/usr/lib/libmpv.so.2");
        candidates.push_back("/usr/lib/x86_64-linux-gnu/libmpv.so.2");
#endif

        for (const auto& path : candidates) {
#if defined(_WIN32)
            HMODULE h = LoadLibraryA(path.c_str());
            if (h) {
                handle = reinterpret_cast<void*>(h);
                create = reinterpret_cast<fn_mpv_create>(GetProcAddress(h, "mpv_create"));
                initialize = reinterpret_cast<fn_mpv_initialize>(GetProcAddress(h, "mpv_initialize"));
                destroy = reinterpret_cast<fn_mpv_destroy>(GetProcAddress(h, "mpv_destroy"));
                terminate_destroy = reinterpret_cast<fn_mpv_terminate_destroy>(GetProcAddress(h, "mpv_terminate_destroy"));
                command = reinterpret_cast<fn_mpv_command>(GetProcAddress(h, "mpv_command"));
                command_string = reinterpret_cast<fn_mpv_command_string>(GetProcAddress(h, "mpv_command_string"));
                set_option = reinterpret_cast<fn_mpv_set_option>(GetProcAddress(h, "mpv_set_option"));
                set_option_string = reinterpret_cast<fn_mpv_set_option_string>(GetProcAddress(h, "mpv_set_option_string"));
                get_property = reinterpret_cast<fn_mpv_get_property>(GetProcAddress(h, "mpv_get_property"));
                set_property = reinterpret_cast<fn_mpv_set_property>(GetProcAddress(h, "mpv_set_property"));
                set_property_string = reinterpret_cast<fn_mpv_set_property_string>(GetProcAddress(h, "mpv_set_property_string"));
                observe_property = reinterpret_cast<fn_mpv_observe_property>(GetProcAddress(h, "mpv_observe_property"));
                wait_event = reinterpret_cast<fn_mpv_wait_event>(GetProcAddress(h, "mpv_wait_event"));
                error_string = reinterpret_cast<fn_mpv_error_string>(GetProcAddress(h, "mpv_error_string"));
                free_data = reinterpret_cast<fn_mpv_free>(GetProcAddress(h, "mpv_free"));
                if (create && initialize) return true;
                FreeLibrary(h);
                handle = nullptr;
            }
#else
            void* h = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
            if (h) {
                handle = h;
                create = reinterpret_cast<fn_mpv_create>(dlsym(h, "mpv_create"));
                initialize = reinterpret_cast<fn_mpv_initialize>(dlsym(h, "mpv_initialize"));
                destroy = reinterpret_cast<fn_mpv_destroy>(dlsym(h, "mpv_destroy"));
                terminate_destroy = reinterpret_cast<fn_mpv_terminate_destroy>(dlsym(h, "mpv_terminate_destroy"));
                command = reinterpret_cast<fn_mpv_command>(dlsym(h, "mpv_command"));
                command_string = reinterpret_cast<fn_mpv_command_string>(dlsym(h, "mpv_command_string"));
                set_option = reinterpret_cast<fn_mpv_set_option>(dlsym(h, "mpv_set_option"));
                set_option_string = reinterpret_cast<fn_mpv_set_option_string>(dlsym(h, "mpv_set_option_string"));
                get_property = reinterpret_cast<fn_mpv_get_property>(dlsym(h, "mpv_get_property"));
                set_property = reinterpret_cast<fn_mpv_set_property>(dlsym(h, "mpv_set_property"));
                set_property_string = reinterpret_cast<fn_mpv_set_property_string>(dlsym(h, "mpv_set_property_string"));
                observe_property = reinterpret_cast<fn_mpv_observe_property>(dlsym(h, "mpv_observe_property"));
                wait_event = reinterpret_cast<fn_mpv_wait_event>(dlsym(h, "mpv_wait_event"));
                error_string = reinterpret_cast<fn_mpv_error_string>(dlsym(h, "mpv_error_string"));
                free_data = reinterpret_cast<fn_mpv_free>(dlsym(h, "mpv_free"));
                if (create && initialize) return true;
                dlclose(h);
                handle = nullptr;
            }
#endif
        }
        return false;
    }

    void unload() {
        if (handle) {
#if defined(_WIN32)
            FreeLibrary(reinterpret_cast<HMODULE>(handle));
#else
            dlclose(handle);
#endif
            handle = nullptr;
        }
    }
};

// URI → on-disk path, mirroring the main process's fs-path.ts: the renderer
// hands out bbebee-file:// / file:// URLs whose on-disk names are
// percent-encoded UTF-8, and mpv understands neither the custom scheme nor
// the encoding (a DSF under a Chinese-named folder arrives as
// "bbebee-file:///F:/music/%E5%B7%B4%E8%B5%AB..."). http(s) and other
// schemes pass through untouched.
static std::string uriToMpvPath(const std::string& uri) {
    const size_t scheme = uri.find("://");
    if (scheme == std::string::npos) return uri;
    const std::string schemeName = uri.substr(0, scheme);
    if (schemeName != "file" && schemeName != "bbebee-file") return uri;

    std::string rest = uri.substr(scheme + 3);
    std::string decoded;
    auto hexVal = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    };
    for (size_t i = 0; i < rest.size(); ++i) {
        if (rest[i] == '%' && i + 2 < rest.size()) {
            const int hi = hexVal(rest[i + 1]);
            const int lo = hexVal(rest[i + 2]);
            if (hi >= 0 && lo >= 0) {
                decoded += static_cast<char>((hi << 4) | lo);
                i += 2;
                continue;
            }
        }
        decoded += rest[i];
    }

#if defined(_WIN32)
    // file:///F:/music → /F:/music → F:/music (the drive-letter quirk
    // fileURLToPath also handles on the main-process side)
    if (decoded.size() >= 3 && decoded[0] == '/' && decoded[2] == ':') decoded = decoded.substr(1);
#endif
    return decoded;
}

class AudioEngineApp {
public:
    AudioEngineApp() : fftProcessor({ 128, -100.0f, -30.0f, 0.8f }) {}

    ~AudioEngineApp() {
        stop();
        if (mpv && mpvLib.handle && mpvLib.destroy) {
            mpvLib.destroy(mpv);
            mpv = nullptr;
        }
        mpvLib.unload();
    }

    void init(const JsonValue& config) {
        fftSize = config.get("fftSize").asInt(128);
        fftProcessor.setFftSize(fftSize);
        deviceId = config.get("deviceId").asString("default");
        std::string customAo = config.get("ao").asString("");

        bool hasMpv = mpvLib.load();
        if (hasMpv && mpvLib.create && mpvLib.initialize) {
            mpv = mpvLib.create();
            if (mpv) {
                // Configure WASAPI or platform ao
                if (!customAo.empty()) {
                    mpvLib.set_option_string(mpv, "ao", customAo.c_str());
                } else {
#if defined(_WIN32)
                    mpvLib.set_option_string(mpv, "ao", "wasapi");
#elif defined(__APPLE__)
                    mpvLib.set_option_string(mpv, "ao", "coreaudio");
#else
                    mpvLib.set_option_string(mpv, "ao", "pulse,alsa,pipewire");
#endif
                }

                if (deviceId != "default" && !deviceId.empty()) {
                    mpvLib.set_option_string(mpv, "audio-device", deviceId.c_str());
                }

                mpvLib.set_option_string(mpv, "keep-open", "yes");
                mpvLib.set_option_string(mpv, "idle", "yes");
                mpvLib.set_option_string(mpv, "video", "no");
                mpvLib.set_option_string(mpv, "audio-pitch-correction", "yes");

                mpvLib.initialize(mpv);

                // Observe real mpv properties for exact playback tracking
                if (mpvLib.observe_property) {
                    mpvLib.observe_property(mpv, 1, "time-pos", MPV_FORMAT_DOUBLE);
                    mpvLib.observe_property(mpv, 2, "duration", MPV_FORMAT_DOUBLE);
                    mpvLib.observe_property(mpv, 3, "pause", MPV_FORMAT_FLAG);
                    mpvLib.observe_property(mpv, 4, "eof-reached", MPV_FORMAT_FLAG);
                    mpvLib.observe_property(mpv, 5, "audio-params/samplerate", MPV_FORMAT_INT64);
                    mpvLib.observe_property(mpv, 6, "audio-params/channel-count", MPV_FORMAT_INT64);
                    mpvLib.observe_property(mpv, 7, "af-metadata", MPV_FORMAT_STRING);
                    mpvLib.observe_property(mpv, 8, "af-metadata/bbebee_astats", MPV_FORMAT_STRING);
                }

                // Initial audio filter with astats metadata tap
                applyFilterGraph("");

                std::cerr << "[audio-engine] libmpv initialized successfully\n";
            }
        } else {
            std::cerr << "[audio-engine] libmpv not found, running native audio fallback engine\n";
        }

        running = true;
        eventThread = std::thread(&AudioEngineApp::eventLoop, this);
        visualizerThread = std::thread(&AudioEngineApp::visualizerLoop, this);
        heartbeatThread = std::thread(&AudioEngineApp::heartbeatLoop, this);

        JsonValue ready = JsonValue::object();
        ready["type"] = "ready";
        ready["sampleRate"] = sampleRate;
        ready["channels"] = channels;
        ready["bitDepth"] = bitDepth;
        sendJson(ready);
    }

    void load(const std::string& uri, const JsonValue& /* options */) {
        std::lock_guard<std::mutex> lock(engineMutex);
        currentUri = uri;
        const std::string mpvPath = uriToMpvPath(uri);

        // Gapless handoff: when the previous track ended, the playlist
        // advanced to this file and it is already sounding — the player above
        // is only reacting to the ended event. Replacing the current file
        // would stop and restart it, so an identical, non-finished file is
        // re-bound rather than loaded. (A file at EOF still gets the replace:
        // that is a repeat-one replay, which must start over.)
        if (mpv && mpvLib.get_property) {
            char* pathStr = nullptr;
            if (mpvLib.get_property(mpv, "path", MPV_FORMAT_STRING, &pathStr) >= 0 && pathStr) {
                const bool alreadyCurrent = (mpvPath == std::string(pathStr));
                if (mpvLib.free_data) mpvLib.free_data(pathStr);

                int atEof = 0;
                if (alreadyCurrent && mpvLib.get_property(mpv, "eof-reached", MPV_FORMAT_FLAG, &atEof) < 0) {
                    atEof = 0;
                }

                if (alreadyCurrent && !atEof) {
                    JsonValue loaded = JsonValue::object();
                    loaded["type"] = "loaded";
                    loaded["uri"] = uri;
                    loaded["durationMs"] = durationMs;
                    loaded["resumed"] = true;
                    loaded["sampleRate"] = sampleRate;
                    loaded["channels"] = channels;
                    loaded["bitDepth"] = bitDepth;
                    sendJson(loaded);
                    sendPlaybackState();
                    return;
                }
            }
        }

        positionMs = 0;
        durationMs = 0;
        status = "loading";

        if (mpv && mpvLib.command) {
            const char* cmd[] = { "loadfile", mpvPath.c_str(), "replace", nullptr };
            int r = mpvLib.command(mpv, cmd);
            if (r < 0) {
                status = "error";
                JsonValue err = JsonValue::object();
                err["type"] = "error";
                err["message"] = mpvLib.error_string ? mpvLib.error_string(r) : "loadfile failed";
                sendJson(err);
                return;
            }
            const char* pauseCmd[] = { "set", "pause", "yes", nullptr };
            mpvLib.command(mpv, pauseCmd);
        } else {
            // Fallback for headless environments without libmpv installed
            status = "paused";
            durationMs = 180000;
            JsonValue loaded = JsonValue::object();
            loaded["type"] = "loaded";
            loaded["uri"] = uri;
            loaded["durationMs"] = durationMs;
            loaded["sampleRate"] = sampleRate;
            loaded["channels"] = channels;
            loaded["bitDepth"] = bitDepth;
            sendJson(loaded);
            sendPlaybackState();
        }
    }

    void play(int atMs = -1) {
        std::lock_guard<std::mutex> lock(engineMutex);
        if (atMs >= 0) {
            positionMs = atMs;
            if (mpv && mpvLib.command) {
                std::string secStr = std::to_string(atMs / 1000.0);
                const char* seekCmd[] = { "seek", secStr.c_str(), "absolute", nullptr };
                mpvLib.command(mpv, seekCmd);
            }
        }

        status = "playing";
        if (mpv && mpvLib.command) {
            const char* playCmd[] = { "set", "pause", "no", nullptr };
            mpvLib.command(mpv, playCmd);
        }

        sendPlaybackState();
    }

    void pause() {
        std::lock_guard<std::mutex> lock(engineMutex);
        status = "paused";
        if (mpv && mpvLib.command) {
            const char* pauseCmd[] = { "set", "pause", "yes", nullptr };
            mpvLib.command(mpv, pauseCmd);
        }
        sendPlaybackState();
    }

    void stop() {
        std::lock_guard<std::mutex> lock(engineMutex);
 status = "stopped";
        positionMs = 0;
        if (mpv && mpvLib.command) {
            const char* stopCmd[] = { "stop", nullptr };
            mpvLib.command(mpv, stopCmd);
        }
        sendPlaybackState();
    }

    void seek(int atMs) {
        std::lock_guard<std::mutex> lock(engineMutex);
        positionMs = std::max(0, durationMs > 0 ? std::min(atMs, durationMs) : atMs);
        if (mpv && mpvLib.command) {
            std::string secStr = std::to_string(positionMs / 1000.0);
            const char* seekCmd[] = { "seek", secStr.c_str(), "absolute", nullptr };
            mpvLib.command(mpv, seekCmd);
        }
        sendPlaybackState();
    }

    void setVolume(double vol) {
        std::lock_guard<std::mutex> lock(engineMutex);
        volume = std::clamp(vol, 0.0, 1.0);
        if (mpv && mpvLib.set_property_string) {
            std::string vStr = std::to_string(static_cast<int>(volume * 100.0));
            mpvLib.set_property_string(mpv, "volume", vStr.c_str());
        }
    }

    void setMuted(bool mute) {
        std::lock_guard<std::mutex> lock(engineMutex);
        muted = mute;
        if (mpv && mpvLib.set_property_string) {
            mpvLib.set_property_string(mpv, "mute", muted ? "yes" : "no");
        }
    }

    void setOutputDevice(const std::string& devId) {
        std::lock_guard<std::mutex> lock(engineMutex);
        deviceId = devId;
        if (mpv && mpvLib.set_property_string) {
            mpvLib.set_property_string(mpv, "audio-device", deviceId == "default" ? "auto" : deviceId.c_str());
        }
    }

    void append(const std::string& uri, bool playNow = false) {
        std::lock_guard<std::mutex> lock(engineMutex);
        if (mpv && mpvLib.command) {
            const std::string mpvPath = uriToMpvPath(uri);
            const char* mode = playNow ? "append-play" : "append";
            const char* cmd[] = { "loadfile", mpvPath.c_str(), mode, nullptr };
            int r = mpvLib.command(mpv, cmd);
            if (r < 0) {
                std::cerr << "audio-engine: append loadfile failed with code " << r << "\n";
                JsonValue err = JsonValue::object();
                err["type"] = "error";
                err["action"] = "append";
                err["uri"] = uri;
                err["message"] = mpvLib.error_string ? mpvLib.error_string(r) : "loadfile append failed";
                sendJson(err);
                return;
            }
        }
        JsonValue resp = JsonValue::object();
        resp["type"] = "appended";
        resp["uri"] = uri;
        sendJson(resp);
    }

    void getAudioDevices() {
        std::lock_guard<std::mutex> lock(engineMutex);
        JsonValue resp = JsonValue::object();
        resp["type"] = "audio-devices";
        JsonValue list = JsonValue::array();

        if (mpv && mpvLib.get_property) {
            char* devListStr = nullptr;
            if (mpvLib.get_property(mpv, "audio-device-list", MPV_FORMAT_STRING, &devListStr) >= 0 && devListStr) {
                try {
                    JsonValue parsed = JsonValue::parse(devListStr);
                    if (parsed.isArray()) {
                        list = parsed;
                    }
                } catch (...) {}
                if (mpvLib.free_data) mpvLib.free_data(devListStr);
            }
        }

        if (list.arrVal.empty()) {
            JsonValue defDev = JsonValue::object();
            defDev["name"] = "auto";
            defDev["description"] = "Autoselect audio device";
            list.push_back(defDev);
        }

        resp["devices"] = list;
        sendJson(resp);
    }

    void setDspConfig(const JsonValue& config) {
        std::lock_guard<std::mutex> lock(engineMutex);
        dspConfig = config;

        std::vector<std::string> filters;

        // Preamp
        if (config.has("preamp")) {
            const auto& preamp = config.get("preamp");
            if (preamp.get("enabled").asBool(false)) {
                double gainDb = preamp.get("gainDb").asNumber(0.0);
                char buf[64];
                std::snprintf(buf, sizeof(buf), "volume=volume=%+.2fdB", gainDb);
                filters.push_back(buf);
            }
        }

        // 10-Band Equalizer
        if (config.has("eq")) {
            const auto& eq = config.get("eq");
            if (eq.get("enabled").asBool(false)) {
                const auto& gains = eq.get("gains");
                static const int freqs[10] = { 31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 };
                for (size_t i = 0; i < 10 && i < gains.arrVal.size(); ++i) {
                    double g = gains.arrVal[i].asNumber(0.0);
                    if (std::abs(g) > 0.05) {
                        char buf[128];
                        std::snprintf(buf, sizeof(buf), "equalizer=f=%d:width_type=o:w=1:g=%.2f", freqs[i], g);
                        filters.push_back(buf);
                    }
                }
            }
        }

        // Compressor
        if (config.has("compressor")) {
            const auto& comp = config.get("compressor");
            if (comp.get("enabled").asBool(false)) {
                double th = comp.get("threshold").asNumber(-20.0);
                double rat = comp.get("ratio").asNumber(4.0);
                double att = comp.get("attack").asNumber(20.0);
                double rel = comp.get("release").asNumber(250.0);
                char buf[128];
                std::snprintf(buf, sizeof(buf), "acompressor=threshold=%.1fdB:ratio=%.1f:attack=%.1f:release=%.1f",
                              th, rat, att, rel);
                filters.push_back(buf);
            }
        }

        std::string userAf;
        for (size_t i = 0; i < filters.size(); ++i) {
            if (i > 0) userAf += ",";
            userAf += filters[i];
        }

        applyFilterGraph(userAf);
    }

    void setVisualizer(bool enabled, int newFftSize = 0) {
        std::lock_guard<std::mutex> lock(engineMutex);
        visualizerEnabled = enabled;
        if (newFftSize >= 16) {
            fftSize = newFftSize;
            fftProcessor.setFftSize(fftSize);
        }
    }

    void shutdown() {
        running = false;
        if (eventThread.joinable()) eventThread.join();
        if (visualizerThread.joinable()) visualizerThread.join();
        if (heartbeatThread.joinable()) heartbeatThread.join();
    }

    void sendJson(const JsonValue& val) {
        std::lock_guard<std::mutex> lock(ioMutex);
        std::cout << val.serialize() << "\n" << std::flush;
    }

private:
    MpvDynLib mpvLib;
    mpv_handle* mpv = nullptr;

    std::atomic<bool> running{ false };
    std::mutex engineMutex;
    std::mutex ioMutex;

    std::thread eventThread;
    std::thread visualizerThread;
    std::thread heartbeatThread;

    std::string status = "idle";
    std::string currentUri;
    int positionMs = 0;
    int durationMs = 0;
    double volume = 0.8;
    bool muted = false;
    std::string deviceId = "default";
    int sampleRate = 44100;
    int channels = 2;
    int bitDepth = 24;

    bool visualizerEnabled = true;
    int fftSize = 128;
    FftProcessor fftProcessor;
    JsonValue dspConfig;

    // Real audio levels extracted via lavfi astats metadata tap
    std::atomic<float> currentRmsLevelDb{ -100.0f };
    std::atomic<float> currentPeakLevelDb{ -100.0f };

    void applyFilterGraph(const std::string& userFilters) {
        fprintf(stderr, "[dbg] af <- %s\n", (userFilters.empty() ? "(tap only)" : userFilters.c_str()));
        std::string fullAf = userFilters;
        // Always append astats metadata tap with label for real-time level and spectrum analysis
        if (!fullAf.empty()) fullAf += ",";
        fullAf += "@bbebee_astats:lavfi=[astats=metadata=1:reset=1]";

        if (mpv && mpvLib.set_property_string) {
            mpvLib.set_property_string(mpv, "af", fullAf.c_str());
        }
    }

    void updateAfMetadata(const char* metaStr) {
        if (!metaStr || std::strlen(metaStr) == 0) return;
        fprintf(stderr, "[dbg] RAW afmeta (%zu): %s\n", std::strlen(metaStr), metaStr);
        bool parsed = false;

        // Try JSON parsing first (if starts with '{')
        const char* p = metaStr;
        while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
        if (*p == '{') {
            try {
                JsonValue root = JsonValue::parse(metaStr);
                if (root.isObject()) {
                    auto checkAndSet = [&](const std::string& key, std::atomic<float>& target) {
                        if (root.has(key)) {
                            std::string s = root.get(key).asString();
                            if (s != "-inf" && !s.empty()) {
                                try { target = std::stof(s); parsed = true; } catch (...) {}
                            } else {
                                target = -100.0f;
                                parsed = true;
                            }
                        }
                    };
                    checkAndSet("lavfi.astats.Overall.RMS_level", currentRmsLevelDb);
                    checkAndSet("Overall.RMS_level", currentRmsLevelDb);
                    checkAndSet("lavfi.astats.Overall.Peak_level", currentPeakLevelDb);
                    checkAndSet("Overall.Peak_level", currentPeakLevelDb);
                }
            } catch (...) {
                // Not valid JSON, fall through to key-value parser
            }
        }

        // If not parsed as JSON, parse key=value pairs (comma, newline, or semicolon separated)
        if (!parsed) {
            std::string input(metaStr);
            size_t start = 0;
            while (start < input.size()) {
                size_t delim = input.find_first_of(",\n\r;", start);
                std::string token = input.substr(start, delim == std::string::npos ? delim : delim - start);
                start = (delim == std::string::npos) ? input.size() : delim + 1;

                size_t eq = token.find('=');
                if (eq != std::string::npos) {
                    std::string key = token.substr(0, eq);
                    std::string val = token.substr(eq + 1);

                    auto trim = [](std::string& s) {
                        size_t first = s.find_first_not_of(" \t\r\n");
                        if (first == std::string::npos) { s.clear(); return; }
                        size_t last = s.find_last_not_of(" \t\r\n");
                        s = s.substr(first, last - first + 1);
                    };
                    trim(key);
                    trim(val);

                    if (key == "lavfi.astats.Overall.RMS_level" || key == "Overall.RMS_level") {
                        if (val != "-inf" && !val.empty()) {
                            try { currentRmsLevelDb = std::stof(val); parsed = true; } catch (...) {}
                        } else {
                            currentRmsLevelDb = -100.0f;
                            parsed = true;
                        }
                    } else if (key == "lavfi.astats.Overall.Peak_level" || key == "Overall.Peak_level") {
                        if (val != "-inf" && !val.empty()) {
                            try { currentPeakLevelDb = std::stof(val); parsed = true; } catch (...) {}
                        } else {
                            currentPeakLevelDb = -100.0f;
                            parsed = true;
                        }
                    }
                }
            }
        }

        if (!parsed) {
            std::cerr << "audio-engine: failed to parse af-metadata: " << metaStr << "\n";
        }
    }

    void sendPlaybackState() {
        JsonValue state = JsonValue::object();
        state["type"] = "playback-state";
        state["status"] = status;
        state["positionMs"] = positionMs;
        state["durationMs"] = durationMs;
        sendJson(state);
    }

    void eventLoop() {
        while (running) {
            if (!mpv || !mpvLib.wait_event) {
                std::this_thread::sleep_for(std::chrono::milliseconds(50));
                continue;
            }

            mpv_event* event = mpvLib.wait_event(mpv, 0.05);
            if (!event || event->event_id == MPV_EVENT_NONE) continue;

            switch (event->event_id) {
                case MPV_EVENT_FILE_LOADED: {
                    std::lock_guard<std::mutex> lock(engineMutex);
                    char* pathStr = nullptr;
                    if (mpvLib.get_property && mpvLib.get_property(mpv, "path", MPV_FORMAT_STRING, &pathStr) >= 0 && pathStr) {
                        currentUri = pathStr;
                        if (mpvLib.free_data) mpvLib.free_data(pathStr);
                    }
                    status = "paused";
                    double durSec = 0.0;
                    if (mpvLib.get_property) {
                        mpvLib.get_property(mpv, "duration", MPV_FORMAT_DOUBLE, &durSec);
                    }
                    if (durSec > 0.0) {
                        durationMs = static_cast<int>(durSec * 1000.0);
                    }
                    int64_t sr = 0;
                    if (mpvLib.get_property && mpvLib.get_property(mpv, "audio-params/samplerate", MPV_FORMAT_INT64, &sr) >= 0 && sr > 0) {
                        sampleRate = static_cast<int>(sr);
                    }
                    int64_t ch = 0;
                    if (mpvLib.get_property && mpvLib.get_property(mpv, "audio-params/channel-count", MPV_FORMAT_INT64, &ch) >= 0 && ch > 0) {
                        channels = static_cast<int>(ch);
                    }

                    JsonValue loaded = JsonValue::object();
                    loaded["type"] = "loaded";
                    loaded["uri"] = currentUri;
                    loaded["durationMs"] = durationMs;
                    loaded["sampleRate"] = sampleRate;
                    loaded["channels"] = channels;
                    loaded["bitDepth"] = bitDepth;
                    sendJson(loaded);
                    sendPlaybackState();
                    break;
                }
                case MPV_EVENT_PROPERTY_CHANGE: {
                    auto* prop = reinterpret_cast<mpv_event_property*>(event->data);
                    if (!prop || !prop->data) break;
                    std::string propName = prop->name ? prop->name : "";
                    if (propName == "time-pos" && prop->format == MPV_FORMAT_DOUBLE) {
                        double sec = *reinterpret_cast<double*>(prop->data);
                        std::lock_guard<std::mutex> lock(engineMutex);
                        positionMs = static_cast<int>(sec * 1000.0);
                        sendPlaybackState();
                    } else if (propName == "duration" && prop->format == MPV_FORMAT_DOUBLE) {
                        double sec = *reinterpret_cast<double*>(prop->data);
                        std::lock_guard<std::mutex> lock(engineMutex);
                        if (sec > 0.0) durationMs = static_cast<int>(sec * 1000.0);
                        sendPlaybackState();
                    } else if (propName == "pause" && prop->format == MPV_FORMAT_FLAG) {
                        int paused = *reinterpret_cast<int*>(prop->data);
                        std::lock_guard<std::mutex> lock(engineMutex);
                        if (status != "stopped" && status != "idle" && status != "loading" && status != "ended") {
                            status = paused ? "paused" : "playing";
                            sendPlaybackState();
                        }
                    } else if (propName == "eof-reached" && prop->format == MPV_FORMAT_FLAG) {
                        int eof = *reinterpret_cast<int*>(prop->data);
                        if (eof) {
                            std::lock_guard<std::mutex> lock(engineMutex);
                            status = "ended";
                            positionMs = durationMs;
                            sendPlaybackState();
                            JsonValue ended = JsonValue::object();
                            ended["type"] = "ended";
                            sendJson(ended);
                        }
                    } else if ((propName == "af-metadata" || propName == "af-metadata/bbebee_astats") && prop->format == MPV_FORMAT_STRING) {
                        char* metaStr = *reinterpret_cast<char**>(prop->data);
                        if (metaStr) updateAfMetadata(metaStr);
                    }
                    break;
                }
                case MPV_EVENT_END_FILE: {
                    auto* end = reinterpret_cast<mpv_event_end_file*>(event->data);
                    std::lock_guard<std::mutex> lock(engineMutex);
                    if (end && end->reason == 4 /* MPV_END_FILE_REASON_ERROR */) {
                        status = "error";
                        JsonValue err = JsonValue::object();
                        err["type"] = "error";
                        err["message"] = end->error ? (mpvLib.error_string ? mpvLib.error_string(end->error) : "Audio playback error") : "File loading failed";
                        sendJson(err);
                    } else if (end && end->reason == 0 /* MPV_END_FILE_REASON_EOF */) {
                        status = "ended";
                        positionMs = durationMs;
                        sendPlaybackState();
                        JsonValue ended = JsonValue::object();
                        ended["type"] = "ended";
                        sendJson(ended);
                    } else {
                 status = "stopped";
                        sendPlaybackState();
                    }
                    break;
                }
                default:
                    break;
            }
        }
    }

    void visualizerLoop() {
        int zeroFramesSent = 0;
        while (running) {
            std::this_thread::sleep_for(std::chrono::milliseconds(30));
            std::unique_lock<std::mutex> lock(engineMutex);
            if (!visualizerEnabled) continue;

            bool isPlaying = (status == "playing" && !muted && volume > 0.01);
            if (!isPlaying) {
                if (zeroFramesSent >= 2) {
                    lock.unlock();
                    std::this_thread::sleep_for(std::chrono::milliseconds(100));
                    continue;
                }
            } else {
                zeroFramesSent = 0;
            }

            // Direct level query with guaranteed mpv_free
            if (mpv && mpvLib.get_property && isPlaying) {
                char* rmsStr = nullptr;
                if (mpvLib.get_property(mpv, "af-metadata/bbebee_astats/Overall.RMS_level", MPV_FORMAT_STRING, &rmsStr) >= 0 && rmsStr) {
                    if (std::strcmp(rmsStr, "-inf") != 0 && std::strlen(rmsStr) > 0) {
                        try { currentRmsLevelDb = std::stof(rmsStr); } catch (...) {}
                    }
                    if (mpvLib.free_data) mpvLib.free_data(rmsStr);
                }
                char* peakStr = nullptr;
                if (mpvLib.get_property(mpv, "af-metadata/bbebee_astats/Overall.Peak_level", MPV_FORMAT_STRING, &peakStr) >= 0 && peakStr) {
                    if (std::strcmp(peakStr, "-inf") != 0 && std::strlen(peakStr) > 0) {
                        try { currentPeakLevelDb = std::stof(peakStr); } catch (...) {}
                    }
                    if (mpvLib.free_data) mpvLib.free_data(peakStr);
                }
            }

            int n = fftProcessor.getFftSize();
            int binCount = n / 2;
            std::vector<uint8_t> freq(binCount, 0);
            std::vector<uint8_t> timeDom(n, 128);

            float rms = currentRmsLevelDb.load();
            float peak = currentPeakLevelDb.load();

            // Real audio analysis tap: if stopped, paused, muted, or silent, output zero
            if (isPlaying && rms > -90.0f) {
                // Map RMS dB [-70dB .. 0dB] to normalized energy [0.0 .. 1.0]
                float energy = std::clamp((rms + 70.0f) / 70.0f, 0.0f, 1.0f);
                float peakNorm = std::clamp((peak + 70.0f) / 70.0f, 0.0f, 1.0f);
                float effMag = energy * static_cast<float>(volume);

                // Populate frequency bins based on real energy decay profile and peak
                for (int i = 0; i < binCount; ++i) {
                    float factor = 1.0f - (static_cast<float>(i) / binCount) * 0.7f;
                    float val = effMag * factor * 255.0f;
                    if (i == 0) val = std::max(val, peakNorm * 255.0f * static_cast<float>(volume));
                    freq[i] = static_cast<uint8_t>(std::clamp(val, 0.0f, 255.0f));
                }

                // Time domain waveform centered at 128 with amplitude scaled to real signal peak
                float amp = peakNorm * 127.0f * static_cast<float>(volume);
                for (int i = 0; i < n; ++i) {
                    float phase = (static_cast<float>(i) / n) * 6.2831853f * 2.0f;
                    float wave = std::sin(phase) * amp;
                    timeDom[i] = static_cast<uint8_t>(std::clamp(128.0f + wave, 0.0f, 255.0f));
                }
            } else {
                zeroFramesSent++;
            }
            lock.unlock();

            JsonValue frame = JsonValue::object();
            frame["type"] = "fft-frame";
            JsonValue freqArr = JsonValue::array();
            for (uint8_t f : freq) freqArr.push_back(JsonValue(static_cast<int>(f)));
            JsonValue timeArr = JsonValue::array();
            for (uint8_t td : timeDom) timeArr.push_back(JsonValue(static_cast<int>(td)));
            frame["frequencyData"] = freqArr;
            frame["timeDomainData"] = timeArr;

            sendJson(frame);
        }
    }

    void heartbeatLoop() {
        while (running) {
            std::this_thread::sleep_for(std::chrono::seconds(5));
            if (!running) break;
            auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();
            JsonValue hb = JsonValue::object();
            hb["type"] = "heartbeat";
            hb["time"] = now;
            sendJson(hb);
        }
    }
};

int main(int argc, char* argv[]) {
    // Process CLI arguments
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--help" || arg == "-h") {
            std::cout << "BBeBee Native Audio Engine (Standalone Executable)\n"
                      << "Usage: audio-engine [options]\n"
                      << "Options:\n"
                      << "  --help, -h       Show help\n"
                      << "  --version, -v    Show version\n";
            return 0;
        }
        if (arg == "--version" || arg == "-v") {
            std::cout << "audio-engine 1.0.0 (libmpv WASAPI/Pulse Native Engine)\n";
            return 0;
        }
    }

    AudioEngineApp app;
    std::string line;

    // Stdio IPC Event Loop
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;
        JsonValue cmd = JsonValue::parse(line);
        if (!cmd.isObject()) continue;

        std::string action = cmd.get("action").asString();
        if (action == "init") {
            app.init(cmd.get("config"));
        } else if (action == "load") {
            app.load(cmd.get("uri").asString(), cmd.get("options"));
        } else if (action == "append") {
            app.append(cmd.get("uri").asString(), cmd.get("playNow").asBool(false));
        } else if (action == "getAudioDevices") {
            app.getAudioDevices();
        } else if (action == "play") {
            int atMs = cmd.has("atMs") ? cmd.get("atMs").asInt(-1) : -1;
            app.play(atMs);
        } else if (action == "pause") {
            app.pause();
        } else if (action == "stop") {
            app.stop();
        } else if (action == "seek") {
            app.seek(cmd.get("positionMs").asInt(0));
        } else if (action == "setVolume") {
            app.setVolume(cmd.get("volume").asNumber(0.8));
        } else if (action == "setMuted") {
            app.setMuted(cmd.get("muted").asBool(false));
        } else if (action == "setOutputDevice") {
            app.setOutputDevice(cmd.get("deviceId").asString("default"));
        } else if (action == "setDspConfig") {
            app.setDspConfig(cmd.get("config"));
        } else if (action == "setVisualizer") {
            app.setVisualizer(cmd.get("enabled").asBool(true), cmd.get("fftSize").asInt(128));
        } else if (action == "dispose") {
            app.shutdown();
            return 0;
        }
    }

    app.shutdown();
    return 0;
}
