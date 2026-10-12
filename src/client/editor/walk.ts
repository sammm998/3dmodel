'use client';
import { useEditor } from '../store/editor';

/** Enters the first-person walk view (perspective camera, realistic rendering). */
export function startWalk() {
  const st = useEditor.getState();
  st.set({
    walkMode: true,
    walkLocked: false,
    camera: 'perspective',
    viewMode: st.viewMode === 'modeling' ? 'realistic' : st.viewMode,
    tool: 'select',
    selection: [],
    measure: { points: [] },
  });
}

export function stopWalk() {
  useEditor.getState().set({ walkMode: false, walkLocked: false });
  if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock();
}
