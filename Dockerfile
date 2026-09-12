# syntax=docker/dockerfile:1

# 公共依赖层：源码之外的全部依赖在此锁定
FROM node:20-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 一次性验收：构建 + Vitest 单元测试 + Playwright 端到端测试
FROM base AS verify
RUN npx playwright install --with-deps chromium
COPY . .
CMD ["npm", "run", "verify"]

# 静态资源构建
FROM base AS build
COPY . .
RUN npm run build

# Web 发布：nginx 托管静态资源，容器内监听 80
FROM nginx:1.27-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
