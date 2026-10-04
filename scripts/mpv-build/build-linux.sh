#!/usr/bin/env bash
set -euo pipefail

MPV_VERSION="${1:-v0.38.0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PATCH_FILE="${ROOT_DIR}/patches/mpv-pcm-tap.patch"
TARGET_DIR="${ROOT_DIR}/apps/desktop/resources/libmpv/linux"
WORK_DIR="/tmp/mpv-build-linux-$$"

echo "=== Building Patched libmpv for Linux (${MPV_VERSION}) ==="
echo "Work dir: ${WORK_DIR}"
echo "Target dir: ${TARGET_DIR}"

mkdir -p "${WORK_DIR}"
mkdir -p "${TARGET_DIR}"

cleanup() {
    rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

echo "Cloning mpv repository..."
git clone --depth 1 --branch "${MPV_VERSION}" https://github.com/mpv-player/mpv.git "${WORK_DIR}/mpv-src"

cd "${WORK_DIR}/mpv-src"

echo "Applying PCM tap patch..."
git apply "${PATCH_FILE}"

echo "Configuring build with Meson..."
meson setup build \
    --buildtype=release \
    -Ddefault_library=shared \
    -Dlibmpv=true \
    -Dcplayer=false \
    -Dpulse=enabled \
    -Dalsa=enabled \
    -Dpipewire=enabled

echo "Compiling libmpv with Ninja..."
ninja -C build

echo "Copying compiled libraries to ${TARGET_DIR}..."
cp -P build/libmpv.so* "${TARGET_DIR}/"

echo "=== Patched libmpv successfully generated for Linux ==="
ls -la "${TARGET_DIR}/libmpv.so"*
