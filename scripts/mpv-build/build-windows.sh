#!/usr/bin/env bash
# Run inside MSYS2 MINGW64 environment (or Git Bash configured with mingw64 toolchain)
set -euo pipefail

MPV_VERSION="${1:-v0.38.0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PATCH_FILE="${ROOT_DIR}/patches/mpv-pcm-tap.patch"
TARGET_DIR="${2:-${ROOT_DIR}/apps/desktop/resources/libmpv/win64}"
WORK_DIR="/tmp/mpv-build-win64-$$"

echo "=== Building Patched libmpv for Windows x86_64 (${MPV_VERSION}) ==="
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
    -Dwasapi=enabled \
    -Dc_args='-Wno-deprecated-declarations'

echo "Compiling libmpv with Ninja..."
ninja -C build

echo "Copying compiled libmpv library to ${TARGET_DIR}..."
mkdir -p "${TARGET_DIR}"
# Windows build only needs a single libmpv-2.dll file for desktop audio engine
DLL_SRC="$(ls build/*mpv*.dll 2>/dev/null | head -n 1)"
if [ -n "${DLL_SRC}" ]; then
    cp -P "${DLL_SRC}" "${TARGET_DIR}/libmpv-2.dll"
else
    echo "Error: No mpv dll found in build directory" >&2
    exit 1
fi

echo "=== Patched libmpv successfully generated for Windows ==="
ls -la "${TARGET_DIR}/"
