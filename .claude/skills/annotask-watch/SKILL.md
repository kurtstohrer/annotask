# annotask-watch

Watch for Annotask design changes in real-time and describe what the user is doing.

## When to use

Use this skill when the user says things like:
- "watch my Annotask changes"
- "monitor Annotask"
- "what am I changing in Annotask?"
- `/annotask-watch`

## How it works

Connect to the Annotask WebSocket and stream changes as the user makes them visually.

## Steps

0. **Discover server URL** — read `.annotask/server.json` in the current working directory only (never parent directories):
   ```bash
   cat .annotask/server.json
   ```
   Use the `url` value as the server URL. If the file contains a `"mfe"` field, this is a micro-frontend setup — the server is running on a remote root shell. Save the `mfe` value for filtering. If not found, probe `curl -s http://localhost:24678/__annotask/api/status` then `curl -s http://localhost:5173/__annotask/api/status`. **Do NOT read server.json from parent or sibling directories.**

1. **Start watching** by running in the background:
   ```bash
   npx @annotask/cli watch --port=PORT
   ```
   Or if the CLI isn't installed, poll the HTTP API:
   ```bash
   curl -s $BASE_URL/__annotask/api/report
   ```

2. **Describe what you see** — as changes come in, summarize them in plain language:
   - "You changed the background color of table cells in PlanetTable.vue to a dark red (#2a1a1a)"
   - "You increased the font size of the header title to 28px"
   - "You adjusted the gap between flex items in the nav to 16px"

3. **Suggest next steps** — after the user seems done (they say "apply these" or "looks good"), use the `/annotask-apply` skill to apply the changes to source code.

## Notes

- This is a passive monitoring mode — don't modify any files until explicitly asked
- Focus on summarizing the intent, not the raw hex values
- Group related changes together ("You restyled the table rows with a darker background and larger text")
