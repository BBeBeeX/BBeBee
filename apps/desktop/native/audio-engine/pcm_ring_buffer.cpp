#include "pcm_ring_buffer.hpp"
#include <thread>

namespace audio_engine {

PcmRingBuffer::PcmRingBuffer() = default;
PcmRingBuffer::~PcmRingBuffer() = default;

bool PcmRingBuffer::configure(int sampleRate, int channels, size_t capacityFrames) {
    if (sampleRate <= 0 || channels <= 0 || capacityFrames == 0) {
        return false;
    }

    // Signal writers to stop accepting incoming frames
    configuring_.store(true, std::memory_order_seq_cst);

    // Wait for any active write() in progress on the audio driver thread to complete
    while (activeWriters_.load(std::memory_order_seq_cst) > 0) {
        std::this_thread::yield();
    }

    sampleRate_ = sampleRate;
    channels_ = channels;
    capacity_ = capacityFrames;
    buffer_.assign(capacity_ * static_cast<size_t>(channels_), 0.0f);
    clearRequested_.store(false, std::memory_order_release);
    writeIndex_.store(0, std::memory_order_release);
    readIndex_.store(0, std::memory_order_release);

    configuring_.store(false, std::memory_order_release);
    return true;
}

size_t PcmRingBuffer::write(const float* interleaved, size_t frames) {
    if (!interleaved || frames == 0) {
        return 0;
    }

    // Fast-path check: do not write while configure is in progress
    if (configuring_.load(std::memory_order_acquire)) {
        return 0;
    }

    activeWriters_.fetch_add(1, std::memory_order_acquire);

    // Double check after incrementing activeWriters_
    if (configuring_.load(std::memory_order_relaxed) || capacity_ == 0 || channels_ <= 0) {
        activeWriters_.fetch_sub(1, std::memory_order_release);
        return 0;
    }

    const size_t r = readIndex_.load(std::memory_order_acquire);
    const size_t w = writeIndex_.load(std::memory_order_relaxed);
    const size_t occupied = w - r;
    const size_t freeFrames = (occupied < capacity_) ? (capacity_ - occupied) : 0;

    const size_t toWrite = std::min(frames, freeFrames);
    if (toWrite == 0) {
        // Drop frames safely without blocking the audio driver thread
        activeWriters_.fetch_sub(1, std::memory_order_release);
        return 0;
    }

    const size_t ch = static_cast<size_t>(channels_);
    const size_t wPos = w % capacity_;

    // Write in up to two contiguous chunks
    const size_t firstChunk = std::min(toWrite, capacity_ - wPos);
    std::memcpy(&buffer_[wPos * ch], interleaved, firstChunk * ch * sizeof(float));

    if (toWrite > firstChunk) {
        const size_t secondChunk = toWrite - firstChunk;
        std::memcpy(&buffer_[0], &interleaved[firstChunk * ch], secondChunk * ch * sizeof(float));
    }

    writeIndex_.store(w + toWrite, std::memory_order_release);
    activeWriters_.fetch_sub(1, std::memory_order_release);
    return toWrite;
}

size_t PcmRingBuffer::read(float* interleaved, size_t maxFrames) {
    // Process deferred clear on consumer thread
    if (clearRequested_.exchange(false, std::memory_order_acq_rel)) {
        const size_t w = writeIndex_.load(std::memory_order_acquire);
        readIndex_.store(w, std::memory_order_release);
        return 0;
    }

    if (!interleaved || maxFrames == 0 || capacity_ == 0 || channels_ <= 0) {
        return 0;
    }

    const size_t w = writeIndex_.load(std::memory_order_acquire);
    const size_t r = readIndex_.load(std::memory_order_relaxed);
    if (w <= r) {
        return 0;
    }

    const size_t available = w - r;
    const size_t toRead = std::min(maxFrames, available);

    const size_t ch = static_cast<size_t>(channels_);
    const size_t rPos = r % capacity_;

    // Read in up to two contiguous chunks
    const size_t firstChunk = std::min(toRead, capacity_ - rPos);
    std::memcpy(interleaved, &buffer_[rPos * ch], firstChunk * ch * sizeof(float));

    if (toRead > firstChunk) {
        const size_t secondChunk = toRead - firstChunk;
        std::memcpy(&interleaved[firstChunk * ch], &buffer_[0], secondChunk * ch * sizeof(float));
    }

    readIndex_.store(r + toRead, std::memory_order_release);
    return toRead;
}

void PcmRingBuffer::clear() {
    clearRequested_.store(true, std::memory_order_release);
}

size_t PcmRingBuffer::availableFrames() const {
    if (clearRequested_.load(std::memory_order_acquire)) {
        return 0;
    }
    const size_t w = writeIndex_.load(std::memory_order_acquire);
    const size_t r = readIndex_.load(std::memory_order_relaxed);
    return (w > r) ? (w - r) : 0;
}

size_t PcmRingBuffer::discardExcessFrames(size_t maxFramesToKeep) {
    if (clearRequested_.exchange(false, std::memory_order_acq_rel)) {
        const size_t w = writeIndex_.load(std::memory_order_acquire);
        readIndex_.store(w, std::memory_order_release);
        return 0;
    }

    const size_t w = writeIndex_.load(std::memory_order_acquire);
    const size_t r = readIndex_.load(std::memory_order_relaxed);
    if (w <= r) return 0;
    const size_t avail = w - r;
    if (avail > maxFramesToKeep) {
        const size_t discarded = avail - maxFramesToKeep;
        readIndex_.store(r + discarded, std::memory_order_release);
        return discarded;
    }
    return 0;
}

} // namespace audio_engine
