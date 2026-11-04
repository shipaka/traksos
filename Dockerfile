# ТракSOS: сервер + собранное веб-приложение в одном образе
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm install --workspaces --include-workspace-root=false
COPY server server
COPY web web
RUN npm -w web run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 WEB_ROOT=/app/web/dist
COPY package.json ./
COPY server/package.json server/
RUN npm install -w server --omit=dev && npm cache clean --force
COPY server server
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "--import", "tsx", "server/src/main.ts"]
