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

# Copy package manifests first for optimal Docker layer caching
COPY package*.json ./

# ==========================================
# Stage 2: Dependencies (Build & Prod)
# ==========================================
FROM base AS dependencies

# Install all dependencies including devDependencies for build
RUN npm install --legacy-peer-deps

# ==========================================
# Stage 3: Build
# ==========================================
FROM dependencies AS build

# Copy all source code
COPY . .

# Compile TypeScript to JavaScript in /app/dist
RUN npm run build

# Prune devDependencies to keep image size small
RUN npm prune --production --legacy-peer-deps

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

# Copy production node_modules from dependencies stage
COPY --from=build /app/node_modules ./node_modules
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
