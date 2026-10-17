#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "=== Building Native Audio Engine ==="
node "${ROOT_DIR}/apps/desktop/scripts/build-audio-engine.js" "$@"

PLATFORM="$(uname -s)"
case "${PLATFORM}" in
  Linux*)  PLATFORM_DIR="linux" ;;
  Darwin*) PLATFORM_DIR="macos" ;;
  MINGW*|CYGWIN*|MSYS*) PLATFORM_DIR="windows" ;;
  *) PLATFORM_DIR="linux" ;;
esac

RES_DIR="${ROOT_DIR}/resources/${PLATFORM_DIR}"
BIN_DIR="${ROOT_DIR}/apps/desktop/bin"
EXE=""
if [ -f "${RES_DIR}/audio-engine.exe" ]; then
  EXE="${RES_DIR}/audio-engine.exe"
elif [ -f "${RES_DIR}/audio-engine" ]; then
  EXE="${RES_DIR}/audio-engine"
elif [ -f "${BIN_DIR}/audio-engine.exe" ]; then
  EXE="${BIN_DIR}/audio-engine.exe"
elif [ -f "${BIN_DIR}/audio-engine" ]; then
  EXE="${BIN_DIR}/audio-engine"
else
  echo "[build-audio-engine] Error: audio-engine executable not found in ${RES_DIR} or ${BIN_DIR}" >&2
  exit 1
fi

echo "=== Native Audio Engine build and verification completed successfully: ${EXE} ==="
