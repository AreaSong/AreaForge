FROM node:26-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS builder
ARG AREAFORGE_APP_VERSION
ARG AREAFORGE_GIT_COMMIT
ARG AREAFORGE_UX_SOURCE_FINGERPRINT_SCHEMA
ARG AREAFORGE_UX_SOURCE_HASH
ARG AREAFORGE_BUILD_ID
COPY . .
RUN AREAFORGE_APP_VERSION="$AREAFORGE_APP_VERSION" \
    AREAFORGE_GIT_COMMIT="$AREAFORGE_GIT_COMMIT" \
    AREAFORGE_UX_SOURCE_FINGERPRINT_SCHEMA="$AREAFORGE_UX_SOURCE_FINGERPRINT_SCHEMA" \
    AREAFORGE_UX_SOURCE_HASH="$AREAFORGE_UX_SOURCE_HASH" \
    AREAFORGE_BUILD_ID="$AREAFORGE_BUILD_ID" \
    pnpm exec tsx scripts/ops/generate-runtime-identity.ts /app/runtime-identity.json && \
    pnpm db:generate && pnpm --filter @areaforge/web build

FROM node:26-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/runtime-identity.json /app/runtime-identity.json
RUN mkdir -p /app/uploads && chown -R nextjs:nodejs /app/uploads
USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "apps/web/server.js"]
