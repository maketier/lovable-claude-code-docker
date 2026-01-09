FROM node:20-slim

# System deps
RUN apt-get update && apt-get install -y \
    curl \
    git \
    python3 \
    python3-pip \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI via npm (reliable in Docker)
# NOTE: If the package name differs, we’ll adjust after verifying.
RUN npm i -g @anthropic-ai/claude-code \
  && command -v claude-code \
  && claude-code --version

WORKDIR /workspace

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV ANTHROPIC_API_KEY=""
ENV PROMPT=""
ENV OUTPUT_DIR="/workspace"
ENV KEEP_ALIVE="false"

ENTRYPOINT ["/entrypoint.sh"]
