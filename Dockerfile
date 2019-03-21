FROM node:10-alpine

WORKDIR /opt/app
COPY . /opt/app
ENV PORT=80
VOLUME /opt/app/server-data

RUN touch /usr/bin/start.sh # this is the script which will run on start

RUN echo 'npm install --production' >> /usr/bin/start.sh
RUN echo 'npx forever --minUptime 7000 --spinSleepTime 2000 -o out.log -e err.log /opt/app/server/server.js' >> /usr/bin/start.sh

CMD ["/bin/sh","/usr/bin/start.sh"]
