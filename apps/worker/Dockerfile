# Skeleton Dockerfile — polished in Task 10
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/prisma ./apps/web/prisma
RUN npm install --workspace=worker

COPY apps/worker ./apps/worker

WORKDIR /app/apps/worker

CMD ["npm", "start"]
