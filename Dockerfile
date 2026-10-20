# Notex as one image: the built web app plus the server that serves it (D6,
# D28). Used by deploy/compose.yaml on the home server.
#
#   docker build --build-arg GIT_COMMIT=$(git rev-parse HEAD) -t notex-app .

# 1. Build the web app. Dev dependencies are needed here (Vite, TypeScript).
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --include=dev
COPY web/ ./
# There is no .git inside the image, so the commit comes in from outside;
# the page compares it with the server's to offer a reload after a deploy.
ARG GIT_COMMIT=""
ENV GIT_COMMIT=$GIT_COMMIT
RUN npm run build

# 2. The server, with production dependencies only.
FROM node:22-slim
ENV NODE_ENV=production PORT=8000
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/ ./
COPY --from=web /app/web/dist /app/web/dist
ARG GIT_COMMIT=""
ENV GIT_COMMIT=$GIT_COMMIT
USER node
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:8000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
# The schema is idempotent, so it runs on every start, exactly as on Render.
CMD ["sh", "-c", "node db/migrate.js && exec node src/index.js"]
