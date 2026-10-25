/**
 * BbebeeMpvCore.mm — the iOS mpv engine core (see BbebeeMpvCore.h for the
 * contract). Everything mpv-specific lives in this one ObjC++ file so the
 * Expo-facing Swift module stays C-free and the (unavoidable) mpv C API,
 * lock-free ring-buffer atomics, and FFT loops are isolated here.
 *
 * The prebuilt engine layer this mirrors:
 * - Android: `libbbebee_audio_jni.so` (B_Be_Bee-audio-engine,
 *   `engine/jni/bbebee_audio_jni.cpp`) — the JSON payloads here are written to
 *   the same shapes (`docs/audio/engine.md` binding contract table).
 * - iOS prebuilt `BBeBeeAudioBridge.xcframework`: its Objective-C surface
 *   (initWithConfigDirectory/load/play/pause/stop/seekToSeconds/setVolume/
 *   getFrequencyData/isMpvAvailable/isPcmTapAvailable) is far narrower than
 *   the shared engine contract — no headers, append, mute, DSP, state/status
 *   JSON, devices, reinit — and its private mpv handle is not reachable, so
 *   wrapping it could never satisfy the JS adapter. Instead this core links
 *   the bundled `mpv.framework` directly and drives the same custom libmpv
 *   export the bridge uses (`mpv_set_pcm_callback`, documented in
 *   `resources/ios/mpv.framework/Headers/client.h`), which gives full
 *   contract coverage with the engine layer's own tap semantics.
 *
 * Threading model (mirrors the Android JNI layer):
 * - All command/property mutation arrives serialized from the Expo module's
 *   dispatch queue ("the module thread").
 * - A dedicated pump thread owns `mpv_wait_event` (the only mpv call that
 *   must be single-threaded) and folds events into atomics; it is joined
 *   before the handle is destroyed.
 * - The PCM tap fires on mpv's real-time audio playback thread; it does
 *   exactly one memcpy-equivalent loop plus atomic cursor moves into a
 *   preallocated, lock-free SPSC ring buffer — no locks, no allocation,
 *   no ObjC allocation, no logging.
 */

#import "BbebeeMpvCore.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

#if __has_include(<mpv/client.h>)
#define BBE_BEE_HAVE_MPV 1
#include <mpv/client.h>
#else
#define BBE_BEE_HAVE_MPV 0
#endif

#pragma mark - Helpers

namespace {

/**
 * Single-producer single-consumer float ring, indexed in interleaved samples
 * with monotonically increasing 64-bit cursors against a power-of-two
 * capacity. The producer is mpv's audio playback thread (real-time
 * constraints: fixed memory, no locks); the consumer is the visualizer read
 * on the module queue. Same shape as the engine layer's
 * `audio_engine::PcmRingBuffer` (write/read/clear/discardExcessFrames +
 * overflow stats), reduced to what the visualizer seam consumes.
 */
class PcmRing {
 public:
  void configure(int channels, int sampleRate) {
    if (channels <= 0 || sampleRate <= 0) return;
    // A format change invalidates the buffered tail (it would be misframed).
    if (channels != channels_.load(std::memory_order_acquire) ||
        sampleRate != sampleRate_.load(std::memory_order_acquire)) {
      clearPending_.store(true, std::memory_order_release);
      channels_.store(channels, std::memory_order_release);
      sampleRate_.store(sampleRate, std::memory_order_release);
    }
  }

  int channels() const { return channels_.load(std::memory_order_acquire); }
  int sampleRate() const { return sampleRate_.load(std::memory_order_acquire); }

  /** RT thread: write interleaved samples; drops what does not fit. */
  size_t write(const float *src, size_t samples) {
    if (src == nullptr || samples == 0 || buffer_ == nullptr) return 0;
    const uint64_t w = writeCursor_.load(std::memory_order_relaxed);
    const uint64_t r = readCursor_.load(std::memory_order_acquire);
    const size_t freeSpace = capacity_ - static_cast<size_t>(w - r);
    const size_t n = std::min(samples, freeSpace);
    if (n < samples) overflowCount_.fetch_add(1, std::memory_order_relaxed);
    for (size_t i = 0; i < n; i++) {
      buffer_[(w + i) & mask_] = src[i];
    }
    writeCursor_.store(w + n, std::memory_order_release);
    return n;
  }

  size_t availableSamples() const {
    return static_cast<size_t>(writeCursor_.load(std::memory_order_acquire) -
                               readCursor_.load(std::memory_order_relaxed));
  }

  /** Consumer thread: read up to `samples`; returns samples actually read. */
  size_t read(float *dst, size_t samples) {
    if (dst == nullptr || buffer_ == nullptr) return 0;
    consumeClear();
    const uint64_t r = readCursor_.load(std::memory_order_relaxed);
    const size_t n = std::min(samples, availableSamples());
    for (size_t i = 0; i < n; i++) {
      dst[i] = buffer_[(r + i) & mask_];
    }
    readCursor_.store(r + n, std::memory_order_release);
    return n;
  }

  /** Consumer thread: drop the oldest `samples` (backlog control). */
  void discardOldest(size_t samples) {
    consumeClear();
    const uint64_t r = readCursor_.load(std::memory_order_relaxed);
    readCursor_.store(r + std::min(samples, availableSamples()), std::memory_order_release);
  }

  /** Fixed preallocation at boot — the RT write path never allocates. */
  void allocate(size_t capacityFloats) {
    capacity_ = 1;
    while (capacity_ < capacityFloats) capacity_ <<= 1;
    mask_ = capacity_ - 1;
    buffer_.reset(new float[capacity_]);
    writeCursor_.store(0, std::memory_order_relaxed);
    readCursor_.store(0, std::memory_order_relaxed);
  }

 private:
  /** Deferred clear, consumed on the reader side only (never stalls the RT
   * write the way an immediate reset would — engine-layer parity). */
  void consumeClear() {
    if (clearPending_.exchange(false, std::memory_order_acq_rel)) {
      readCursor_.store(writeCursor_.load(std::memory_order_acquire),
                        std::memory_order_release);
    }
  }

  std::unique_ptr<float[]> buffer_;
  size_t capacity_ = 0;
  size_t mask_ = 0;
  std::atomic<uint64_t> writeCursor_{0};
  std::atomic<uint64_t> readCursor_{0};
  std::atomic<bool> clearPending_{false};
  std::atomic<int> channels_{0};
  std::atomic<int> sampleRate_{0};
  std::atomic<size_t> overflowCount_{0};
};

/**
 * Radix-2 Cooley–Tukey over preallocated buffers, desktop FftProcessor
 * semantics (docs/audio/engine.md §"FftProcessor Buffer Reuse"): downmix to
 * mono by frame averaging, Hann window, zero-pad a short window (no frame
 * residue), magnitude → dB clamp → 0..255, temporal smoothing between frames.
 */
class FftProcessor {
 public:
  void configure(size_t fftSize) {
    if (fftSize == size_ || fftSize < 4) return;
    size_ = fftSize;
    half_ = fftSize / 2;
    window_.resize(fftSize);
    for (size_t i = 0; i < fftSize; i++) {
      window_[i] = static_cast<float>(0.5 * (1.0 - std::cos(2.0 * M_PI * static_cast<double>(i) / static_cast<double>(fftSize))));
    }
    re_.assign(fftSize, 0.0f);
    im_.assign(fftSize, 0.0f);
    rev_.resize(fftSize);
    unsigned bits = 0;
    while ((static_cast<size_t>(1) << bits) < fftSize) bits++;
    for (size_t i = 0; i < fftSize; i++) {
      size_t x = i, r = 0;
      for (unsigned b = 0; b < bits; b++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      rev_[i] = r;
    }
    mono_.assign(fftSize, 0.0f);
    prev_.assign(half_, 0);
  }

  size_t size() const { return size_; }
  size_t half() const { return half_; }

  /** Append freshly drained mono samples, keeping the last `size_` of them. */
  void appendMono(const float *src, size_t n) {
    if (src == nullptr || n == 0 || mono_.empty()) return;
    if (n >= mono_.size()) {
      std::memcpy(mono_.data(), src + (n - mono_.size()), mono_.size() * sizeof(float));
      return;
    }
    const size_t keep = mono_.size() - n;
    std::memmove(mono_.data(), mono_.data() + n, keep * sizeof(float));
    std::memcpy(mono_.data() + keep, src, n * sizeof(float));
  }

  /**
   * Compute a frame into `outFreq`/`outTime` (`count` bytes each).
   * `smoothing` is the temporal floor (0..1): out = max(new, prev*smoothing)
   * — fast rise, slow fall, the analyser convention.
   */
  bool compute(uint8_t *outFreq, uint8_t *outTime, size_t count, float smoothing) {
    if (size_ == 0 || half_ == 0 || mono_.empty()) return false;
    if (count == 0 || outFreq == nullptr) return false;

    for (size_t i = 0; i < size_; i++) {
      re_[i] = mono_[i] * window_[i];
      im_[i] = 0.0f;
    }
    transform();

    const float norm = static_cast<float>(size_ / 4);  // Hann-window full-scale sine ≈ size/4
    const float dbFloor = -90.0f;
    size_t aggr = half_ / count;
    if (aggr == 0) aggr = 1;
    for (size_t bin = 0; bin < count; bin++) {
      float peak = 0.0f;
      const size_t start = bin * aggr;
      const size_t end = std::min(start + aggr, half_);
      for (size_t k = start; k < end; k++) {
        const float mag = std::sqrt(re_[k] * re_[k] + im_[k] * im_[k]) / norm + 1e-9f;
        if (mag > peak) peak = mag;
      }
      float db = 20.0f * std::log10(peak);
      if (db < dbFloor) db = dbFloor;
      if (db > 0.0f) db = 0.0f;
      const auto value = static_cast<uint8_t>(std::lround((db - dbFloor) / -dbFloor * 255.0f));
      const uint8_t previous = prev_[bin];
      outFreq[bin] = std::max(value, static_cast<uint8_t>(previous * smoothing));
      prev_[bin] = outFreq[bin];
    }

    if (outTime != nullptr) {
      const size_t n = std::min(count, mono_.size());
      const size_t offset = mono_.size() - n;
      for (size_t i = 0; i < n; i++) {
        const float s = std::max(-1.0f, std::min(1.0f, mono_[offset + i]));
        outTime[i] = static_cast<uint8_t>(std::lround((s * 0.5f + 0.5f) * 255.0f));
      }
      for (size_t i = n; i < count; i++) outTime[i] = 128;
    }
    return true;
  }

  /** Decay-only frame (no PCM arrived): keeps the loop flowing toward
   * silence and answers NO once it has fully decayed. */
  bool decay(uint8_t *outFreq, uint8_t *outTime, size_t count, float smoothing) {
    if (count == 0 || outFreq == nullptr) return false;
    bool alive = false;
    const size_t n = std::min(count, prev_.size());
    for (size_t bin = 0; bin < n; bin++) {
      const auto decayed = static_cast<uint8_t>(prev_[bin] * smoothing);
      outFreq[bin] = decayed;
      prev_[bin] = decayed;
      if (decayed > 0) alive = true;
    }
    for (size_t bin = n; bin < count; bin++) outFreq[bin] = 0;
    if (outTime != nullptr) {
      for (size_t i = 0; i < count; i++) outTime[i] = 128;
    }
    return alive;
  }

  void reset() {
    std::fill(prev_.begin(), prev_.end(), static_cast<uint8_t>(0));
    std::fill(mono_.begin(), mono_.end(), 0.0f);
  }

 private:
  void transform() {
    const size_t n = size_;
    for (size_t i = 0; i < n; i++) {
      const size_t j = rev_[i];
      if (j > i) {
        std::swap(re_[i], re_[j]);
        std::swap(im_[i], im_[j]);
      }
    }
    for (size_t len = 2; len <= n; len <<= 1) {
      const float angle = static_cast<float>(-2.0 * M_PI / static_cast<double>(len));
      const float stepR = std::cos(angle);
      const float stepI = std::sin(angle);
      for (size_t start = 0; start < n; start += len) {
        float curR = 1.0f;
        float curI = 0.0f;
        for (size_t k = 0; k < len / 2; k++) {
          const size_t a = start + k;
          const size_t b = a + len / 2;
          const float tr = re_[b] * curR - im_[b] * curI;
          const float ti = re_[b] * curI + im_[b] * curR;
          re_[b] = re_[a] - tr;
          im_[b] = im_[a] - ti;
          re_[a] += tr;
          im_[a] += ti;
          const float nextR = curR * stepR - curI * stepI;
          curI = curR * stepI + curI * stepR;
          curR = nextR;
        }
      }
    }
  }

  size_t size_ = 0;
  size_t half_ = 0;
  std::vector<float> window_;
  std::vector<float> re_;
  std::vector<float> im_;
  std::vector<size_t> rev_;
  std::vector<float> mono_;
  std::vector<uint8_t> prev_;
};

/** `file://`-scheme-insensitive comparison, per docs/audio/engine.md §"Gapless
 * Handoff" (mpv strips `file://` from its `path` property). */
NSString *NormalizePath(NSString *uri) {
  if (uri == nil) return nil;
  if ([uri hasPrefix:@"file://"] && uri.length > 7) {
    return [uri substringFromIndex:7];
  }
  return uri;
}

/** mpv bit depth from `audio-params/format` (0 = unknown). */
int FormatBitDepth(NSString *format) {
  if (format.length == 0) return 0;
  NSString *base = [format hasSuffix:@"p"] ? [format substringToIndex:format.length - 1] : format;
  NSDictionary<NSString *, NSNumber *> *map = @{
    @"u8" : @8,
    @"s16" : @16,
    @"s24" : @24,
    @"s32" : @32,
    @"float" : @32,
    @"double" : @64,
  };
  return map[base] != nil ? map[base].intValue : 0;
}

}  // namespace

@interface BbebeeMpvCore () {
#if BBE_BEE_HAVE_MPV
  mpv_handle *_mpv;
  std::thread _pumpThread;
#endif
  std::mutex _eventMutex;  // folds pump-thread event bookkeeping
  std::atomic<bool> _booted;
  std::atomic<bool> _pumpRunning;
  std::atomic<bool> _loadTaken;     // a FILE_LOADED arrived for the current load
  std::atomic<bool> _eofPending;    // last END_FILE was a natural end
  std::atomic<bool> _errorPending;  // last END_FILE was an error
  std::atomic<long> _endedCount;
  std::atomic<bool> _tapRegistered;
  std::atomic<bool> _visualizerEnabled;
  std::atomic<bool> _streamPlaying;  // degraded media-element keeps frames flowing
  PcmRing _ring;
  FftProcessor _fft;
  std::vector<float> _scratch;      // drain buffer (interleaved)
  std::vector<float> _monoScratch;  // downmix buffer
}
- (void)handlePcmFrames:(const float *)interleaved
                 frames:(int)frames
               channels:(int)channels
             sampleRate:(int)sampleRate;
- (void)pumpLoop;
@end

#if BBE_BEE_HAVE_MPV
namespace {
/** Real-time audio thread entry (mpv_set_pcm_callback). */
void PcmTapTrampoline(const float *interleaved, int frames, int channels, int sample_rate,
                      void *userdata) {
  BbebeeMpvCore *core = (__bridge BbebeeMpvCore *)userdata;
  [core handlePcmFrames:interleaved frames:frames channels:channels sampleRate:sample_rate];
}
}  // namespace
#endif

@implementation BbebeeMpvCore

- (instancetype)init {
  self = [super init];
  if (self) {
    // Explicit rather than relying on alloc's zero-fill (std::atomic's default
    // constructor leaves the object uninitialized per the standard).
    _booted.store(false, std::memory_order_relaxed);
    _pumpRunning.store(false, std::memory_order_relaxed);
    _loadTaken.store(false, std::memory_order_relaxed);
    _eofPending.store(false, std::memory_order_relaxed);
    _errorPending.store(false, std::memory_order_relaxed);
    _endedCount.store(0, std::memory_order_relaxed);
    _tapRegistered.store(false, std::memory_order_relaxed);
    _visualizerEnabled.store(false, std::memory_order_relaxed);
    _streamPlaying.store(false, std::memory_order_relaxed);
#if BBE_BEE_HAVE_MPV
    _mpv = nullptr;
#endif
  }
  return self;
}

- (void)dealloc {
  [self shutdown];
  // C++ ivar destructors (notably ~std::thread) run after this returns;
  // shutdown() guarantees the thread was joined and the tap unregistered.
}

- (BOOL)isBooted {
  return _booted.load(std::memory_order_acquire);
}

#pragma mark - Lifecycle

- (BOOL)boot:(NSError **)error {
  if (self.isBooted) return YES;
#if !BBE_BEE_HAVE_MPV
  if (error != nullptr) {
    *error = [NSError
        errorWithDomain:@"org.bbebee.audio"
                   code:1
               userInfo:@{
                 NSLocalizedDescriptionKey :
                     @"mpv.framework was not on the framework search path at build time "
                     "(run `pnpm fetch:audio-engine --app mobile`) — the engine runs in stub mode"
               }];
  }
  return NO;
#else
  // A leftover pump from a previous life (SHUTDOWN event path) must be joined
  // before a new thread takes the slot, or ~std::thread terminates.
  _pumpRunning.store(false, std::memory_order_release);
  if (_pumpThread.joinable()) _pumpThread.join();

  mpv_handle *mpv = mpv_create();
  if (mpv == nullptr) {
    if (error != nullptr) {
      *error = [NSError errorWithDomain:@"org.bbebee.audio" code:2
                            userInfo:@{NSLocalizedDescriptionKey : @"Failed to create mpv instance"}];
    }
    return NO;
  }
  // Headless audio-only configuration. `ao=audiounit` is the one audio output
  // compiled into the bundled framework (build string: -Daudiounit=enabled,
  // every other ao disabled); it drives AVAudioSession itself (playback
  // category + active session), so the module never touches the session.
  // `vo=null` + `audio-display=no` keep attached cover art from waking the
  // (absent) video pipeline. No config dir: mpv keeps its state in memory,
  // matching the Android engine's `nativeInit(null)`.
  mpv_set_option_string(mpv, "terminal", "no");
  mpv_set_option_string(mpv, "vo", "null");
  mpv_set_option_string(mpv, "audio-display", "no");
  mpv_set_option_string(mpv, "ao", "audiounit");
  if (mpv_initialize(mpv) != 0) {
    mpv_terminate_destroy(mpv);
    if (error != nullptr) {
      *error = [NSError errorWithDomain:@"org.bbebee.audio" code:3
                            userInfo:@{NSLocalizedDescriptionKey : @"mpv_initialize failed"}];
    }
    return NO;
  }
  _mpv = mpv;

  _loadTaken.store(false, std::memory_order_release);
  _eofPending.store(false, std::memory_order_release);
  _errorPending.store(false, std::memory_order_release);
  _endedCount.store(0, std::memory_order_release);
  _ring.allocate(1u << 19);  // 512 Ki floats = 2 MiB fixed, no runtime allocation
  _booted.store(true, std::memory_order_release);

  // One dedicated thread owns mpv_wait_event (the single-threaded mpv call);
  // shutdown() joins it before destroying the handle.
  _pumpRunning.store(true, std::memory_order_release);
  BbebeeMpvCore * __weak weakSelf = self;
  _pumpThread = std::thread([weakSelf] {
    BbebeeMpvCore *strongSelf = weakSelf;
    if (strongSelf != nil) [strongSelf pumpLoop];
  });

  // Re-arm the tap across a reinit: the old registration died with the old
  // handle. `setVisualizer`'s enabled flag survives the reboot.
  if (_visualizerEnabled.load(std::memory_order_acquire)) {
    [self registerTap];
  }
  return YES;
#endif
}

- (void)shutdown {
#if BBE_BEE_HAVE_MPV
  // Unconditionally wind the bookkeeping down (not gated on the exchange:
  // the pump itself may have flipped _booted on MPV_EVENT_SHUTDOWN).
  const bool wasBooted = _booted.exchange(false, std::memory_order_acq_rel);

  // Order matters, and client.h guarantees each step:
  // 1. unregister the tap — mpv_set_pcm_callback(NULL) blocks until any
  //    in-flight audio-thread invocation has finished, so after it returns
  //    the trampoline can never touch this object again;
  if (_mpv != nullptr && wasBooted) [self unregisterTap];
  // 2. stop and join the pump (its 100 ms mpv_wait_event wait bounds this);
  _pumpRunning.store(false, std::memory_order_release);
  if (_pumpThread.joinable()) _pumpThread.join();
  // 3. destroy the handle — no other thread touches it by now.
  if (_mpv != nullptr) {
    mpv_terminate_destroy(_mpv);
    _mpv = nullptr;
  }
#endif
}

#if BBE_BEE_HAVE_MPV

- (void)pumpLoop {
  while (_pumpRunning.load(std::memory_order_acquire)) {
    if (!self.isBooted) return;
    mpv_event *event = mpv_wait_event(_mpv, 0.1);
    if (event == nullptr) continue;
    switch (event->event_id) {
      case MPV_EVENT_FILE_LOADED: {
        std::lock_guard<std::mutex> lock(_eventMutex);
        _loadTaken.store(true, std::memory_order_release);
        _eofPending.store(false, std::memory_order_release);
        _errorPending.store(false, std::memory_order_release);
        break;
      }
      case MPV_EVENT_END_FILE: {
        auto *endFile = static_cast<mpv_event_end_file *>(event->data);
        std::lock_guard<std::mutex> lock(_eventMutex);
        if (endFile->reason == MPV_END_FILE_REASON_EOF) {
          _endedCount.fetch_add(1, std::memory_order_acq_rel);
          _eofPending.store(true, std::memory_order_release);
        } else if (endFile->reason == MPV_END_FILE_REASON_ERROR) {
          _errorPending.store(true, std::memory_order_release);
          _eofPending.store(false, std::memory_order_release);
        } else if (endFile->reason == MPV_END_FILE_REASON_STOP) {
          _eofPending.store(false, std::memory_order_release);
          _errorPending.store(false, std::memory_order_release);
        }
        break;
      }
      case MPV_EVENT_SHUTDOWN:
        _booted.store(false, std::memory_order_release);
        return;
      default:
        break;
    }
  }
}

- (void)registerTap {
  if (_mpv == nullptr) return;
  if (_tapRegistered.exchange(true, std::memory_order_acq_rel)) return;
  mpv_set_pcm_callback(_mpv, PcmTapTrampoline, (__bridge void *)self);
}

- (void)unregisterTap {
  if (_mpv == nullptr) return;
  if (!_tapRegistered.exchange(false, std::memory_order_acq_rel)) return;
  // Blocks until in-flight audio-thread invocations have finished (client.h),
  // so `userdata` (this object) is safe to release afterwards.
  mpv_set_pcm_callback(_mpv, nullptr, nullptr);
}

#pragma mark - PCM tap (audio playback thread)

- (void)handlePcmFrames:(const float *)interleaved
                 frames:(int)frames
               channels:(int)channels
             sampleRate:(int)sampleRate {
  if (frames <= 0 || channels <= 0 || sampleRate <= 0) return;
  _ring.configure(channels, sampleRate);
  // Real-time thread: one loop over the samples + atomic cursor moves,
  // nothing else (no locks, no allocation, no logging).
  _ring.write(interleaved, static_cast<size_t>(frames) * static_cast<size_t>(channels));
}

#pragma mark - mpv helpers (module thread)

/** Set a string-list property from `Key: Value\r\n…` (the adapter's
 * `headersToFields` form) as an MPV_FORMAT_NODE array — command-string
 * parsing would corrupt header values containing commas (Date, Cookie). */
- (void)setHttpHeaderFields:(NSString *)headers {
  if (headers.length == 0) return;
  NSArray<NSString *> *fields = [headers componentsSeparatedByString:@"\r\n"];
  NSMutableArray<NSString *> *clean = [NSMutableArray array];
  for (NSString *field in fields) {
    NSString *trimmed =
        [field stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
    if (trimmed.length > 0) [clean addObject:trimmed];
  }
  if (clean.count == 0) return;

  mpv_node node = {};
  node.format = MPV_FORMAT_NODE_ARRAY;
  auto *list = static_cast<mpv_node_list *>(malloc(sizeof(mpv_node_list)));
  list->num = static_cast<int>(clean.count);
  list->values = static_cast<mpv_node *>(calloc(clean.count, sizeof(mpv_node)));
  [clean enumerateObjectsUsingBlock:^(NSString *field, NSUInteger idx, BOOL *) {
    list->values[idx].format = MPV_FORMAT_STRING;
    list->values[idx].u.string = strdup(field.UTF8String);
  }];
  node.u.list = list;
  mpv_set_property(_mpv, "http-header-fields", MPV_FORMAT_NODE, &node);
  mpv_free_node_contents(&node);  // frees the list and the strdup'ed strings
}

- (NSString *)stringProperty:(const char *)name {
  char *value = mpv_get_property_string(_mpv, name);
  NSString *out = value != nullptr ? [NSString stringWithUTF8String:value] : nil;
  mpv_free(value);
  return out;
}

- (double)doubleProperty:(const char *)name {
  double value = 0.0;
  if (mpv_get_property(_mpv, name, MPV_FORMAT_DOUBLE, &value) != 0) return 0.0;
  return value;
}

- (BOOL)flagProperty:(const char *)name {
  int flag = 0;
  if (mpv_get_property(_mpv, name, MPV_FORMAT_FLAG, &flag) != 0) return NO;
  return flag != 0;
}

- (int64_t)int64Property:(const char *)name {
  int64_t value = 0;
  if (mpv_get_property(_mpv, name, MPV_FORMAT_INT64, &value) != 0) return 0;
  return value;
}

- (NSString *)currentPathNormalized {
  return NormalizePath([self stringProperty:"path"]);
}

- (long long)durationMsValue {
  const double seconds = [self doubleProperty:"duration"];
  if (!(seconds > 0.0)) return 0;
  return static_cast<long long>(seconds * 1000.0);
}

- (NSString *)loadFailureAnswer {
  return @"{\"ok\":false,\"durationMs\":0,\"resumed\":false,\"endedCount\":0}";
}

#endif  // BBE_BEE_HAVE_MPV

#pragma mark - Playback contract

- (NSString *)loadEx:(NSString *)uri headers:(NSString *)headers {
#if !BBE_BEE_HAVE_MPV
  (void)uri;
  (void)headers;
  return @"{\"ok\":false,\"durationMs\":0,\"resumed\":false,\"endedCount\":0}";
#else
  if (!self.isBooted || uri.length == 0) return [self loadFailureAnswer];

  // Gapless re-bind: the requested URI is what mpv is already sounding, and
  // the file has not run off its end (a repeat-one replay must start over).
  NSString *requested = NormalizePath(uri);
  if (![self flagProperty:"idle-active"] && !_eofPending.load(std::memory_order_acquire)) {
    NSString *current = [self currentPathNormalized];
    if (current != nil && [current isEqualToString:requested]) {
      return [NSString
          stringWithFormat:@"{\"ok\":true,\"durationMs\":%lld,\"resumed\":true,\"endedCount\":%lld}",
                           [self durationMsValue],
                           static_cast<long long>(_endedCount.load(std::memory_order_acquire))];
    }
  }

  {  // Reset the load bookkeeping under the event mutex — the pump thread
     // folds FILE_LOADED/END_FILE under it. Never held across the poll below.
    std::lock_guard<std::mutex> lock(_eventMutex);
    _eofPending.store(false, std::memory_order_release);
    _errorPending.store(false, std::memory_order_release);
    _loadTaken.store(false, std::memory_order_release);
    _endedCount.store(0, std::memory_order_release);
  }

  [self setHttpHeaderFields:headers];

  const char *argv[] = {"loadfile", uri.UTF8String, "replace", nullptr};
  if (mpv_command(_mpv, argv) != 0) return [self loadFailureAnswer];

  // Poll for the load (the Kotlin module's "lets loadEx poll mpv for the
  // duration") — bounded, on this module queue, never the JS thread. A
  // stream with no duration still answers ok after the grace period.
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
  auto loadedAt = std::chrono::steady_clock::time_point::max();
  double durationSeconds = 0.0;
  while (true) {
    if (_errorPending.load(std::memory_order_acquire)) return [self loadFailureAnswer];
    if (_loadTaken.load(std::memory_order_acquire)) {
      if (loadedAt == std::chrono::steady_clock::time_point::max()) {
        loadedAt = std::chrono::steady_clock::now();
      }
      durationSeconds = [self doubleProperty:"duration"];
      if (durationSeconds > 0.0) break;
      if (std::chrono::steady_clock::now() - loadedAt > std::chrono::milliseconds(1500)) break;
    }
    if (std::chrono::steady_clock::now() > deadline) break;
    std::this_thread::sleep_for(std::chrono::milliseconds(25));
  }

  if (!_loadTaken.load(std::memory_order_acquire)) return [self loadFailureAnswer];

  // Best-effort hardware-rate fields (absent from the JSON while unknown) —
  // read from mpv's `audio-params`, the same source the Android JNI uses.
  const int64_t sampleRate = [self int64Property:"audio-params/sample-rate"];
  const int64_t channels = [self int64Property:"audio-params/channel-count"];
  const int bitDepth = FormatBitDepth([self stringProperty:"audio-params/format"]);
  const long long durationMs =
      durationSeconds > 0.0 ? static_cast<long long>(durationSeconds * 1000.0) : 0;
  NSMutableString *answer = [NSMutableString
      stringWithFormat:@"{\"ok\":true,\"durationMs\":%lld,\"resumed\":false,\"endedCount\":0",
                       durationMs];
  if (sampleRate > 0) [answer appendFormat:@",\"sampleRate\":%lld", sampleRate];
  if (channels > 0) [answer appendFormat:@",\"channels\":%lld", channels];
  if (bitDepth > 0) [answer appendFormat:@",\"bitDepth\":%d", bitDepth];
  [answer appendString:@"}"];
  return answer;
#endif
}

- (BOOL)appendUri:(NSString *)uri headers:(NSString *)headers {
#if !BBE_BEE_HAVE_MPV
  (void)uri;
  (void)headers;
  return NO;
#else
  if (!self.isBooted || uri.length == 0) return NO;
  // The header property is engine-global and persists for the appended file —
  // the same property-based semantics the Android JNI layer has.
  [self setHttpHeaderFields:headers];
  const char *argv[] = {"loadfile", uri.UTF8String, "append", nullptr};
  return mpv_command(_mpv, argv) == 0;
#endif
}

- (void)playAtMs:(double)atMs {
#if BBE_BEE_HAVE_MPV
  if (!self.isBooted) return;
  // NaN is the adapter's "keep the engine's own position" marker (a paused
  // resume, or the gapless re-bind where a seek back to zero would restart
  // the track); the simulation bridge also ignores negatives.
  if (!std::isnan(atMs) && atMs >= 0.0) {
    NSString *seconds = [NSString stringWithFormat:@"%.3f", atMs / 1000.0];
    const char *seek[] = {"seek", seconds.UTF8String, "absolute+exact", nullptr};
    mpv_command(_mpv, seek);  // a failure while idle is fine to ignore
  }
  int unpaused = 0;
  mpv_set_property(_mpv, "pause", MPV_FORMAT_FLAG, &unpaused);
#endif
}

- (void)pausePlayback {
#if BBE_BEE_HAVE_MPV
  if (!self.isBooted) return;
  int paused = 1;
  mpv_set_property(_mpv, "pause", MPV_FORMAT_FLAG, &paused);
#endif
}

- (void)stopPlayback {
#if BBE_BEE_HAVE_MPV
  if (!self.isBooted) return;
  // Clear the pending end-file flags here too: a stop while idle fires no
  // END_FILE, and a stale `error`/`ended` must not outlive the user's stop
  // (the pump clears them again on the END_FILE(reason=stop) that does fire).
  {
    std::lock_guard<std::mutex> lock(_eventMutex);
    _eofPending.store(false, std::memory_order_release);
    _errorPending.store(false, std::memory_order_release);
  }
  const char *argv[] = {"stop", nullptr};
  mpv_command(_mpv, argv);
#endif
}

- (void)seekToMs:(double)ms {
#if BBE_BEE_HAVE_MPV
  if (!self.isBooted || std::isnan(ms)) return;
  NSString *seconds = [NSString stringWithFormat:@"%.3f", ms / 1000.0];
  const char *argv[] = {"seek", seconds.UTF8String, "absolute+exact", nullptr};
  mpv_command(_mpv, argv);
#endif
}

- (void)setVolume01:(double)volume01 {
#if BBE_BEE_HAVE_MPV
  if (!self.isBooted) return;
  const double clamped = std::max(0.0, std::min(1.0, volume01));
  double percent = clamped * 100.0;
  mpv_set_property(_mpv, "volume", MPV_FORMAT_DOUBLE, &percent);
#endif
}

- (void)setMuted:(BOOL)muted {
#if BBE_BEE_HAVE_MPV
  if (!self.isBooted) return;
  int flag = muted ? 1 : 0;
  mpv_set_property(_mpv, "mute", MPV_FORMAT_FLAG, &flag);
#endif
}

- (NSString *)stateJson {
  // Readable from any thread: atomics + mpv's thread-safe property reads.
#if !BBE_BEE_HAVE_MPV
  return @"{\"positionMs\":0,\"durationMs\":0,\"status\":\"idle\",\"endedCount\":0}";
#else
  if (!self.isBooted) {
    // A lost mpv core after a load had taken reads as the mid-track failure.
    return @"{\"positionMs\":0,\"durationMs\":0,\"status\":\"error\",\"endedCount\":0}";
  }
  const long long positionMs = static_cast<long long>([self doubleProperty:"time-pos"] * 1000.0);
  const long long durationMs = [self durationMsValue];
  const bool idle = [self flagProperty:"idle-active"];
  const bool paused = [self flagProperty:"pause"];
  const long long endedCount =
      static_cast<long long>(_endedCount.load(std::memory_order_acquire));

  const char *status;
  if (!idle) {
    status = paused ? "paused" : "playing";
  } else if (_errorPending.load(std::memory_order_acquire)) {
    // The engine went idle after a load had taken with no user stop — the
    // polling model's reading of a mid-track mpv failure.
    status = "error";
  } else if (_eofPending.load(std::memory_order_acquire)) {
    status = "ended";
  } else {
    status = "idle";
  }
  return [NSString
      stringWithFormat:
          @"{\"positionMs\":%lld,\"durationMs\":%lld,\"status\":\"%s\",\"endedCount\":%lld}",
          positionMs, durationMs, status, endedCount];
#endif
}

- (NSString *)engineStatusJson {
#if !BBE_BEE_HAVE_MPV
  return @"{\"running\":false,\"mpvAvailable\":false,\"pcmTapAvailable\":false,"
          @"\"transcodeAvailable\":false}";
#else
  const bool booted = self.isBooted;
  // pcmTapAvailable is a property of the linked engine build: the custom
  // libmpv export mpv_set_pcm_callback is linked in at compile time.
  return [NSString
      stringWithFormat:
          @"{\"running\":%@,\"mpvAvailable\":%@,\"pcmTapAvailable\":%@,\"transcodeAvailable\":false}",
          booted ? @"true" : @"false", booted ? @"true" : @"false", @"true"];
#endif
}

- (void)setDspConfigAf:(NSString *)af
            replaygain:(NSString *)replaygain
                  clip:(BOOL)clip
                preamp:(NSString *)preamp
              fallback:(NSString *)fallback {
#if BBE_BEE_HAVE_MPV
  if (!self.isBooted) return;
  // Best-effort property pushes; the desktop engine writes the same fields.
  if (af != nil) mpv_set_property_string(_mpv, "af", af.UTF8String);
  if (replaygain != nil) mpv_set_property_string(_mpv, "replaygain", replaygain.UTF8String);
  int clipFlag = clip ? 1 : 0;
  mpv_set_property(_mpv, "replaygain-clip", MPV_FORMAT_FLAG, &clipFlag);
  if (preamp != nil) mpv_set_property_string(_mpv, "replaygain-preamp", preamp.UTF8String);
  if (fallback != nil) mpv_set_property_string(_mpv, "replaygain-fallback", fallback.UTF8String);
#endif
}

- (void)setOutputDeviceId:(NSString *)deviceId {
#if BBE_BEE_HAVE_MPV
  if (!self.isBooted) return;
  // Only the system default route reaches mpv. iOS has no per-app sink
  // choice (the OS owns AVAudioSession routing) and mpv's audiounit ao
  // exposes no alternative devices — an unknown `audio-device` value would
  // make the ao fail to reopen and go silent. Non-`auto` ids from
  // `mpvGetAudioDevices` are accepted here and deliberately not forwarded.
  if ([deviceId isEqualToString:@"auto"] || [deviceId isEqualToString:@"default"]) {
    mpv_set_property_string(_mpv, "audio-device", "auto");
  }
#endif
}

- (void)setStreamPlayback:(BOOL)playing {
  // Works unbooted: the flag feeds only the visualizer's decay branch.
  _streamPlaying.store(playing, std::memory_order_release);
}

- (void)setAudioExclusive:(BOOL)exclusive {
#if BBE_BEE_HAVE_MPV
  if (!self.isBooted) return;
  int flag = exclusive ? 1 : 0;
  // mpv's global audio-exclusive option; the audiounit ao has no exclusive
  // mode and ignores it — set for contract parity, like the desktop engine
  // does for aos without exclusive support.
  mpv_set_property(_mpv, "audio-exclusive", MPV_FORMAT_FLAG, &flag);
#endif
}

#pragma mark - Visualizer seam

- (BOOL)setVisualizer:(BOOL)enabled fftSize:(NSUInteger)fftSize {
#if !BBE_BEE_HAVE_MPV
  (void)enabled;
  (void)fftSize;
  return NO;
#else
  if (!self.isBooted) return NO;
  if (enabled) {
    // Default 2048 (→ 256 bins); the request rounds up to a power of two
    // within [512, 8192]. The JS-side bin count is capped at 256 so a 60 FPS
    // poll never drags more than ~256×2 numbers across the bridge.
    const NSUInteger size = fftSize == 0 ? 2048 : fftSize;
    NSUInteger pow2 = 512;
    while (pow2 < size && pow2 < 8192) pow2 <<= 1;
    _fft.configure(static_cast<size_t>(pow2));
    _scratch.reserve(pow2 * 8);
    _monoScratch.reserve(pow2);
    [self registerTap];
    _visualizerEnabled.store(true, std::memory_order_release);
  } else {
    _visualizerEnabled.store(false, std::memory_order_release);
    [self unregisterTap];
    _fft.reset();
  }
  return enabled;
#endif
}

- (NSUInteger)fftBinCount {
  if (!_visualizerEnabled.load(std::memory_order_acquire)) return 0;
  const size_t half = _fft.half();
  return half == 0 ? 0 : std::min(half, static_cast<size_t>(256));
}

- (BOOL)getSpectrumFrequencyOut:(uint8_t *)frequency
                 timeDomainOut:(uint8_t *)timeDomain
                         count:(NSUInteger)count {
  if (!_visualizerEnabled.load(std::memory_order_acquire) || count == 0) return NO;
#if !BBE_BEE_HAVE_MPV
  (void)frequency;
  (void)timeDomain;
  return NO;
#else
  if (!self.isBooted) return NO;

  // Backlog control (engine-layer parity): keep at most ~60 ms of PCM so the
  // analysis window never drifts behind the speakers.
  const int channels = _ring.channels();
  const int sampleRate = _ring.sampleRate();
  if (channels > 0 && sampleRate > 0) {
    const size_t backlogLimit =
        static_cast<size_t>(sampleRate) * static_cast<size_t>(channels) * 60 / 1000;
    const size_t available = _ring.availableSamples();
    if (available > backlogLimit) _ring.discardOldest(available - backlogLimit);
  }

  const size_t fftSize = _fft.size();
  const size_t total = _ring.availableSamples();
  if (total > 0 && fftSize > 0 && channels > 0) {
    const size_t frames = total / static_cast<size_t>(channels);
    const size_t takeFrames = std::min(frames, fftSize);
    const size_t takeSamples = takeFrames * static_cast<size_t>(channels);
    _scratch.resize(takeSamples);
    _ring.read(_scratch.data(), takeSamples);

    // Downmix to mono by frame averaging (desktop FftProcessor semantics).
    _monoScratch.resize(takeFrames);
    for (size_t frame = 0; frame < takeFrames; frame++) {
      float sum = 0.0f;
      for (int ch = 0; ch < channels; ch++) {
        sum += _scratch[frame * static_cast<size_t>(channels) + static_cast<size_t>(ch)];
      }
      _monoScratch[frame] = sum / static_cast<float>(channels);
    }
    _fft.appendMono(_monoScratch.data(), takeFrames);
    return _fft.compute(frequency, timeDomain, count, 0.85f);
  }

  // No PCM arrived (paused, or a degraded media-element track): keep the
  // loop flowing with a decay-only frame and answer NO once it hit silence —
  // the visualizer loop's "couple of zero frames, then quiet" branch. A
  // streamPlaying flag (set by mpvSetStreamPlayback for degraded tracks)
  // holds the decay nearly still so frames keep flowing.
  const float smoothing = _streamPlaying.load(std::memory_order_acquire) ? 0.97f : 0.85f;
  return _fft.decay(frequency, timeDomain, count, smoothing);
#endif
}

@end
