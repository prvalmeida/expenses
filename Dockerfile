# Multi-stage Dockerfile for building and running the Next.js app
FROM node:22-alpine AS builder
WORKDIR /app
ENV NODE_ENV=production

# Install dependencies (dev deps included — needed to build).
# npm ci installs the exact locked tree and fails on package-lock drift.
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Copy sources and build. Secrets are injected at runtime, never baked in.
COPY . ./
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as an unprivileged user
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# Standalone output bundles only the traced runtime deps + server.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
