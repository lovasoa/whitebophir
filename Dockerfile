FROM node:14-alpine

WORKDIR /opt/app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY . .

ENV PORT=80
EXPOSE 80

VOLUME /opt/app/server-data

CMD ["npm", "start"]
