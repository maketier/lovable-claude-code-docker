#!/usr/bin/env bash
set -euo pipefail

echo "🤖 Claude Code Container Starting..."
echo "================================================"

# Required env vars
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "❌ Error: ANTHROPIC_API_KEY environment variable is required"
  exit 1
fi

if [ -z "${PROMPT:-}" ]; then
  echo "❌ Error: PROMPT environment variable is required"
  exit 1
fi

OUTPUT_DIR="${OUTPUT_DIR:-/workspace}"
KEEP_ALIVE="${KEEP_ALIVE:-false}"

echo "✅ Env validated"
echo "📂 Output directory: ${OUTPUT_DIR}"
echo "📝 Prompt (first 100 chars): ${PROMPT:0:100}..."
echo "================================================"

mkdir -p "${OUTPUT_DIR}"
cd "${OUTPUT_DIR}"

# Claude Code CLI executable is typically `claude`
# Be defensive anyway.
CLI=""
if command -v claude >/dev/null 2>&1; then
  CLI="claude"
elif command -v claude-code >/dev/null 2>&1; then
  CLI="claude-code"
else
  echo "❌ Claude Code CLI not found (expected 'claude')."
  echo "PATH=${PATH}"
  echo "Listing /usr/local/bin:"
  ls -la /usr/local/bin || true
  exit 1
fi

echo "🚀 Running: ${CLI}"
echo ""

# Run generation
# Note: keep flags minimal and stable; add others only if you know you need them.
"${CLI}" -p "${PROMPT}" --dangerously-skip-permissions

echo ""
echo "================================================"
echo "✅ Generation finished"
echo "📁 Contents of ${OUTPUT_DIR}:"
ls -lah "${OUTPUT_DIR}" || true
echo "================================================"

# For automation: default is to exit.
# For debugging/manual extraction: KEEP_ALIVE=true
if [ "${KEEP_ALIVE}" = "true" ]; then
  echo ""
  echo "📦 KEEP_ALIVE=true → container will stay running for extraction"
  tail -f /dev/null
fi
