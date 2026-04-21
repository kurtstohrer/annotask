import { createSignal, Show } from 'solid-js'
import styles from './Hero.module.css'

export default function Hero() {
  const [expanded, setExpanded] = createSignal(false)

  return (
    <section class={styles.hero}>
      <div class={styles.gradient} aria-hidden="true" />
      <div class={styles.inner}>
        <span class={styles.eyebrow}>Now with SolidJS support</span>

        <h1 class={styles.headline}>
          Visual tasking<br />
          for AI-coded apps.
        </h1>

        <p class={styles.subhead}>
          Click any element in your dev server. Edit it. Annotate it. Annotask captures the
          intent and your coding agent applies the change.
        </p>

        <div class={styles.ctaRow}>
          <a href="#waitlist" class={styles.primary}>
            Get started — it's free
          </a>
          <button class={styles.secondary} onClick={() => setExpanded(v => !v)}>
            {expanded() ? 'Collapse' : 'Learn more'} →
          </button>
        </div>

        <Show when={expanded()}>
          <div class={styles.expandedInfo}>
            <p>
              Annotask works with any framework — Vue, React, Svelte, SolidJS, Astro, and plain
              HTML. Install the plugin, open your dev server, and start creating visual tasks that
              AI agents can understand and apply.
            </p>
          </div>
        </Show>

        <ul class={styles.statRow} aria-label="Adoption stats">
          <li>
            <strong>5+</strong>
            <span>frameworks</span>
          </li>
          <li>
            <strong>2</strong>
            <span>build tools</span>
          </li>
          <li>
            <strong>MCP</strong>
            <span>protocol</span>
          </li>
        </ul>
      </div>
    </section>
  )
}
