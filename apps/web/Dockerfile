# Skeleton Dockerfile — polished in Task 10
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY apps/web/package.json ./apps/web/
RUN npm install --workspace=web

COPY apps/web ./apps/web

WORKDIR /app/apps/web

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0", "-p", "3000"]
