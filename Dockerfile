# FROM node:20

# WORKDIR /usr/src/app

# RUN apk add --no-cache \
#   python3 \
#   make \
#   g++ \
#   linux-headers && \
#   ln -sf python3 /usr/bin/python

# COPY package*.json ./

# RUN npm install

# COPY . .

# EXPOSE 3333

# CMD [ "node", "server/index.js" ]


#---------------most used---------------------------
# FROM node:20-bullseye

# RUN apt-get update && apt-get install -y \
#   python3 \
#   make \
#   g++ \
#   openssl \
#   && ln -s /usr/bin/python3 /usr/bin/python \
#   && apt-get clean \
#   && rm -rf /var/lib/apt/lists/*

# WORKDIR /usr/src/app

# COPY package*.json ./
# RUN npm install
# COPY . .

# RUN useradd -m appuser

# RUN chown -R appuser:appuser /usr/src/app \
#     && chmod -R 700 /usr/src/app/server

# USER appuser

# RUN npm rebuild node-pty

# EXPOSE 3333

# CMD ["node", "server/index.js"]

#------------------------------------
  
# FROM node:20-bullseye AS client

# WORKDIR /app/client

# COPY client/package*.json ./
# RUN npm install

# COPY client/ ./
# RUN npm run build


# FROM node:20-bullseye

# RUN apt-get update && apt-get install -y \
#   python3 \
#   make \
#   g++ \
#   && ln -s /usr/bin/python3 /usr/bin/python \
#   && apt-get clean \
#   && rm -rf /var/lib/apt/lists/*

# WORKDIR /usr/src/app

# COPY package*.json ./
# RUN npm install

# COPY . .

# COPY --from=client /app/client/dist ./public


# RUN npm rebuild node-pty


# EXPOSE 3333


# CMD ["node", "server/index.js"]

#------------------------------------
FROM node:20-bullseye

RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  openssl \
  && ln -s /usr/bin/python3 /usr/bin/python \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Enable corepack to use pnpm
RUN corepack enable

WORKDIR /usr/src/app

# Copy server package.json to root of container app to install dependencies
COPY server/package.json ./
# COPY server/pnpm-lock.yaml ./ # If you have a lockfile, copy it too. Assuming we might generate one or just install.
# Since we just switched to pnpm, we might not have committed the lockfile yet, but pnpm install will generate it.

RUN pnpm install

COPY . .

RUN useradd -m appuser

RUN mkdir -p /usr/src/app/server/user \
  && chown -R appuser:appuser /usr/src/app/server/user \
  && chmod -R 755 /usr/src/app/server/user

RUN chown -R appuser:appuser /usr/src/app \
  && chmod -R 755 /usr/src/app/server

USER appuser

RUN pnpm rebuild node-pty

EXPOSE 3333

# Change working directory to server so dotenv finds .env (if present) and paths are relative to server if needed
WORKDIR /usr/src/app/server
CMD ["node", "index.js"]
