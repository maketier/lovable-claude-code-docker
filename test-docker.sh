#!/bin/bash
# Test script for Claude Code Docker image

set -e

echo "🧪 Testing Claude Code Docker Image"
echo "===================================="

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

echo "✅ Docker is installed"

# Check if API key is provided
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "❌ Please set ANTHROPIC_API_KEY environment variable"
    echo "   Example: export ANTHROPIC_API_KEY='your-key-here'"
    exit 1
fi

echo "✅ API key found"

# Build the image
echo ""
echo "📦 Building Docker image..."
docker build -t lovable-claude-code:test .

echo "✅ Image built successfully"

# Run a test generation
echo ""
echo "🚀 Running test generation (simple HTML page)..."
CONTAINER_ID=$(docker run -d \
    --network none \
    -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
    -e PROMPT="Create a simple HTML page that says 'Hello from Claude Code Docker!'" \
    lovable-claude-code:test)

echo "✅ Container started: $CONTAINER_ID"
echo ""
echo "📡 Streaming logs (press Ctrl+C to stop watching)..."
echo ""

# Stream logs
docker logs -f $CONTAINER_ID &
LOG_PID=$!

# Wait for generation to complete (max 5 minutes)
TIMEOUT=300
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker exec $CONTAINER_ID test -f /workspace/index.html 2>/dev/null; then
        echo ""
        echo "✅ Generation complete!"
        break
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

# Stop log streaming
kill $LOG_PID 2>/dev/null || true

# Check results
echo ""
echo "📁 Generated files:"
docker exec $CONTAINER_ID ls -lh /workspace

echo ""
echo "📄 Preview of index.html:"
echo "------------------------"
docker exec $CONTAINER_ID cat /workspace/index.html | head -20

echo ""
echo "------------------------"
echo ""
echo "✅ Test completed successfully!"
echo ""
echo "💡 To extract files:"
echo "   docker cp $CONTAINER_ID:/workspace/. ./output/"
echo ""
echo "💡 To clean up:"
echo "   docker stop $CONTAINER_ID"
echo "   docker rm $CONTAINER_ID"
