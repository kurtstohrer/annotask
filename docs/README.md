# Annotask Documentation

The root [`README.md`](../README.md) is the product overview. The docs in this folder go deeper into setup, APIs, architecture, and contributor workflow.

## User Docs

- [setup.md](setup.md) - install, configure Vite or Webpack, connect agents, and verify the shell
- [cli.md](cli.md) - every `annotask` command and flag
- [api.md](api.md) - HTTP endpoints, WebSocket events, MCP tools, error shapes, and task lifecycle
- [skills.md](skills.md) - `/annotask-init` and `/annotask-apply`
- [component-discovery.md](component-discovery.md) - how component scanning works and how it surfaces in the shell

## Contributor Docs

- [architecture.md](architecture.md) - plugin, bridge, server, shell, scanners, and persistence
- [development.md](development.md) - local workflow, scripts, testing, playgrounds, and project structure
- [distribution.md](distribution.md) - package contents, build artifacts, and publishing notes
- [REVIEWING.md](REVIEWING.md) - PR review checklist and codebase invariants

## Related Files

- [`../SETUP.md`](../SETUP.md) - short setup guide
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) - contributor overview and release process
- in-app Help overlay - product documentation embedded in the shell UI
