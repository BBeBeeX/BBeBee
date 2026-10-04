#ifndef PCM_RING_BUFFER_HPP
#define PCM_RING_BUFFER_HPP

#include <cstddef>
#include <vector>
#include <atomic>
#include <algorithm>
#include <cstring>

namespace audio_engine {

/**
 * Thread-safe Single-Producer Single-Consumer (SPSC) Lock-Free RingBuffer for audio PCM.
 *
 * Designed specifically for bridging libmpv's high-priority audio callback
 * thread to the visualizer/FFT worker thread:
 * - Producer (audio thread) never acquires mutexes, never allocates memory, and never blocks.
 * - Stores interleaved float32 frames.
 * - Frame count = sample count / channels.
 * - SPSC atomic acquire-release fences guarantee race-free lockless synchronization.
 */
class PcmRingBuffer {
public:
    PcmRingBuffer();
    ~PcmRingBuffer();

    PcmRingBuffer(const PcmRingBuffer&) = delete;
    PcmRingBuffer& operator=(const PcmRingBuffer&) = delete;

    /**
     * Configure buffer capacity and audio stream attributes.
     * Must be called during engine init or when sample rate / channels change.
     */
    bool configure(int sampleRate, int channels, size_t capacityFrames);

    /**
     * Producer method: writes interleaved float frames into ring buffer.
     * Non-blocking: if buffer is full, drops incoming frames without waiting.
     * @return Number of frames written.
     */
    size_t write(const float* interleaved, size_t frames);

    /**
     * Consumer method: reads up to maxFrames interleaved float frames into caller buffer.
     * @return Number of frames actually read.
     */
    size_t read(float* interleaved, size_t maxFrames);

    /**
     * Clear buffer content instantaneously (e.g. on seek, load, stop).
     */
    void clear();

    /**
     * Returns total frames currently buffered and ready to read.
     */
    size_t availableFrames() const;

    /**
     * Consumer helper: if available frames exceed threshold (visualizer latency),
     * advances read pointer to keep at most maxFramesToKeep, discarding older audio.
     */
    size_t discardExcessFrames(size_t maxFramesToKeep);

    int getSampleRate() const { return sampleRate_; }
    int getChannels() const { return channels_; }
    size_t getCapacityFrames() const { return capacity_; }

private:
    int sampleRate_ = 44100;
    int channels_ = 2;
    size_t capacity_ = 0;
    std::vector<float> buffer_;

    // Protection during reconfiguration
    std::atomic<bool> configuring_{ false };
    std::atomic<int> activeWriters_{ 0 };

    // Deferred clear request to preserve SPSC single-consumer guarantee on readIndex_
    std::atomic<bool> clearRequested_{ false };

    // Align to 64 bytes to eliminate false sharing between audio producer and visualizer consumer
    alignas(64) std::atomic<size_t> writeIndex_{ 0 };
    alignas(64) std::atomic<size_t> readIndex_{ 0 };
};

} // namespace audio_engine

#endif // PCM_RING_BUFFER_HPP
