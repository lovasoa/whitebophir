FROM node:12-alpine

COPY . /opt/app
WORKDIR /opt/app
RUN npm install --production

ENV PORT=80
EXPOSE 80

VOLUME /opt/app/server-data

CMD ["npm", "start"]
