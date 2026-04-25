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
An official docker image for WBO is hosted on dockerhub as [`lovasoa/wbo`](https://hub.docker.com/r/lovasoa/wbo): [![WBO 1M docker pulls](https://img.shields.io/docker/pulls/lovasoa/wbo?style=flat)](https://hub.docker.com/repository/docker/lovasoa/wbo).

You can run the following bash command to launch WBO on port 5001, while persisting the boards outside of docker:

```bash
mkdir wbo-boards # Create a directory that will contain your whiteboards
chown -R 1000:1000 wbo-boards # Make this directory accessible to WBO
docker run -it --publish 5001:80 --volume "$(pwd)/wbo-boards:/opt/app/server-data" lovasoa/wbo:latest # run wbo
```

You can then access WBO at `http://localhost:5001`.

The official Docker image does not force an IP source. By default the application uses `WBO_IP_SOURCE=remoteAddress`. If you run the container behind a trusted proxy or CDN, set `-e WBO_IP_SOURCE=...` explicitly, for example `X-Forwarded-For`, `Forwarded`, or `CF-Connecting-IP`.

### Running the code without a container

Alternatively, you can run the code with [node.js](https://nodejs.org/) directly, without docker.

First, download the sources:

```
git clone https://github.com/lovasoa/whitebophir.git
cd whitebophir
```

Then [install node.js](https://nodejs.org/en/download/) (v22 or superior)
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

## Authentication

WBO supports authentication using [Json Web Tokens](https://jwt.io/introduction). Pass the token as a `token` query parameter, for example `http://myboard.com/boards/test?token={token}`.

The `AUTH_SECRET_KEY` variable in [`configuration.js`](./server/configuration.js) should be filled with the secret key for the JWT.

### Roles

WBO recognizes two privileged roles:

- `editor`: can modify accessible boards.
- `moderator`: can modify accessible boards and use the Clear tool.

Roles are declared in the JWT payload:

```json
{
  "iat": 1516239022,
  "exp": 1516298489,
  "roles": ["editor"]
}
```

Moderators have access to the Clear tool, which wipes all content from the board.

### Board Visibility / Access

If `AUTH_SECRET_KEY` is not set, boards are visible to anyone who knows the URL.

If `AUTH_SECRET_KEY` is set, opening a board requires a valid token. You can then restrict which board names a token may open by adding `:<boardName>` to a claim:

```json
{
  "roles": ["editor:board-a", "moderator:board-b", "reader:board-c"]
}
```

- `editor:<boardName>` allows editing that board.
- `moderator:<boardName>` allows moderating that board.
- `reader:<boardName>` allows opening that board without granting editor or moderator privileges.

For example, `http://myboard.com/boards/mySecretBoardName?token={token}` with:

```json
{
  "iat": 1516239022,
  "exp": 1516298489,
  "roles": ["moderator:mySecretBoardName"]
}
```

If a token contains any board-scoped claims, it can only open the boards named in those claims.

### Board Editability / Read-Only

Board visibility and board editability are separate.

- A writable board accepts writes from users who can access it.
- A read-only board can be opened by users who have access to it.
- On a read-only board, only `editor` and `moderator` claims may write.
- On instances without JWT authentication, a read-only board blocks all writes because there is no authenticated editor or moderator identity.

Read-only state is stored in the board JSON file itself under the reserved key `__wbo_meta__`:

```json
{
  "__wbo_meta__": {
    "readonly": true
  }
}
```

### How To Change Board Visibility

- Without JWT auth: visibility is controlled by sharing or not sharing the board URL.
- With JWT auth: visibility is controlled by the token you issue. Add or remove board-scoped claims to decide which boards a token may open.
- Use `editor` or `moderator` claims for users who should write.
- Use `reader:<boardName>` for users who should only view a read-only board.

### How To Change A Board Between Writable And Read-Only

1. Find the board file in `WBO_HISTORY_DIR`. The filename is `board-${encodeURIComponent(boardName)}.json`.
2. Add or update the `__wbo_meta__.readonly` flag in that file.
3. Reload the board after it is unloaded from memory, or restart the server, so the new state is picked up.
4. Remove the flag or set it to `false` to make the board writable.

## Configuration

When you start a WBO server, it loads its configuration from several environment variables.
You can see a list of these variables in [`configuration.js`](./server/configuration.js).
Some important environment variables are :

- `WBO_HISTORY_DIR` : configures the directory where the boards are saved. Defaults to `./server-data/`.
- `WBO_MAX_EMIT_COUNT` : the general socket write limit profile. Use compact entries such as `*:250/5s anonymous:125/5s`. Increase this if you want smoother drawings, at the expense of making denial-of-service bursts cheaper for clients. The default is `*:250/5s`.
- `WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP` : the constructive per-IP write limit profile. Use compact entries such as `*:40/10s anonymous:20/10s`.
- `WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP` : the destructive per-IP write limit profile. Use compact entries such as `*:190/60s anonymous:95/60s`.
- `WBO_IP_SOURCE` : which request attribute to trust for client IP based limits and logs. Supports `remoteAddress`, `X-Forwarded-For`, `Forwarded`, or a custom header such as `CF-Connecting-IP`. The default is `remoteAddress`.
- `AUTH_SECRET_KEY` : If you would like to authenticate your boards using jwt, this declares the secret key.

## Troubleshooting

If you experience an issue or want to propose a new feature in WBO, please [open a github issue](https://github.com/lovasoa/whitebophir/issues/new).

## Monitoring

If you are self-hosting a WBO instance, you may want to monitor its load,
the number of connected users, request latency, and board lifecycle events.

WBO now uses OpenTelemetry for metrics, logs, and traces on the server side.
Configure a standard OTLP exporter with the usual `OTEL_*` environment variables.

Example:

```sh
docker run \
  -e OTEL_SERVICE_NAME=whitebophir-server \
  -e OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
  lovasoa/wbo
```

Common settings:

- `OTEL_SERVICE_NAME`
- `OTEL_RESOURCE_ATTRIBUTES`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`
- `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS`

Socket connection replay is reported with `wbo.socket.connection_replay` and
`wbo.socket.connection_replay.gap`. The replay outcome attribute distinguishes
empty replays, sent replay batches, stale baselines, future baselines, and
internal errors.

Traces default to a 5% parent-based sample rate when no standard
`OTEL_TRACES_SAMPLER*` setting is provided. For short debugging sessions, force
full trace capture explicitly:

```sh
OTEL_TRACES_SAMPLER=parentbased_traceidratio \
OTEL_TRACES_SAMPLER_ARG=1.0 \
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
npm start
```

If no OTLP endpoint is configured, WBO still emits canonical server log lines to stdout/stderr but does not attempt remote export.

## Download SVG preview

To download a preview of a board in SVG format you can got to `/preview/{boardName}`, e.g. change https://wbo.ophir.dev/board/anonymous to https://wbo.ophir.dev/preview/anonymous. The renderer is not 100% faithful, but it's often good enough.
