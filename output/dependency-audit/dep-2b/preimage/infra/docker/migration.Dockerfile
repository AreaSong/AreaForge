# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS runner

ARG PRISMA_VERSION=7.8.0
ARG DOTENV_VERSION=17.4.2
ENV NODE_ENV=production
WORKDIR /app

COPY prisma.config.ts ./
COPY prisma ./prisma

RUN --mount=type=cache,target=/root/.npm \
  npm install --no-audit --no-fund --fetch-retries=5 --fetch-timeout=600000 --fetch-retry-maxtimeout=120000 "prisma@${PRISMA_VERSION}" "dotenv@${DOTENV_VERSION}"

CMD ["npx", "prisma", "migrate", "deploy"]
