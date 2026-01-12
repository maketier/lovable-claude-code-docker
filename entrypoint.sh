#!/bin/bash
set -euo pipefail

echo "🤖 Lovable Generator Starting..."
echo "================================================"

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "❌ Error: ANTHROPIC_API_KEY environment variable is required"
  exit 1
fi

if [ -z "${PROMPT:-}" ]; then
  echo "❌ Error: PROMPT environment variable is required"
  exit 1
fi

export OUTPUT_DIR="${OUTPUT_DIR:-/workspace}"

echo "✅ Env validated"
echo "📂 Output directory: ${OUTPUT_DIR}"
echo "📝 Prompt (first 100 chars): ${PROMPT:0:100}..."
echo "🤖 Model: ${ANTHROPIC_MODEL:-claude-3-5-sonnet-latest}"
echo "================================================"
echo "🚀 Running generator..."
echo ""

cd /app
exec node generator.js
