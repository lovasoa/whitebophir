# WBO

WBO is an online collaborative whiteboard that allows many users to draw simultaneously on a large virtual board.
The board is updated in real time for all connected users, and its state is always persisted. It can be used for many different purposes, including art, entertainment, design, teaching.

A demonstration server is available at https://wbo.openode.io.

## Screenshots

### The [*anonymous*](https://wbo.openode.io/boards/anonymous) board
<img width="916" alt="WBO anonymous board" src="https://user-images.githubusercontent.com/552629/59885574-06e02b80-93bc-11e9-9150-0670a1c5d4f3.png">

### Used for teaching
<img width="960" alt="image" src="https://user-images.githubusercontent.com/552629/59915737-a386e580-941d-11e9-81ff-db9e37f140db.png">

### Used for collaborative diagram editing
![Screenshot of WBO's user interface: architecture](https://user-images.githubusercontent.com/552629/59915054-07101380-941c-11e9-97c9-4980f50d302a.png)


### Used for drawing art
<img width="1522" alt="WBO angel" src="https://user-images.githubusercontent.com/552629/59914139-08404100-941a-11e9-9c29-bd2569fe4730.png">


## Running your own instance of WBO

If you have your own web server, and want to run a private instance of WBO on it, you can.

#### Clone the repository

```
git clone git@github.com:lovasoa/whitebophir.git
cd whitebophir
```

### Running the code in a container (safer)
[![docker image status](https://img.shields.io/docker/image-size/lovasoa/wbo)](https://hub.docker.com/repository/docker/lovasoa/wbo)

You can run the [official docker image hosted on dockerhub](https://hub.docker.com/repository/docker/lovasoa/wbo) or build your own very easily using [docker compose](https://docs.docker.com/compose/).

#### Choose where to persist the data

At the moment, WBO has a very simple persistance model: it saves each whiteboard as a separate json file in a directory.

You can edit `docker-compose.yml` to choose where you want to persist the data :

```yml
    volumes:
      - ./server-data:/opt/app/server-data
```

Here, I chose to persist the data in `./server-data` (inside the directory where I cloned the repo).

#### Start the service

```
sudo docker-compose up
```

This will start wbo on port 80. (You can change the port number in `docker-compose.yaml` if you want).


### Running the code without a container

Alternatively, you can run the code with [node](https://nodejs.org/) directly, without docker : 

```
npm install
npm start
```

If you do that, the code is running directly on your machine, without any isolation from the other services. Make sure you do not run another sensitive service on the same host.

## Troubleshooting

If you experience an issue or want to propose a new feature in WBO, please [open a github issue](https://github.com/lovasoa/whitebophir/issues/new).
