# Distribution

How the npm package is built and what gets published.

## Package Layout

`package.json` currently publishes only:

- `dist/`
- `skills/`

Source maps under `dist/**/*.map` are excluded from the published tarball.

Current package identity:

- name: `annotask`
- version: `0.1.1`
- type: `module`
- binary: `annotask`

## Build Artifacts

`pnpm build` produces these main outputs in `dist/`:

- `index.js` and `index.d.ts` - Vite plugin
- `server.js` and `server.d.ts` - server exports
- `standalone.js` and `standalone.d.ts` - standalone server entry
- `webpack.js` and `webpack.d.ts` - Webpack integration
- `webpack-loader.js` and `webpack-loader.d.ts` - Webpack loader
- `cli.js` - CLI binary with shebang
- `shell/` - prebuilt shell assets
- `vendor/` - pinned vendored browser dependencies

Published skill files:

- `skills/annotask-init/SKILL.md`
- `skills/annotask-apply/SKILL.md`

## Build Pipeline

```bash
pnpm build
```

Under the hood:

1. `pnpm build:shell`
2. `pnpm build:plugin`
3. `pnpm build:vendor`

The shell must be built first because the server serves `dist/shell/` directly.

## Vendored Assets

Annotask currently vendors browser-side dependencies into `dist/vendor/` via `scripts/copy-vendor.mjs`.

Those versions are pinned in `package.json` and the copy script is expected to fail loudly if upstream package layouts change.

## Skills Distribution

The package ships skill source in `skills/`.

Consumers install them with:

```bash
npx annotask init-skills
```

Behavior:

- the first target gets real files
- additional targets get symlinks back to the first copy
- built-in targets are `claude`, `agents`, and `copilot`

## MCP Config Distribution

The CLI can also write editor-side MCP config:

```bash
npx annotask init-mcp --editor=claude
```

Built-in editor targets:

- `claude`
- `cursor`
- `vscode`
- `windsurf`
- `all`

`init-mcp` merges with existing config instead of blindly replacing it.

## Pre-Publish Checklist

```bash
pnpm typecheck
pnpm test
pnpm build
npm pack --dry-run
```

Then verify:

- `package.json` version is correct
- `CHANGELOG.md` has the matching release entry
- `dist/` contains the expected build outputs
- `skills/` contains the bundled skill files

## Publish

```bash
npm publish --access public
```

If this is part of a formal release, also tag the release in git after the package version and changelog have been updated together.
