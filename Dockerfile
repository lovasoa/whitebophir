FROM node:24 AS build
LABEL org.opencontainers.image.source="https://github.com/lovasoa/whitebophir"
WORKDIR /opt/app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .

# chainguard's secure-by-default node image is used
FROM cgr.dev/chainguard/node:latest AS run
WORKDIR /app
COPY --from=build --chown=node:node /opt/app /app
ENV PORT=80
EXPOSE 80
USER node
ENTRYPOINT ["node", "server/server.mjs"]
