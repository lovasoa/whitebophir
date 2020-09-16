# WBO

## Полезные команды

lsof -t -i:8080

kill -9 $(lsof -t -i:8080)

sudo nodemon ./server/server.js