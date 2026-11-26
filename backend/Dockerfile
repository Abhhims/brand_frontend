# One image for the API, the workers and the migration step (different start commands).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY drizzle ./drizzle
USER node
EXPOSE 8020
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:8020/health/live || exit 1
CMD ["node", "dist/server.js"]
