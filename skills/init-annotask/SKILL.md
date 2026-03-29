# init-annotask

Initialize Annotask for this project by scanning the codebase and generating `.annotask/design-spec.json`.

## When to use

Use this skill when the user says any of:
- "initialize Annotask" / "init Annotask"
- "set up Annotask" / "configure Annotask"
- "scan my project for Annotask"
- `/init-annotask`

## What it does

Scans the project to detect the framework, design tokens (colors, typography, spacing, borders), icon library, and component library. Writes `.annotask/design-spec.json` which Annotask reads to populate the Theme page with editable design tokens.

## Output schema

Every token uses this shape:

```json
{
  "role": "primary",
  "value": "#3b82f6",
  "cssVar": "--color-primary",
  "source": "var(--color-primary)",
  "sourceFile": "src/assets/main.css",
  "sourceLine": 12
}
```

- `role` — semantic name (see vocabularies below)
- `value` — resolved value (hex color, font string, size, etc.)
- `cssVar` — the CSS custom property name, if backed by one. Omit if not a CSS variable.
- `source` — human-readable provenance: `var(--x)`, `tailwind.config:colors.primary`, `@theme:--color-primary`
- `sourceFile` — relative path to the file where the value is defined
- `sourceLine` — line number in that file

## Steps

### 1. Detect framework

Check `package.json` dependencies:
- `vue` → name "vue", read version
- `react` / `react-dom` → name "react"
- `svelte` → name "svelte"

Check for styling:
- `tailwindcss` in devDependencies or dependencies → add "tailwind" to styling array
- Look for `<style scoped>` in `.vue` files → add "scoped-css"
- Look for CSS module imports (`.module.css`) → add "css-modules"

### 2. Scan colors

**Find color sources:**

1. **CSS variables**: Search for `:root` declarations across CSS files and Vue `<style>` blocks. Extract `--variable-name: value` pairs.

2. **Tailwind v4** (version >= 4): Search for `@theme` blocks in CSS files. Extract custom properties defined within them.

3. **Tailwind v3** (version < 4): Read `tailwind.config.js`, `tailwind.config.ts`, or `tailwind.config.mjs`. Extract `theme.extend.colors`. Convert to flat key-value pairs.

**Classify into semantic roles using this fixed vocabulary:**

| Role | Match heuristics (in variable/key name) |
|------|----------------------------------------|
| `primary` | primary, brand |
| `secondary` | secondary |
| `accent` | accent |
| `background` | bg, background |
| `surface` | surface, card |
| `text` | text, foreground, fg (but not text-muted) |
| `text-muted` | text-muted, muted, subtle |
| `border` | border, divider, separator |
| `danger` | danger, error, destructive, red |
| `warning` | warning, amber, yellow (semantic) |
| `success` | success, green (semantic) |
| `info` | info, blue (semantic) |

If a variable doesn't match any heuristic, use a descriptive role name derived from the variable name (e.g., `--sidebar-bg` → role `sidebar-bg`).

**Limits**: Maximum 30 color tokens. Prioritize semantic roles first, then most-used custom colors.

### 3. Scan typography

**Font families**: Search for:
- CSS variables containing `font`, `family` in `:root` or `@theme`
- `fontFamily` in Tailwind config
- Direct `font-family` declarations on `body`, `html`, `h1`-`h6` elements

Classify as:
- `heading` — used on h1-h6 or named heading/display
- `body` — used on body/html or named sans/body/base
- `mono` — monospace, code, named mono

**Font scale**: Search for:
- CSS variables containing `font-size`, `text-` size names
- `fontSize` in Tailwind config
- `@theme` size definitions

Use roles: `xs`, `sm`, `base`, `lg`, `xl`, `2xl`, `3xl`, `4xl` (match by name or by ascending size order).

**Weights**: Scan component files for `font-weight` values and Tailwind weight classes (`font-bold`, `font-semibold`, etc.). List unique weights as strings: `["400", "500", "600", "700"]`.

### 4. Scan spacing

Search for:
- CSS variables containing `space`, `gap`, `margin`, `padding`, `size`
- `spacing` in Tailwind config
- `@theme` spacing definitions

Use roles: `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `3xl`, `4xl` (match by name or ascending size).

**Limits**: Maximum 12 spacing tokens.

### 5. Scan border radius

Search for:
- CSS variables containing `radius`, `rounded`
- `borderRadius` in Tailwind config
- `@theme` radius definitions

Use roles: `sm`, `md`, `lg`, `xl`, `full` (match by name or ascending size).

### 6. Detect icon library

Check `package.json` dependencies for:

| Package | Library name |
|---------|-------------|
| `lucide-vue-next` or `lucide-react` | lucide |
| `@heroicons/vue` or `@heroicons/react` | heroicons |
| `@fortawesome/vue-fontawesome` or `@fortawesome/react-fontawesome` | fontawesome |
| `@phosphor-icons/vue` or `@phosphor-icons/react` | phosphor |
| `@tabler/icons-vue` or `@tabler/icons-react` | tabler |

Read the version from package.json.

### 7. Detect component library

Check `package.json` dependencies for:

| Package | Library name |
|---------|-------------|
| `primevue` | PrimeVue |
| `vuetify` | Vuetify |
| `element-plus` | Element Plus |
| `@headlessui/vue` | Headless UI |
| `radix-vue` | Radix Vue |
| `naive-ui` | Naive UI |
| `@shadcn/ui` or `shadcn-vue` | shadcn/ui |

If found, scan `src/` for import statements to find used components:
```bash
grep -rh "from '${package}" --include='*.vue' --include='*.ts' --include='*.js' src/ | sort -u
```

Extract component names from the imports. Read the version from package.json.

### 8. Write design spec

Create `.annotask/design-spec.json`:

```json
{
  "version": "1.0",
  "framework": {
    "name": "vue",
    "version": "3.5.0",
    "styling": ["tailwind", "scoped-css"]
  },
  "colors": [
    { "role": "primary", "value": "#3b82f6", "cssVar": "--color-primary", "source": "var(--color-primary)", "sourceFile": "src/assets/main.css", "sourceLine": 5 },
    { "role": "background", "value": "#0b1120", "cssVar": "--bg", "source": "var(--bg)", "sourceFile": "src/assets/main.css", "sourceLine": 3 }
  ],
  "typography": {
    "families": [
      { "role": "body", "value": "Inter, sans-serif", "cssVar": "--font-sans", "source": "var(--font-sans)", "sourceFile": "src/assets/main.css", "sourceLine": 10 }
    ],
    "scale": [
      { "role": "base", "value": "1rem", "cssVar": "--text-base", "source": "var(--text-base)", "sourceFile": "src/assets/main.css", "sourceLine": 15 }
    ],
    "weights": ["400", "500", "600", "700"]
  },
  "spacing": [
    { "role": "sm", "value": "8px", "cssVar": "--space-sm", "source": "var(--space-sm)", "sourceFile": "src/assets/main.css", "sourceLine": 20 }
  ],
  "borders": {
    "radius": [
      { "role": "md", "value": "8px", "cssVar": "--radius-md", "source": "var(--radius-md)", "sourceFile": "src/assets/main.css", "sourceLine": 25 }
    ]
  },
  "icons": {
    "library": "lucide",
    "version": "0.300.0"
  },
  "components": {
    "library": "PrimeVue",
    "version": "4.5.4",
    "used": ["DataTable", "Column", "InputText", "Tag", "Button"]
  }
}
```

### 9. Clean up old config

If `.annotask/config.json` exists, delete it — it's been replaced by `design-spec.json`.

### 10. Update .gitignore

Check if `.gitignore` contains `.annotask/`. If not, append:
```
# Annotask (generated)
.annotask/
```

### 11. Report to user

Tell the user:
- What was detected (framework, number of color/typography/spacing tokens, libraries)
- That they can open the **Theme** page in Annotask to view and edit tokens
- That they can re-run `/init-annotask` to rescan

## Notes

- This skill is idempotent — re-running overwrites the design spec with fresh data
- The design spec is gitignored because it's generated and may vary per developer
- If detection fails for any section, use empty defaults (empty array, null) rather than omitting the field
- All top-level fields are required — use empty values for missing data
- When a token has a CSS variable backing, always populate the `cssVar` field — this enables live preview in the Theme page
