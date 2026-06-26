ARG VIBE64_BASE_IMAGE=vibe64-base-toolchain:0.1.1
ARG DEBIAN_FRONTEND=noninteractive

FROM composer:2 AS composer

FROM ${VIBE64_BASE_IMAGE}
ARG DEBIAN_FRONTEND=noninteractive

ENV COMPOSER_ALLOW_SUPERUSER=1
ENV COMPOSER_HOME=/opt/composer
ENV PATH="${COMPOSER_HOME}/vendor/bin:${PATH}"

COPY --from=composer /usr/bin/composer /usr/local/bin/composer

RUN mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://packages.sury.org/php/apt.gpg -o /etc/apt/keyrings/sury-php.gpg \
  && . /etc/os-release \
  && echo "deb [signed-by=/etc/apt/keyrings/sury-php.gpg] https://packages.sury.org/php/ ${VERSION_CODENAME} main" \
    > /etc/apt/sources.list.d/sury-php.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    libcap2-bin \
    php8.4-bcmath \
    php8.4-cli \
    php8.4-curl \
    php8.4-intl \
    php8.4-mbstring \
    php8.4-mysql \
    php8.4-pgsql \
    php8.4-sqlite3 \
    php8.4-xml \
    php8.4-zip \
    unzip \
  && rm -rf /var/lib/apt/lists/* \
  && update-alternatives --install /usr/bin/php php /usr/bin/php8.4 84 \
  && update-alternatives --set php /usr/bin/php8.4 \
  && mkdir -p "${COMPOSER_HOME}" \
  && chmod -R 0777 "${COMPOSER_HOME}" \
  && composer global require laravel/installer \
  && ln -sf "${COMPOSER_HOME}/vendor/bin/laravel" /usr/local/bin/laravel \
  && bash -lc "php --version" \
  && bash -lc "composer --version" \
  && bash -lc "laravel --version"

WORKDIR /workspace
