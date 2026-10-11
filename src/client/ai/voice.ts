'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { editor } from '../store/editor';

type Lang = 'sv-SE' | 'en-US';
export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'error';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

/**
 * Push-to-talk speech input.
 * - Server STT (OpenAI transcription) when configured: records with MediaRecorder.
 * - Otherwise the browser's Web Speech API (Chrome/Edge/Safari).
 */
export function useVoiceInput(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>('sv-SE');
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recog = useRef<SpeechRecognitionLike | null>(null);
  const finalText = useRef('');

  const supported = typeof window !== 'undefined' && (!!getRecognition() || !!navigator.mediaDevices?.getUserMedia);

  useEffect(() => () => {
    recog.current?.abort();
    rec.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setInterim('');
    finalText.current = '';
    const server = editor().aiInfo?.serverSpeechToText;
    if (server && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mr = new MediaRecorder(stream);
        chunks.current = [];
        mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
        mr.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          setState('transcribing');
          try {
            const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' });
            const fd = new FormData();
            fd.append('audio', blob, `speech.${(mr.mimeType || 'audio/webm').includes('mp4') ? 'mp4' : 'webm'}`);
            fd.append('language', lang.slice(0, 2));
            const res = await fetch('/api/ai/transcribe', { method: 'POST', body: fd });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message ?? 'Transcription failed');
            setState('idle');
            if (data.text?.trim()) onText(data.text.trim());
          } catch (e) {
            setState('error');
            setError((e as Error).message);
          }
        };
        rec.current = mr;
        mr.start();
        setState('listening');
        return;
      } catch (e) {
        setState('error');
        setError((e as Error).name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access in your browser settings.' : (e as Error).message);
        return;
      }
    }
    const R = getRecognition();
    if (!R) {
      setState('error');
      setError('Speech recognition is not available in this browser. Use Chrome/Edge/Safari, or configure server speech-to-text (OPENAI_API_KEY).');
      return;
    }
    const r = new R();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (e) => {
      let fin = '';
      let inter = '';
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) fin += res[0].transcript;
        else inter += res[0].transcript;
      }
      finalText.current = fin;
      setInterim((fin + ' ' + inter).trim());
    };
    r.onerror = (e) => {
      setState('error');
      setError(e.error === 'not-allowed' ? 'Microphone permission was denied.' : e.error === 'no-speech' ? 'No speech detected.' : `Speech recognition error: ${e.error}`);
    };
    r.onend = () => {
      const text = (finalText.current || '').trim();
      setState((s) => (s === 'error' ? s : 'idle'));
      setInterim('');
      if (text) onText(text);
    };
    recog.current = r;
    r.start();
    setState('listening');
  }, [lang, onText]);

  const stop = useCallback(() => {
    if (rec.current && rec.current.state === 'recording') rec.current.stop();
    if (recog.current) {
      recog.current.stop();
      recog.current = null;
    }
  }, []);

  return { state, interim, error, start, stop, lang, setLang, supported };
}
