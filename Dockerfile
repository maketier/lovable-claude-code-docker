FROM node:20-slim

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create workspace and set ownership to existing node user
RUN mkdir -p /workspace && \
    chown node:node /workspace

# Set up app directory
WORKDIR /app

# Copy package files
COPY package.json /app/package.json

# Install Node dependencies
RUN npm install --production && \
    npm cache clean --force

# Copy generator and entrypoint
COPY generator.js /app/generator.js
COPY entrypoint.sh /app/entrypoint.sh

# Copy templates for contract loading
COPY templates /templates

# Set permissions and ownership before switching to node user
RUN chmod +x /app/entrypoint.sh && \
    chown -R node:node /app

# Switch to non-root user
USER node

# Set workspace as default directory for generated files
WORKDIR /workspace

# Entry point
ENTRYPOINT ["/app/entrypoint.sh"]
