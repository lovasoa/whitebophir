FROM node:20-alpine3.17

WORKDIR /opt/app

RUN chown -R 1000:1000 /opt/app

# Allow node to bind to port 80
RUN apk update && apk add libcap
RUN setcap CAP_NET_BIND_SERVICE=+eip /usr/local/bin/node

USER 1000:1000

COPY package.json package-lock.json ./
RUN npm ci --production
COPY --chown=1000:1000 . .

ENV PORT=80
EXPOSE 80

VOLUME /opt/app/server-data

CMD ["/usr/local/bin/node", "server/server.js"]
