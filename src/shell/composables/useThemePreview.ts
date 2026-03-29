import { ref, watch, type Ref } from 'vue'

const STYLE_ID = 'annotask-theme-preview'

const overrides = ref<Map<string, string>>(new Map())

function buildStyleContent(): string {
  if (overrides.value.size === 0) return ''
  const declarations = Array.from(overrides.value.entries())
    .map(([varName, value]) => `  ${varName}: ${value} !important;`)
    .join('\n')
  return `:root {\n${declarations}\n}`
}

function getIframeDoc(iframeRef: Ref<HTMLIFrameElement | null>): Document | null {
  try {
    return iframeRef.value?.contentDocument ?? null
  } catch {
    return null
  }
}

function injectStyle(doc: Document) {
  const css = buildStyleContent()
  let el = doc.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!css) {
    el?.remove()
    return
  }
  if (!el) {
    el = doc.createElement('style')
    el.id = STYLE_ID
    doc.head.appendChild(el)
  }
  el.textContent = css
}

export function useThemePreview(iframeRef: Ref<HTMLIFrameElement | null>) {
  function applyToIframe() {
    const doc = getIframeDoc(iframeRef)
    if (doc) injectStyle(doc)
  }

  function setOverride(cssVar: string, value: string) {
    const next = new Map(overrides.value)
    next.set(cssVar, value)
    overrides.value = next
  }

  function removeOverride(cssVar: string) {
    const next = new Map(overrides.value)
    next.delete(cssVar)
    overrides.value = next
  }

  function clearAll() {
    overrides.value = new Map()
  }

  // Re-apply whenever overrides change
  watch(overrides, applyToIframe, { deep: true })

  // Re-inject after iframe reloads (HMR, navigation)
  function onIframeLoad() {
    applyToIframe()
  }

  watch(iframeRef, (el, oldEl) => {
    if (oldEl) oldEl.removeEventListener('load', onIframeLoad)
    if (el) {
      el.addEventListener('load', onIframeLoad)
      applyToIframe()
    }
  }, { immediate: true })

  return {
    overrides,
    setOverride,
    removeOverride,
    clearAll,
    hasChanges: () => overrides.value.size > 0,
  }
}
