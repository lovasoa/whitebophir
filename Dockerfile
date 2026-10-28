FROM node:24.22.1-alpine3.24 AS build

WORKDIR /opt/app
RUN chown -R 1000:1000 /opt/app
USER 1000:1000

COPY --chown=1000:1000 package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=1000:1000 . .

FROM node:24.22.1-alpine3.24 AS run

LABEL org.opencontainers.image.source="https://github.com/lovasoa/whitebophir"

WORKDIR /opt/app

# Allow node to bind to port 80
RUN chown -R 1000:1000 /opt/app \
    && apk add --no-cache libcap \
    && setcap CAP_NET_BIND_SERVICE=+eip /usr/local/bin/node

COPY --from=build --chown=1000:1000 /opt/app /opt/app

ENV PORT=80
EXPOSE 80

VOLUME /opt/app/server-data

USER 1000:1000

CMD ["/usr/local/bin/node", "server/server.mjs"]
