ARG NODE_RUNTIME_VERSION=24.22.1
FROM node:${NODE_RUNTIME_VERSION}-trixie AS node-runtime
FROM mcr.microsoft.com/devcontainers/javascript-node:5.2.3-24-trixie
ARG NODE_RUNTIME_VERSION

ENV NODE_VERSION=${NODE_RUNTIME_VERSION}

# Devcontainer images can lag Node security releases.
COPY --from=node-runtime /usr/local/ /usr/local/

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        less \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp/playwright-bootstrap
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts \
    && npx playwright install --with-deps chromium \
    && rm -rf /tmp/playwright-bootstrap /root/.npm \
    && chmod -R 755 /ms-playwright

USER node
WORKDIR /workspace/whitebophir
