'use client';
import dynamic from 'next/dynamic';
import { useEffect, useRef } from 'react';
import { useEditor } from '../store/editor';
import { sendPrompt } from '../ai/assistant';

const Editor = dynamic(() => import('./Editor').then((m) => m.Editor), {
  ssr: false,
  loading: () => (
    <div className="grid h-screen place-items-center bg-ink-900 text-[12.5px] text-ink-300">Loading studio…</div>
  ),
});

export function EditorClient({ projectId, shareToken, initialPrompt, openImport }: { projectId?: string; shareToken?: string; initialPrompt?: string; openImport?: boolean }) {
  const sent = useRef(false);
  useEffect(() => {
    if (!openImport) return;
    const unsub = useEditor.subscribe((s) => {
      if (s.projectId === projectId && s.saveState === 'saved') {
        unsub();
        window.history.replaceState(null, '', `/project/${projectId}`);
        setTimeout(() => window.dispatchEvent(new CustomEvent('ai3d:import-drawing')), 300);
      }
    });
    return unsub;
  }, [openImport, projectId]);
  useEffect(() => {
    if (!initialPrompt || sent.current) return;
    const unsub = useEditor.subscribe((s) => {
      if (!sent.current && s.projectId === projectId && s.saveState === 'saved') {
        sent.current = true;
        unsub();
        window.history.replaceState(null, '', `/project/${projectId}`);
        setTimeout(() => void sendPrompt(initialPrompt), 300);
      }
    });
    return unsub;
  }, [initialPrompt, projectId]);
  return <Editor projectId={projectId} shareToken={shareToken} />;
}
