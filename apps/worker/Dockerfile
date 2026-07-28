# Production worker: tsx + Prisma client against shared SQLite volume
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY apps/mcp-server/package.json ./apps/mcp-server/
COPY apps/web/prisma ./apps/web/prisma

RUN npm ci --workspace=worker --include-workspace-root

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 worker \
  && mkdir -p /app/data \
  && chown worker:nodejs /app/data

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY apps/mcp-server/package.json ./apps/mcp-server/
COPY apps/web/prisma ./apps/web/prisma
COPY apps/worker ./apps/worker

WORKDIR /app/apps/worker

USER worker

CMD ["npm", "start"]
