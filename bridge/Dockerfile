FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY src/domain.ts ./src/domain.ts
COPY bridge ./bridge
RUN ./node_modules/.bin/tsc -p bridge/tsconfig.node.json && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/bridge-dist ./bridge-dist
COPY package.json ./package.json
USER node
EXPOSE 8080
CMD ["node", "bridge-dist/bridge/container.js"]
