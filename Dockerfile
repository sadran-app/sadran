# Single-service image: builds the web app and serves it + the API from one server.
FROM node:20-slim

WORKDIR /app

# OpenSSL is required by Prisma's query engine.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install dependencies (root + web) first for better layer caching.
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY web/package.json web/package-lock.json ./web/
RUN npm install --prefix web --no-audit --no-fund

# Copy the rest and build.
COPY . .
RUN npm --prefix web run build && npx prisma generate

# Set production AFTER install/build so devDependencies (vite, tsx, prisma CLI)
# are available for the build above; they remain installed for runtime.
ENV NODE_ENV=production
EXPOSE 3001

# Render injects its own PORT env var; the server binds to it (falls back to 3001).
# `start` runs `prisma migrate deploy` then boots the server.
CMD ["npm", "run", "start"]
