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

# Install dependencies (node-pty will be compiled during install)
RUN pnpm install

# Copy source code
COPY . .

# Create non-root user for security
RUN useradd -m appuser

# Setup user directory with proper permissions
RUN mkdir -p /app/user \
  && chown -R appuser:appuser /app/user \
  && chmod -R 755 /app/user

RUN chown -R appuser:appuser /app \
  && chmod -R 755 /app

USER appuser

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3334/api/get-tree', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })" || exit 1

EXPOSE 3334

CMD ["node", "index.js"]
