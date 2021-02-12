FROM node:14-alpine

WORKDIR /opt/app

COPY package.json package-lock.json ./
RUN npm ci --production
COPY . .

ENV PORT=8080
EXPOSE 8080

VOLUME /opt/app/server-data

CMD ["npm", "start"]
