ARG VIBE64_BASE_IMAGE=vibe64-base-toolchain:0.1.1

FROM ${VIBE64_BASE_IMAGE}

RUN apt-get update \
  && apt-get install -y --no-install-recommends mariadb-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
