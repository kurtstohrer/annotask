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

0. **Check server status**:
   ```bash
   annotask status
   ```
   If this fails, the Annotask dev server isn't running. Ask the user to start it.

1. **Start watching**:
   ```bash
   annotask watch
   ```
   This connects to the Annotask WebSocket and streams changes in real-time. If the CLI isn't installed globally, use `npx annotask watch`.

   For a one-time snapshot instead of live streaming:
   ```bash
   annotask report
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
