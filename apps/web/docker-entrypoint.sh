#!/bin/sh
set -e

mkdir -p /app/data/logs /app/data/illustrations

echo "[web] applying Prisma schema..."
prisma db push --schema=/app/apps/web/prisma/schema.prisma --skip-generate

echo "[web] seeding database..."
tsx /app/apps/web/prisma/seed.ts

echo "[web] starting Next.js..."
exec node /app/apps/web/server.js
