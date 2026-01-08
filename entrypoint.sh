#!/bin/bash
set -e

# Entrypoint script for Claude Code Docker container
# This script runs when the container starts and handles the generation process

echo "🤖 Claude Code Docker Container Starting..."
echo "================================================"

# Validate required environment variables
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "❌ Error: ANTHROPIC_API_KEY environment variable is required"
    exit 1
fi

if [ -z "$PROMPT" ]; then
    echo "❌ Error: PROMPT environment variable is required"
    exit 1
fi

echo "✅ Environment variables validated"
echo "📝 Prompt: ${PROMPT:0:100}..."
echo "📂 Output directory: $OUTPUT_DIR"
echo "================================================"

# Change to output directory
cd "$OUTPUT_DIR"

# Run Claude Code with the prompt
echo "🚀 Starting Claude Code generation..."
echo ""

# Use claude-code CLI to generate the application
# The --dangerously-skip-permissions flag is safe here because we're in an isolated container
claude-code --prompt "$PROMPT" --dangerously-skip-permissions

# Check if generation was successful
if [ $? -eq 0 ]; then
    echo ""
    echo "================================================"
    echo "✅ Generation completed successfully!"
    echo "📁 Generated files in $OUTPUT_DIR:"
    ls -lah "$OUTPUT_DIR"
    echo "================================================"
else
    echo ""
    echo "================================================"
    echo "❌ Generation failed"
    echo "================================================"
    exit 1
fi

# Keep container running so files can be extracted
echo ""
echo "📦 Container ready for file extraction"
echo "💡 Use 'docker exec <container-id> ls /workspace' to see files"
echo "💡 Use 'docker cp <container-id>:/workspace/. ./output' to copy files"
echo ""

# Sleep indefinitely to keep container alive
tail -f /dev/null
