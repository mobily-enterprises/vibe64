ARG AI_STUDIO_BASE_IMAGE=ai-studio-base-toolchain:0.1.0

FROM ${AI_STUDIO_BASE_IMAGE}

RUN apt-get update \
  && apt-get install -y --no-install-recommends mariadb-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
