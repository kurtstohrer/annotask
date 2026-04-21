# mfe-react-sidebar

Persistent sidebar MFE for the stress lab. React 19 + Radix Themes, port `4250`.

Unlike the content MFEs, this app is registered with single-spa at `activeWhen: () => true` so it mounts on every route. It owns the theme toggle (light/dark), persists the choice to `localStorage['stress-lab:theme']`, and dispatches a `stress-theme-change` event that the other MFEs subscribe to so their framework providers (Mantine, Naive UI) stay in sync.

## Component library

Uses [Radix Themes](https://www.radix-ui.com/themes) — distinct from the other MFEs so annotask component discovery has another library to traverse. Components used: `Theme`, `Box`, `Flex`, `Heading`, `Text`, `Separator`, `Badge`, `IconButton`, plus icons from `@radix-ui/react-icons`.

## Solo dev

```
pnpm dev:stress-react-sidebar
open http://localhost:4250
```
