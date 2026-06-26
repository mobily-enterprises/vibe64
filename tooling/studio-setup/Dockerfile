FROM node:22-bookworm

ARG BUN_VERSION=1.3.14
ARG PLAYWRIGHT_VERSION=1.60.0
ARG PNPM_VERSION=11.1.2
ARG YARN_VERSION=1.22.22

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    bubblewrap \
    curl \
    fd-find \
    file \
    git \
    gnupg \
    jq \
    less \
    lsof \
    mariadb-client \
    netcat-openbsd \
    openssh-client \
    postgresql-client \
    procps \
    psmisc \
    ripgrep \
    rsync \
    sqlite3 \
    tree \
    unzip \
    zip \
  && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
  && chmod a+r /etc/apt/keyrings/docker.asc \
  && . /etc/os-release \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
  && corepack prepare "yarn@${YARN_VERSION}" --activate

RUN npm install -g "bun@${BUN_VERSION}" @openai/codex "@playwright/test@${PLAYWRIGHT_VERSION}" \
  && playwright install --with-deps chromium \
  && node --version \
  && npm --version \
  && corepack --version \
  && corepack pnpm --version \
  && corepack yarn --version \
  && bun --version \
  && chmod -R 0777 /ms-playwright

WORKDIR /workspace
