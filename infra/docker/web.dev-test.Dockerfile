FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --chown=nextjs:nodejs standalone ./
COPY --chown=nextjs:nodejs static ./apps/web/.next/static
COPY --chown=nextjs:nodejs public ./apps/web/public
COPY --chown=nextjs:nodejs runtime-identity.json /app/runtime-identity.json
RUN mkdir -p /app/uploads && chown -R nextjs:nodejs /app/uploads

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "apps/web/server.js"]
