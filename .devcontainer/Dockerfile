FROM mcr.microsoft.com/devcontainers/javascript-node:1-24-bookworm

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
