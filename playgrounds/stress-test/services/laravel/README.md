# laravel

Laravel service — port 4350. Serves Blade-rendered pages (the
`mfe-blade-legacy-lab` slot) plus a JSON API surface.

## Status

Stub. Directory reserved. Real Laravel project lands in a follow-up pass
(Blade templates under `resources/views/`, validation-backed form POSTs,
admin-only JSON enrichments). See `plan/annotask-stress-playground-plan.md`.

While this service is not running, the Blade MFE slot falls back to a
Vite-served placeholder at `apps/mfe-blade-legacy-lab` so the skeleton
stays testable.

## Local toolchain

PHP/Composer are not installed in the default dev environment. Run via
Docker:

```bash
pnpm stress-test:up laravel
```

## Planned endpoints

- `GET /` — Blade-rendered legacy form index
- `POST /tasks` — validation-heavy form submit
- `GET /api/health` — service health probe
- `GET /api/admin/tasks.json` — admin JSON enrichments
