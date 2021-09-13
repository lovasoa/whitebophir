# WBO

WBO is an online collaborative whiteboard that allows many users to draw simultaneously on a large virtual board.
The board is updated in real time for all connected users, and its state is always persisted. It can be used for many different purposes, including art, entertainment, design, teaching.

A demonstration server is available at [wbo.ophir.dev](https://wbo.ophir.dev)

## Screenshots

<table>
 <tr>
  <td> The <i><a href="https://wbo.ophir.dev/boards/anonymous">anonymous</a></i> board
  <td> <img width="300" src="https://user-images.githubusercontent.com/552629/59885574-06e02b80-93bc-11e9-9150-0670a1c5d4f3.png">
  <td> collaborative diagram editing
  <td> <img alt="Screenshot of WBO's user interface: architecture" width="300" src="https://user-images.githubusercontent.com/552629/59915054-07101380-941c-11e9-97c9-4980f50d302a.png" />
  
  <tr>
   <td> teaching math on <b>WBO</b>
   <td> <img alt="wbo teaching" width="300" src="https://user-images.githubusercontent.com/552629/59915737-a386e580-941d-11e9-81ff-db9e37f140db.png" />
   <td> drawing art
   <td> <img alt="kawai cats on WBO" width="300" src="https://user-images.githubusercontent.com/552629/120919822-dc2c3200-c6bb-11eb-94cd-57a4254fbe0a.png"/>
</table>

## Running your own instance of WBO

If you have your own web server, and want to run a private instance of WBO on it, you can. It should be very easy to get it running on your own server.

### Running the code in a container (safer)

If you use the [docker](https://www.docker.com/) containerization service, you can easily run WBO as a container. 
An official docker image for WBO is hosted on dockerhub as [`lovasoa/wbo`](https://hub.docker.com/r/lovasoa/wbo): [![WBO 1M docker pulls](https://img.shields.io/docker/pulls/lovasoa/wbo.svg)](https://hub.docker.com/repository/docker/lovasoa/wbo).

You can run the following bash command to launch WBO on port 5001, while persisting the boards outside of docker:

```bash
mkdir wbo-boards # Create a directory that will contain your whiteboards
chown -R 1000:1000 wbo-boards # Make this directory accessible to WBO
docker run -it --publish 5001:80 --volume "$(pwd)/wbo-boards:/opt/app/server-data" lovasoa/wbo:latest # run wbo
```

You can then access WBO at `http://localhost:5001`.

### Running the code without a container

Alternatively, you can run the code with [node.js](https://nodejs.org/) directly, without docker.

First, download the sources:
```
git clone https://github.com/lovasoa/whitebophir.git
cd whitebophir
```

Then [install node.js](https://nodejs.org/en/download/) (v10.0 or superior)
if you don't have it already, then install WBO's dependencies:

```
npm install --production
```

Finally, you can start the server:
```
PORT=5001 npm start
```

This will run WBO directly on your machine, on port 5001, without any isolation from the other services. You can also use an invokation like
```
PORT=5001 HOST=127.0.0.1 npm start
```
to make whitebophir only listen on the loopback device. This is useful if you want to put whitebophir behind a reverse proxy.

### Running WBO on a subfolder

By default, WBO launches its own web server and serves all of its content at the root of the server (on `/`).
If you want to make the server accessible with a different path like `https://your.domain.com/wbo/` you have to setup a reverse proxy.
See instructions on our Wiki about [how to setup a reverse proxy for WBO](https://github.com/lovasoa/whitebophir/wiki/Setup-behind-Reverse-Proxies).

## Translations

WBO is available in multiple languages. The translations are stored in [`server/translations.json`](./server/translations.json). 
If you feel like contributing to this collaborative project, you can [translate WBO into your own language](https://github.com/lovasoa/whitebophir/wiki/How-to-translate-WBO-into-your-own-language).

## Configuration

When you start a WBO server, it loads its configuration from several environment variables.
You can see a list of these variables in [`configuration.js`](./server/configuration.js).
Some important environment variables are :
 - `WBO_HISTORY_DIR` : configures the directory where the boards are saved. Defaults to `./server-data/`.
 - `WBO_MAX_EMIT_COUNT` : the maximum number of messages that a client can send per unit of time. Increase this value if you want smoother drawings, at the expense of being susceptible to denial of service attacks if your server does not have enough processing power. By default, the units of this quantity are messages per 4 seconds, and the default value is `192`.

## Troubleshooting

If you experience an issue or want to propose a new feature in WBO, please [open a github issue](https://github.com/lovasoa/whitebophir/issues/new).

## Monitoring

If you are self-hosting a WBO instance, you may want to monitor its load,
the number of connected users, and various other metrics.

You can start WBO with the `STATSD_URL` environment variable to send it to a statsd-compatible
metrics collection agent.

Example: `docker run -e STATSD_URL=udp://127.0.0.1:8125 lovasoa/wbo`.

 - If you use **prometheus**, you can collect the metrics with [statsd-exporter](https://hub.docker.com/r/prom/statsd-exporter).
 - If you use **datadog**, you can collect the metrics with [dogstatsd](https://docs.datadoghq.com/developers/dogstatsd).
