# Claude Code Docker Image for Isolated Generation
FROM node:20-slim

# System dependencies
# - bash: your entrypoint uses bash
# - ca-certificates/curl/git: common tooling
# - python3/build-essential: often needed by tooling / node-gyp
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    python3 \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI via NPM (official documented method)
# Docs: npm install -g @anthropic-ai/claude-code
RUN npm install -g @anthropic-ai/claude-code \
  && command -v claude \
  && claude --version

# Workspace
WORKDIR /workspace

# Entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Defaults (override at runtime)
ENV OUTPUT_DIR="/workspace"
ENV KEEP_ALIVE="false"

ENTRYPOINT ["/entrypoint.sh"]
