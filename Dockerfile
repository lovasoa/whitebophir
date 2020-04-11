FROM node:10-alpine

COPY . /opt/app
WORKDIR /opt/app
RUN npm install --production

ENV PORT=80
EXPOSE 80

VOLUME /opt/app/server-data

CMD ["/usr/local/bin/node", "/opt/app/server/server.js"]
