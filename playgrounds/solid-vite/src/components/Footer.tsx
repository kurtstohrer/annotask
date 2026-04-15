import styles from './Footer.module.css'

export default function Footer() {
  return (
    <footer class={styles.footer}>
      <div class={styles.inner}>
        <span class={styles.brand}>annotask</span>
        <span class={styles.copy}>Visual tasking for AI-coded apps.</span>
      </div>
    </footer>
  )
}
