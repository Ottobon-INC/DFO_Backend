# --- Base Stage ---
FROM node:22-bookworm-slim AS base
# dumb-init ensures proper signal forwarding (fixes Windows STATUS_CONTROL_C_EXIT class issues in containers)
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./

# --- Dependencies Stage ---
FROM base AS dependencies
RUN npm install --legacy-peer-deps

# --- Build Stage ---
FROM dependencies AS build
COPY . .
RUN npm run build

# --- Production Stage ---
FROM node:22-bookworm-slim AS production
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Use dumb-init to properly handle signals
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/main"]
