# Annotask Documentation

The root `README.md` is the best product-level overview. The docs in this folder go deeper into the current API, CLI, setup, and internal architecture.

## For users

- **[Setup](setup.md)** — Install Annotask, wire it into Vite or Webpack, connect an agent via MCP or skills, and verify the shell.
- **[API Reference](api.md)** — HTTP endpoints, WebSocket events, task lifecycle, and the full MCP tool surface.
- **[CLI Reference](cli.md)** — Every `annotask` command, including design-spec, components, data, and API-schema helpers.
- **[Skills](skills.md)** — Bundled `/annotask-init` and `/annotask-apply` skills and how they map to the current workflow.
- **[Component discovery](component-discovery.md)** — How Annotask scans libraries, builds component catalogs, and surfaces in-repo examples.

## For contributors

- **[Architecture](architecture.md)** — Plugin, shell, bridge, server, data scanners, MCP server, and task flow.
- **[Development](development.md)** — Setup, build, test, project structure, and implementation conventions.
- **[Distribution](distribution.md)** — npm packaging, skill distribution strategy, and release notes.

## In-app docs

Annotask also ships a Help overlay inside the shell. It mirrors the current workflow and is intended to stay in sync with the docs in this folder.
