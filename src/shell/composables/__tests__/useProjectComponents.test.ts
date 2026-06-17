import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// useComponentLibrary subscribes to the shared WebSocket client on first use.
vi.mock('../../services/wsClient', () => ({
  on: () => () => {},
  send: () => {},
  isConnected: () => true,
}))

import { useComponentLibrary, type LibraryComponent } from '../useProjectComponents'
import { useWorkspace, type WorkspaceInfo } from '../useWorkspace'

function comp(name: string, sourceFile?: string | null): LibraryComponent {
  return { name, props: [], ...(sourceFile !== undefined ? { sourceFile } : {}) }
}

const TWO_MFE: WorkspaceInfo = {
  root: '/r',
  isWorkspace: true,
  currentDir: 'packages/checkout',
  packages: [
    { name: 'checkout', dir: 'packages/checkout', mfe: 'checkout' },
    { name: 'admin', dir: 'packages/admin', mfe: 'admin' },
  ],
}

describe('surfaceRenderInfo (MFE-aware palette)', () => {
  const ws = useWorkspace()
  const cl = useComponentLibrary()

  beforeEach(() => { ws.info.value = null })
  afterEach(() => { vi.restoreAllMocks() })

  it('single-MFE / non-workspace: everything renderable, no owning MFE', () => {
    ws.info.value = { root: '/r', isWorkspace: false, packages: [], currentDir: '' }
    expect(cl.surfaceRenderInfo('Project', comp('Foo', 'src/Foo.vue'))).toEqual({ renderable: true, owningMfe: null })
  })

  it('a Project component from ANOTHER MFE is not renderable on this surface', () => {
    ws.info.value = TWO_MFE
    expect(cl.surfaceRenderInfo('Project', comp('AdminNav', 'packages/admin/src/AdminNav.vue')))
      .toEqual({ renderable: false, owningMfe: 'admin' })
  })

  it('a Project component on the CURRENT surface is renderable', () => {
    ws.info.value = TWO_MFE
    expect(cl.surfaceRenderInfo('Project', comp('CartButton', 'packages/checkout/src/CartButton.vue')))
      .toEqual({ renderable: true, owningMfe: 'checkout' })
  })

  it('an unattributed Project component (shared/no MFE source) defaults to renderable', () => {
    ws.info.value = TWO_MFE
    expect(cl.surfaceRenderInfo('Project', comp('Shared', 'packages/design-system/src/Shared.vue')))
      .toEqual({ renderable: true, owningMfe: null })
  })

  it('third-party libraries are never gated (the registry is the real arbiter)', () => {
    ws.info.value = TWO_MFE
    // Even with a cross-MFE-looking source, an installed library stays draggable
    // and is stamped with the current surface MFE.
    expect(cl.surfaceRenderInfo('primevue', comp('Button', 'packages/admin/src/whatever')))
      .toEqual({ renderable: true, owningMfe: 'checkout' })
  })
})
