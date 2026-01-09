#!/bin/bash
set -euo pipefail

echo "🤖 Claude Code Docker Container Starting..."
echo "================================================"

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

echo "✅ Environment variables validated"
echo "📝 Prompt: ${PROMPT:0:100}..."
echo "📂 Output directory: ${OUTPUT_DIR}"
echo "================================================"

cd "${OUTPUT_DIR}"

# Find the CLI binary (support both names just in case)
CLI=""
if command -v claude-code >/dev/null 2>&1; then
  CLI="claude-code"
elif command -v claude >/dev/null 2>&1; then
  CLI="claude"
else
  echo "❌ Neither 'claude-code' nor 'claude' found in PATH."
  echo "PATH=${PATH}"
  echo "Contents of /usr/local/bin:"
  ls -la /usr/local/bin || true
  exit 1
fi

echo "🚀 Starting generation using: ${CLI}"
echo ""

# Run generation
"${CLI}" --prompt "${PROMPT}" --dangerously-skip-permissions

echo ""
echo "================================================"
echo "✅ Generation completed successfully!"
echo "📁 Generated files in ${OUTPUT_DIR}:"
ls -lah "${OUTPUT_DIR}" || true
echo "================================================"

if [ "${KEEP_ALIVE}" = "true" ]; then
  echo ""
  echo "📦 KEEP_ALIVE=true → container will stay running for extraction"
  tail -f /dev/null
fi
