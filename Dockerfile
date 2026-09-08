FROM node:24 AS build
LABEL org.opencontainers.image.source="https://github.com/lovasoa/whitebophir"
WORKDIR /opt/app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

# chainguard's secure-by-default node image is used
FROM cgr.dev/chainguard/node:latest AS run
WORKDIR /app
COPY --from=build --chown=node:node /opt/app /app
# bind to nonprivileged port
ENV PORT=8000
EXPOSE 8000
USER node
ENTRYPOINT ["node", "server/server.mjs"]
