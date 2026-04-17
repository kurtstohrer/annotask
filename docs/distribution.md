# Distribution

How to publish the npm package and distribute the Claude Code skills.

## npm package

### What gets published

The `files` field in `package.json` limits the published package to `dist/` and `skills/`:

```
dist/
├── index.js            # Vite plugin (ESM)
├── index.d.ts          # Vite plugin types
├── server.js           # Server API (ESM)
├── server.d.ts         # Server types
├── standalone.js       # Standalone HTTP server
├── webpack.js          # Webpack plugin (ESM)
├── webpack.d.ts        # Webpack plugin types
├── webpack-loader.js   # Webpack SFC transform loader
├── cli.js              # CLI binary (ESM, with shebang)
├── *.js.map            # Source maps
└── shell/              # Pre-built shell UI (served as static files)
    ├── index.html
    └── assets/

skills/
├── annotask-apply/SKILL.md
└── annotask-init/SKILL.md
```

### Package identity

```json
{
  "name": "annotask",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./webpack": {
      "types": "./dist/webpack.d.ts",
      "import": "./dist/webpack.js"
    },
    "./server": {
      "types": "./dist/server.d.ts",
      "import": "./dist/server.js"
    }
  },
  "bin": {
    "annotask": "./dist/cli.js"
  },
  "peerDependencies": {
    "vite": ">=4.0.0",
    "webpack": ">=5.0.0"
  },
  "peerDependenciesMeta": {
    "vite": { "optional": true },
    "webpack": { "optional": true }
  }
}
```

Users import the plugin:
```ts
import { annotask } from 'annotask'
```

And get the CLI binary:
```bash
npx annotask watch
```

### Publishing checklist

1. **Build everything** — the shell must be pre-built before the plugin:
   ```bash
   pnpm build    # runs build:shell then build:plugin
   ```

2. **Verify dist/** — check that all expected files are present:
   ```bash
   ls dist/
   ls dist/shell/
   ```

3. **Test the package locally** — use `npm pack` to preview what gets published:
   ```bash
   npm pack --dry-run
   ```

4. **Bump version** — update `version` in `package.json`.

5. **Publish**:
   ```bash
   npm publish --access public
   ```
   The `@annotask` scope needs to be public for first publish.

### npm publish setup

```bash
npm login
npm publish
```

If a scoped package is needed later (e.g. `@annotask/cli`), create the org first with `npm org create annotask`.

### Future: separate CLI package

Right now the CLI is bundled inside `annotask`. If the CLI grows or needs to be used without the Vite plugin, consider splitting it:

```
annotask   # Plugin only
@annotask/cli           # CLI only (annotask command)
```

This would use pnpm workspaces with a `packages/` directory. Not needed yet at this stage.

---

## AI agent skills

### How it works

Skills (SKILL.md files) are shipped in the `skills/` directory of the npm package. Users install them into their project with the CLI:

```bash
npx annotask init-skills
```

This copies skills to `.claude/skills/` (real files) and symlinks them into `.agents/skills/` by default. Users can target specific agents:

```bash
npx annotask init-skills --target=claude          # Claude Code only
npx annotask init-skills --target=copilot          # Copilot only
npx annotask init-skills --target=claude,agents,copilot  # All three
```

**Built-in targets:** `claude` (`.claude/skills/`), `agents` (`.agents/skills/`), `copilot` (`.copilot/skills/`). Custom paths also work: `--target=.my-tool/skills`.

The first target always gets real files. Additional targets get directory symlinks pointing back to the first — no file duplication.

### What ships in the npm package

```json
{
  "files": ["dist", "skills"]
}
```

```
skills/
├── annotask-apply/SKILL.md
└── annotask-init/SKILL.md
```

The CLI resolves these from its own package location (`dist/cli.js` → `../skills/`).

### Maintaining skills

The source of truth for skills is `.claude/skills/` in the repo. When skills change:

1. Edit the SKILL.md files in `.claude/skills/`
2. Copy to `skills/` at the package root (these are what get published)
3. Rebuild the CLI (`pnpm build:plugin`)

Consider adding a build step to automate the copy:

```json
{
  "scripts": {
    "build": "pnpm build:shell && pnpm sync-skills && pnpm build:plugin",
    "sync-skills": "cp -r .claude/skills/* skills/"
  }
}
```

### Future: Claude Code Plugin

For deeper integration, the skills can also be packaged as a Claude Code plugin with a `.claude-plugin/plugin.json` manifest. This would allow `/plugin install` and marketplace distribution. The CLI approach works today and doesn't require users to know about plugin mechanics.

---

## Build & publish workflow

```bash
# 1. Build
pnpm build

# 2. Run tests
pnpm test

# 3. Dry-run pack to verify contents
npm pack --dry-run

# 4. Bump version
npm version patch   # or minor, major

# 5. Publish
npm publish --access public

# 6. Tag release
git push --tags
```

### CI/CD

The current GitHub Actions workflow (`.github/workflows/ci.yml`) runs build + test on push to main and PRs. To add auto-publish:

```yaml
# Add to ci.yml or create a separate release.yml
- name: Publish
  if: github.ref == 'refs/heads/main' && github.event_name == 'push'
  run: npm publish --access public
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Or use a release-triggered workflow for more control.
