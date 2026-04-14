FROM node:24-alpine

ARG VCS_SOURCE=unknown
ARG GIT_REV=unknown

LABEL org.opencontainers.image.source="${VCS_SOURCE}"
LABEL org.opencontainers.image.revision="${GIT_REV}"

WORKDIR /opt/app

RUN chown -R 1000:1000 /opt/app

# Allow node to bind to port 80
RUN apk update && apk add libcap
RUN setcap CAP_NET_BIND_SERVICE=+eip /usr/local/bin/node

USER 1000:1000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=1000:1000 . .

ENV PORT=80
EXPOSE 80

VOLUME /opt/app/server-data

CMD ["/usr/local/bin/node", "server/server.js"]
