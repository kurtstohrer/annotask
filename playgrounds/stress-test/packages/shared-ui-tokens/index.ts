// Side-effect-free re-export — consumers do one of:
//   import '@annotask/stress-ui-tokens/tokens.css'
//   import { TOKEN_NAMES } from '@annotask/stress-ui-tokens'
//
// The CSS file carries the actual cascading tokens; this TS file is
// useful for tooling that wants to enumerate the token names.

export const TOKEN_NAMES = [
  'stress-bg',
  'stress-surface',
  'stress-surface-2',
  'stress-border',
  'stress-text',
  'stress-text-muted',
  'stress-accent',
  'stress-accent-hover',
  'stress-success',
  'stress-warning',
  'stress-danger',
  'stress-radius',
  'stress-radius-sm',
  'stress-gutter',
  'stress-font',
  'stress-font-mono',
] as const

export type TokenName = (typeof TOKEN_NAMES)[number]
