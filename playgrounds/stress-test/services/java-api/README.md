# java-api

Spring Boot service — port 4310. Feeds `mfe-react-workflows`.

## Run

Docker only (Java/Maven are not installed in the default dev environment):

```bash
just java              # from playgrounds/stress-test
# or:
docker compose -f playgrounds/stress-test/docker-compose.yml up --build java-api
```

First boot builds Maven deps and the Spring Boot fat jar (~3–5 minutes).
Subsequent starts use cached layers.

## Endpoints

- `GET /api/health` — service health + version probe
- `GET /api/workflows?status=pending|in_progress|review` — seeded workflow list
- `GET /api/workflows/:id` — single workflow detail
- `POST /api/workflows/:id/transitions?to=<status>` — transition action
- `GET /api/docs` — Swagger UI
- `GET /api/openapi` — raw OpenAPI document
