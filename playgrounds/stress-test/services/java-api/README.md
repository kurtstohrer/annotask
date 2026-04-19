# java-api

Spring Boot service — port 4310. Feeds `mfe-react-workflows`.

## Status

Stub. Directory reserved. Real Spring Boot implementation lands in a
follow-up pass (workflow simulator, bulk review actions, audit trails,
OpenAPI endpoints). See `plan/annotask-stress-playground-plan.md`.

## Local toolchain

Java is not installed in the default dev environment. Run via Docker:

```bash
pnpm stress-test:up java-api
```

## Planned endpoints

- `GET /api/health`
- `GET /api/workflows?status=…&page=…`
- `POST /api/workflows/:id/transitions`
- `GET /api/openapi.json`
