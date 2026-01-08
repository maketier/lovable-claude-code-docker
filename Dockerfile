# Claude Code Docker Image for Isolated Generation
# This image runs Claude Code CLI in a secure, network-isolated environment

FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    python3 \
    python3-pip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
# This installs the latest version of Claude Code from Anthropic
RUN curl -fsSL https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/packages/cli/install.sh | bash

# Set up workspace directory
WORKDIR /workspace

# Create entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Environment variables that can be overridden
ENV ANTHROPIC_API_KEY=""
ENV PROMPT=""
ENV OUTPUT_DIR="/workspace"

# Run the entrypoint script
ENTRYPOINT ["/entrypoint.sh"]
