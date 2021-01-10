FROM node:14-alpine


WORKDIR /opt/app

RUN chown -R 1000:1000 /opt/app

USER 1000:1000

COPY package.json package-lock.json ./
RUN npm ci --production
COPY . .

ENV PORT=8080
EXPOSE 8080

VOLUME /opt/app/server-data

CMD ["npm", "start"]
