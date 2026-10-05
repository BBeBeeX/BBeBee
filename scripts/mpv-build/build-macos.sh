#!/usr/bin/env bash
set -euo pipefail

MPV_VERSION="${1:-v0.38.0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PATCH_FILE="${ROOT_DIR}/patches/mpv-pcm-tap.patch"
TARGET_DIR="${2:-${ROOT_DIR}/apps/desktop/resources/libmpv/darwin}"
WORK_DIR="/tmp/mpv-build-macos-$$"

echo "=== Building Patched libmpv for macOS (${MPV_VERSION}) ==="
echo "Work dir: ${WORK_DIR}"
echo "Target dir: ${TARGET_DIR}"

mkdir -p "${TARGET_DIR}"
TARGET_DIR="$(cd "${TARGET_DIR}" && pwd)"
mkdir -p "${WORK_DIR}"

cleanup() {
    rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

echo "Cloning mpv repository..."
git clone --depth 1 --branch "${MPV_VERSION}" https://github.com/mpv-player/mpv.git "${WORK_DIR}/mpv-src"

cd "${WORK_DIR}/mpv-src"

echo "Applying PCM tap patch..."
if git apply --ignore-whitespace --ignore-space-change "${PATCH_FILE}" 2>/dev/null; then
    echo "Patch applied cleanly."
else
    echo "Applying patch with CRLF conversion..."
    tr -d '\r' < "${PATCH_FILE}" | git apply --ignore-whitespace --ignore-space-change -
fi

echo "Configuring build with Meson..."
meson setup build \
    --buildtype=release \
    -Ddefault_library=shared \
    -Dlibmpv=true \
    -Dcplayer=false \
    -Dcoreaudio=enabled \
    -Dc_args='-Wno-deprecated-declarations -DGL_SILENCE_DEPRECATION'

echo "Compiling libmpv with Ninja..."
ninja -C build

echo "Copying compiled libraries to ${TARGET_DIR}..."
mkdir -p "${TARGET_DIR}"
for f in build/libmpv*.dylib*; do
    if [ -f "$f" ] || [ -L "$f" ]; then
        cp -P "$f" "${TARGET_DIR}/"
    fi
done

echo "=== Patched libmpv successfully generated for macOS ==="
ls -la "${TARGET_DIR}/"
