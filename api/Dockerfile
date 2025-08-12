# Multi-stage Dockerfile for the API
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package.json
COPY tsconfig*.json ./
COPY nest-cli.json ./
COPY src ./src
RUN corepack enable && corepack prepare pnpm@8.15.4 --activate && pnpm install && pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
EXPOSE 4000
CMD ["node", "dist/main.js"]
