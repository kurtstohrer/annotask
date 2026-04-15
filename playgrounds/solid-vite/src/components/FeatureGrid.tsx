import { For } from 'solid-js'
import styles from './FeatureGrid.module.css'

const features = [
  {
    title: 'Visual editing',
    description: 'Click any element and tweak styles, classes, or content right in the browser.',
  },
  {
    title: 'Task pipeline',
    description: 'Annotate elements to create structured tasks that AI agents understand.',
  },
  {
    title: 'Multi-framework',
    description: 'Vue, React, Svelte, SolidJS, Astro, and plain HTML — one plugin fits all.',
  },
  {
    title: 'MCP protocol',
    description: 'Built-in MCP server lets AI editors fetch tasks, update status, and ask questions.',
  },
  {
    title: 'Design tokens',
    description: 'Extracts your color, typography, and spacing tokens so agents match your design system.',
  },
  {
    title: 'Accessibility',
    description: 'Built-in axe-core scanner finds WCAG issues and creates fix tasks in one click.',
  },
]

export default function FeatureGrid() {
  return (
    <section id="features" class={styles.section}>
      <div class={styles.inner}>
        <h2 class={styles.heading}>Everything you need</h2>
        <p class={styles.subheading}>
          A complete toolkit for visual tasking in your dev environment.
        </p>

        <div class={styles.grid}>
          <For each={features}>
            {(feature) => (
              <article class={styles.card}>
                <h3 class={styles.cardTitle}>{feature.title}</h3>
                <p class={styles.cardDesc}>{feature.description}</p>
              </article>
            )}
          </For>
        </div>
      </div>
    </section>
  )
}
