# laravel

Laravel service — port 4350. Serves the Blade-rendered pages that fill
the "Blade Legacy Lab" slot in the host, plus a small JSON API surface.

## Run

Docker only (PHP/Composer are not installed in the default dev environment):

```bash
just laravel           # from playgrounds/stress-test
# or:
docker compose -f playgrounds/stress-test/docker-compose.yml up --build laravel
```

First boot scaffolds Laravel via `composer create-project` inside the
image and layers our custom slice on top (~3–6 minutes). Subsequent boots
use cached layers.

## Layout

The repo only carries the custom slice that overlays the scaffold:

```
services/laravel/
├── Dockerfile
├── README.md
└── overlay/
    ├── routes/web.php
    ├── app/Http/Controllers/
    │   ├── HomeController.php
    │   ├── HealthController.php
    │   └── TaskController.php
    └── resources/views/
        ├── layouts/app.blade.php
        ├── home.blade.php
        └── tasks/create.blade.php
```

Everything else comes from `laravel/laravel` at image build time.

## Endpoints

- `GET /` — Blade-rendered workflow queue + action buttons
- `GET /tasks/new` — Blade-rendered form
- `POST /tasks` — form submit with validation (redirects back with flash)
- `GET /api/health` — JSON health probe
