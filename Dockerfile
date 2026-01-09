# Claude Code Docker Image for Isolated Generation
FROM node:20-slim

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    python3 \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI (documented npm method)
RUN npm install -g @anthropic-ai/claude-code \
  && command -v claude \
  && claude --version

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh

# Create non-root user (required to allow --dangerously-skip-permissions)
RUN useradd -m -u 10001 appuser \
  && mkdir -p /workspace \
  && chown -R appuser:appuser /workspace

# Defaults (override at runtime)
ENV OUTPUT_DIR="/workspace"
ENV KEEP_ALIVE="false"

# Run as non-root
USER appuser
WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
