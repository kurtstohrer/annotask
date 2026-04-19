import type { ComponentRef } from '../../schema'
import type { ResolveComponentChainResult } from '../../shared/bridge-types'

/**
 * Captures component identity for a selected element. Returned as a
 * fragment that callers merge into a task's `context` object:
 *   - `component` — the selected component (PascalCase source_tag when
 *     available, else the owning file's component).
 *   - `rendered` — outerHTML of the element after React/Vue rendering, with
 *     annotask bookkeeping attrs stripped. This is the "post-render" view
 *     that pairs with `component` as the "pre-render" view.
 *
 * `fromSource` is a sync helper for call sites without an eid (a11y /
 * error fixes) — builds a minimal component ref from known metadata only.
 */
export interface ComponentContextFragment {
  component?: ComponentRef
  rendered?: string
}

export interface ComponentContextCapture {
  capture(eid?: string | null): Promise<ComponentContextFragment>
  fromSource(
    name?: string | null,
    file?: string | null,
    line?: number | string | null,
    mfe?: string | null,
  ): ComponentContextFragment
}

interface IframeWithComponentChain {
  getComponentChain(eid: string): Promise<ResolveComponentChainResult | null>
}

export function useComponentContextCapture(
  iframe: IframeWithComponentChain,
): ComponentContextCapture {
  async function capture(eid?: string | null): Promise<ComponentContextFragment> {
    if (!eid) return {}
    const chain = await iframe.getComponentChain(eid)
    if (!chain || !chain.primary || !chain.primary.name) return {}
    const frag: ComponentContextFragment = { component: { ...chain.primary } }
    if (chain.rendered) frag.rendered = chain.rendered
    return frag
  }

  function fromSource(
    name?: string | null,
    file?: string | null,
    line?: number | string | null,
    mfe?: string | null,
  ): ComponentContextFragment {
    if (!name) return {}
    const component: ComponentRef = { name }
    if (file) component.file = file
    if (line != null && line !== '') {
      const n = typeof line === 'number' ? line : parseInt(line, 10)
      if (!isNaN(n) && n > 0) component.line = n
    }
    if (mfe) component.mfe = mfe
    return { component }
  }

  return { capture, fromSource }
}
