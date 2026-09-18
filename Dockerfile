# ==========================================
# Stage 1: Base Environment
# ==========================================
FROM node:22-bookworm-slim AS base

# Install dumb-init for proper signal handling and ca-certificates for secure HTTPS
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Disable heavy postinstall binary downloads in container builds
ENV REDISMS_DISABLE_POSTINSTALL=1
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# ==========================================
# Stage 2: Production Dependencies (clean)
# Installs ONLY production deps from scratch.
# Avoids npm prune misidentifying packages
# marked "dev" in lock file.
# ==========================================
FROM base AS prod-deps

COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# ==========================================
# Stage 3: Build (all deps + TypeScript)
# ==========================================
FROM base AS build

COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy all source code
COPY . .

# Compile TypeScript to JavaScript in /app/dist
RUN npm run build

# ==========================================
# Stage 4: Production Runner
# ==========================================
FROM node:22-bookworm-slim AS production

# Install dumb-init, ca-certificates, and chromium for headless PDF generation
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    ca-certificates \
    chromium \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy clean production node_modules (no prune needed — installed clean)
COPY --from=prod-deps /app/node_modules ./node_modules
# Copy compiled output from build stage
COPY --from=build /app/dist ./dist
# Copy package.json for runtime metadata
COPY --from=build /app/package.json ./package.json

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Set non-root user for security
USER node

# Expose backend port
EXPOSE 3000

# Container Healthcheck targeting NestJS /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Use dumb-init to handle SIGINT/SIGTERM properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Run the compiled application entrypoint
CMD ["node", "dist/src/main"]
