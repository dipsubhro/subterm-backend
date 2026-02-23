FROM node:20-bullseye

# Install dependencies for node-pty and git for GitHub import
RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  openssl \
  git \
  && ln -s /usr/bin/python3 /usr/bin/python \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Enable corepack for pnpm
RUN corepack enable

WORKDIR /app

# Copy .npmrc first (contains node-linker=hoisted setting)
COPY .npmrc ./

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install

# Rebuild node-pty native module using node-gyp
RUN cd node_modules/node-pty && npx node-gyp rebuild

# Copy source code
COPY . .

# Create non-root user for security
RUN useradd -m appuser

# Override `df` so that the terminal only shows container-relevant mounts
# (overlay = container root, plus any explicit volume mounts like /workspace).
# Without a kernel-level disk quota the underlying numbers still reflect the
# host block device; StorageOpt on the gateway is needed to enforce a real cap.
RUN printf '#!/bin/bash\n/bin/df "$@" | awk \x27NR==1 || $NF=="/" || $NF=="/workspace" || $1=="overlay"\x27\n' \
    > /usr/local/bin/df \
  && chmod +x /usr/local/bin/df

# Setup workspace directory (mounted per-session by the gateway)
RUN mkdir -p /workspace \
  && chown appuser:appuser /workspace \
  && chmod 755 /workspace

# Setup app directory permissions
RUN chown -R appuser:appuser /app \
  && chmod -R 755 /app

USER appuser

# Environment defaults (overridden per-container by the gateway)
ENV PORT=3000 \
    WORKSPACE_PATH=/workspace

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/fs?path=/', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })" || exit 1

EXPOSE 3000

CMD ["node", "index.js"]
