// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useStyleEditor } from '../useStyleEditor'

const meta = { file: 'src/App.vue', line: '10', component: 'App' }

describe('useStyleEditor', () => {
  let editor: ReturnType<typeof useStyleEditor>

  beforeEach(() => {
    editor = useStyleEditor()
    editor.clearChanges()
  })

  describe('applyStyle', () => {
    it('records a style change', () => {
      editor.applyStyle('e-1', 'color', 'blue', 'red', meta)

      expect(editor.changes.value).toHaveLength(1)
      const change = editor.changes.value[0]
      expect(change.type).toBe('style_update')
      expect(change.after).toBe('blue')
    })

    it('records the before value', () => {
      editor.applyStyle('e-1', 'padding', '20px', '10px', meta)

      const change = editor.changes.value[0]
      expect(change.type).toBe('style_update')
      if (change.type === 'style_update') {
        expect(change.before).toBe('10px')
        expect(change.after).toBe('20px')
      }
    })

    it('collapses repeated changes to same eid+property', () => {
      editor.applyStyle('e-1', 'color', 'red', '', meta)
      editor.applyStyle('e-1', 'color', 'blue', '', meta)
      editor.applyStyle('e-1', 'color', 'green', '', meta)

      expect(editor.changes.value).toHaveLength(1)
      const change = editor.changes.value[0]
      expect(change.type).toBe('style_update')
      if (change.type === 'style_update') {
        expect(change.after).toBe('green')
      }
    })

    it('does not collapse changes on different eids with same file:line', () => {
      editor.applyStyle('e-1', 'color', 'red', '', meta)
      editor.applyStyle('e-2', 'color', 'blue', '', meta)

      expect(editor.changes.value).toHaveLength(2)
    })

    it('does not collapse changes for different properties', () => {
      editor.applyStyle('e-1', 'color', 'red', '', meta)
      editor.applyStyle('e-1', 'padding', '10px', '', meta)

      expect(editor.changes.value).toHaveLength(2)
    })
  })

  describe('recordClassChange', () => {
    it('records a class_update change', () => {
      editor.recordClassChange('e-1', 'old-class', 'new-class', meta)

      expect(editor.changes.value).toHaveLength(1)
      const change = editor.changes.value[0]
      expect(change.type).toBe('class_update')
      if (change.type === 'class_update') {
        expect(change.before.classes).toBe('old-class')
        expect(change.after.classes).toBe('new-class')
      }
    })

    it('collapses repeated class changes on same eid', () => {
      editor.recordClassChange('e-1', 'a', 'b', meta)
      editor.recordClassChange('e-1', 'b', 'c', meta)

      expect(editor.changes.value).toHaveLength(1)
      const change = editor.changes.value[0]
      if (change.type === 'class_update') {
        expect(change.before.classes).toBe('a')
        expect(change.after.classes).toBe('c')
      }
    })
  })

  describe('undo', () => {
    it('returns undo info for style changes', () => {
      editor.applyStyle('e-1', 'padding', '20px', '10px', meta)

      const undoInfo = editor.undo()
      expect(undoInfo).not.toBeNull()
      expect(undoInfo!.type).toBe('style')
      expect(undoInfo!.eid).toBe('e-1')
      expect(undoInfo!.property).toBe('padding')
      expect(undoInfo!.value).toBe('10px')
      expect(editor.changes.value).toHaveLength(0)
    })

    it('returns undo info for class changes', () => {
      editor.recordClassChange('e-1', 'original', 'changed', meta)

      const undoInfo = editor.undo()
      expect(undoInfo).not.toBeNull()
      expect(undoInfo!.type).toBe('class')
      expect(undoInfo!.eid).toBe('e-1')
      expect(undoInfo!.classes).toBe('original')
      expect(editor.changes.value).toHaveLength(0)
    })

    it('returns null when no changes', () => {
      const result = editor.undo()
      expect(result).toBeNull()
      expect(editor.changes.value).toHaveLength(0)
    })
  })

  describe('clearChanges', () => {
    it('removes all changes', () => {
      editor.applyStyle('e-1', 'color', 'red', '', meta)
      editor.applyStyle('e-1', 'padding', '10px', '', meta)

      editor.clearChanges()
      expect(editor.changes.value).toHaveLength(0)
    })
  })

  describe('report', () => {
    it('returns null when no changes', () => {
      expect(editor.report.value).toBeNull()
    })

    it('filters out no-op style changes', () => {
      editor.applyStyle('e-1', 'padding', '10px', '10px', meta) // before === after

      expect(editor.report.value).toBeNull()
    })

    it('includes meaningful style changes', () => {
      editor.applyStyle('e-1', 'color', 'blue', 'red', meta)

      const report = editor.report.value
      expect(report).not.toBeNull()
      expect(report!.version).toBe('1.0')
      expect(report!.changes).toHaveLength(1)
    })

    it('filters out no-op class changes', () => {
      editor.recordClassChange('e-1', 'same', 'same', meta)
      expect(editor.report.value).toBeNull()
    })

    it('strips internal fields from report', () => {
      editor.recordAnnotation({
        file: 'src/App.vue', line: '5', component: 'App',
        intent: 'Make this bigger', pinId: 'pin-123',
      })

      const report = editor.report.value!
      const annotation = report.changes[0] as any
      expect(annotation.intent).toBe('Make this bigger')
      expect(annotation.pinId).toBeUndefined()
    })

    it('includes project metadata', () => {
      editor.applyStyle('e-1', 'color', 'blue', 'red', meta)

      const report = editor.report.value!
      expect(report.project).toBeDefined()
      expect(report.project.framework).toBeDefined()
    })
  })

  describe('recordAnnotation', () => {
    it('records an annotation change', () => {
      const id = editor.recordAnnotation({
        file: 'src/App.vue', line: '5', component: 'App',
        intent: 'Increase padding', action: 'increase',
        elementTag: 'div', elementClasses: 'container',
      })

      expect(id).toBeTruthy()
      expect(editor.changes.value).toHaveLength(1)
      const change = editor.changes.value[0]
      expect(change.type).toBe('annotation')
    })
  })
})
