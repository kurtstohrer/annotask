# fastapi

FastAPI service — port 4320. Feeds `mfe-vue-data-lab`.

## Run

```bash
cd playgrounds/stress-test/services/fastapi
pip install -r requirements.txt
uvicorn main:app --port 4320 --reload
```

Or from the repo root:

```bash
pnpm dev:stress-fastapi
```

## Endpoints

- `GET /api/health` — service health + version probe
- `GET /docs` — OpenAPI Swagger UI
- `GET /openapi.json` — raw OpenAPI document

Schema-heavy domain endpoints land alongside the rest of the Vue data-lab
stress surface.
