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


#------------------------------------------
FROM node:20-bullseye

RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  openssl \
  && ln -s /usr/bin/python3 /usr/bin/python \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install
COPY . .

RUN useradd -m appuser

RUN chown -R appuser:appuser /usr/src/app \
    && chmod -R 700 /usr/src/app/server

USER appuser

RUN npm rebuild node-pty

EXPOSE 3333

CMD ["node", "server/index.js"]

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

# RUN npm rebuild node-pty

# RUN find /usr/src/app -type d ! -path "/usr/src/app/user" -exec chmod 111 {} \; \
#  && chmod 555 /usr/src/app/user

# EXPOSE 3333

# CMD ["node", "server/index.js"]
