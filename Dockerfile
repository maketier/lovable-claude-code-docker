FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# Minimal deps (git is optional, keep if you need it)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Workspace writable for non-root user
RUN mkdir -p /workspace && chown node:node /workspace

WORKDIR /app

# Copy package + install deps
COPY docker/package.json /app/package.json
RUN npm install --omit=dev && npm cache clean --force

# Copy app files
COPY docker/generator.js /app/generator.js
COPY docker/entrypoint.sh /app/entrypoint.sh

RUN chmod 755 /app/entrypoint.sh && chown -R node:node /app

USER node
WORKDIR /workspace

ENTRYPOINT ["/app/entrypoint.sh"]
