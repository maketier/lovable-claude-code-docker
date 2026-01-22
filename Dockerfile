FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# App directory
WORKDIR /app

# Install deps first (better caching)
COPY package.json /app/package.json
RUN npm install --production && npm cache clean --force

# Copy runtime files
COPY generator.js /app/generator.js
COPY entrypoint.sh /app/entrypoint.sh

# Copy templates INSIDE /app and give node ownership
# (avoids root-level /templates ambiguity and permission surprises)
COPY --chown=node:node templates /app/templates

# Prepare workspace and permissions
RUN chmod +x /app/entrypoint.sh \
  && mkdir -p /workspace \
  && chown -R node:node /app /workspace

# Make templates path explicit for generator.js
ENV TEMPLATES_DIR=/app/templates

USER node
WORKDIR /workspace

ENTRYPOINT ["/app/entrypoint.sh"]
