FROM node:20-bullseye

# Install dependencies for node-pty
RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  openssl \
  && ln -s /usr/bin/python3 /usr/bin/python \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Enable corepack for pnpm
RUN corepack enable

WORKDIR /app

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

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

# Rebuild node-pty for the container environment
RUN pnpm rebuild node-pty

EXPOSE 3334

CMD ["node", "index.js"]
