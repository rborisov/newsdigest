# Multi-stage production image for the Next.js portal
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY apps/mcp-server/package.json ./apps/mcp-server/

RUN npm ci --workspace=web --include-workspace-root

FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY apps/mcp-server/package.json ./apps/mcp-server/
COPY apps/web ./apps/web

ENV NEXT_TELEMETRY_DISABLED=1
# Prisma generate needs a datasource URL at build time; no DB file is created.
ENV DATABASE_URL=file:./build.db

RUN npx prisma generate --schema=apps/web/prisma/schema.prisma
RUN npm run build --workspace=web

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && npm install -g prisma@6.19.0 tsx@4.20.6 \
  && mkdir -p /app/data \
  && chown nextjs:nodejs /app/data

COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/prisma ./apps/web/prisma
COPY apps/web/docker-entrypoint.sh /app/docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh \
  && chown -R nextjs:nodejs /app

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
