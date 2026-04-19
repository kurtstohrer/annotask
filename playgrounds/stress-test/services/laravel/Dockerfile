# Scaffolds a fresh Laravel project inside the image, then overlays our
# custom routes/views/controllers on top. The repo only carries the
# custom slice — the ~150-file Laravel skeleton lives inside the container.

FROM composer:2 AS scaffold
WORKDIR /build
RUN composer create-project --prefer-dist --no-interaction --no-dev laravel/laravel . \
    && composer require --no-interaction --no-dev laravel/tinker >/dev/null 2>&1 || true \
    && rm -f .env \
    && cp .env.example .env

FROM php:8.4-cli
RUN apt-get update && apt-get install -y --no-install-recommends \
    libzip-dev libpng-dev libonig-dev libxml2-dev unzip git \
    && docker-php-ext-install pdo_mysql mbstring zip exif pcntl bcmath gd \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=scaffold /build /app

# Overlay our custom slice. Files under /overlay mirror the Laravel app layout.
COPY overlay /overlay
RUN cp -R /overlay/. /app/ && rm -rf /overlay \
    && php artisan key:generate --force \
    && chmod -R 777 storage bootstrap/cache

ENV PORT=4350
EXPOSE 4350

CMD ["sh", "-c", "php artisan serve --host=0.0.0.0 --port=${PORT}"]
