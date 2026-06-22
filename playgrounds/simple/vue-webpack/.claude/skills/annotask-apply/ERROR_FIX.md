# Error fix tasks

`error_fix` tasks come from the Errors tab in the Annotask shell. Each task
captures one or more console errors with their stack traces, the route where
they happened, and the number of occurrences.

## Read order

1. **`task.context.level`** — `'error'` or `'warn'`. Errors block; warnings
   often don't. Don't suppress warnings into errors and don't downgrade
   errors into warnings just to make the panel quieter.
2. **`task.context.errorId`** — stable hash. Use it to confirm you're
   fixing what the user saw, not a sibling error from the same file.
3. **`task.context.occurrences`** — when this is high (>50), the error is
   firing on every render or interaction. Prioritize root-cause fixes over
   try/catch wrappers.
4. **Stack trace** — read the top frame to locate the throw, but read the
   second and third frames to understand who called it. The fix usually
   lives at the caller, not the throw site.

## Fix patterns

- **Undefined property access** (`Cannot read properties of undefined`) —
  fix the producer, not the consumer. Adding `?.` everywhere hides the
  real defect.
- **Hydration mismatch** (React/Vue/Svelte SSR) — the server and client
  rendered different output. Find the divergent branch (often
  `typeof window !== 'undefined'`) and align them.
- **Network errors** — surface to the user; don't swallow with a generic
  toast unless the user explicitly asked for one.

## Don't

- Don't add `try/catch` around the call site just to silence the error.
- Don't add `console.error` suppressions or noise filters.
- Don't change the error to a warning to clear the panel.

When you finish, set `status: 'review'` with a one-line resolution that
states (a) the root cause and (b) the file you touched. The user will
verify in the Errors tab that the count stays at zero.
