FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/bridge/package.json ./apps/bridge/package.json
COPY packages/domain/package.json ./packages/domain/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@saldo/bridge..."
COPY packages/domain/src ./packages/domain/src
COPY apps/bridge/container.ts apps/bridge/crypto.ts apps/bridge/inference.ts apps/bridge/tsconfig.json apps/bridge/vite.config.ts ./apps/bridge/
RUN pnpm --filter @saldo/bridge run pack

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/bridge/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/container.mjs"]
