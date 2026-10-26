import { useCallback, useEffect, useRef, useState } from 'react';
import { streamSSE } from '../lib/sse';

/**
 * One streamed AI answer: `start(path, body)` begins (aborting any previous run),
 * `stop()` cancels. phase: idle → streaming → done | error. A failure after some
 * text keeps the partial text and sets `incomplete`.
 */
export function useAIStream() {
  const [state, setState] = useState({ text: '', phase: 'idle', error: null, provider: null, incomplete: false });
  const abortRef = useRef(null);

  const stop = useCallback(() => abortRef.current?.abort(), []);
  useEffect(() => stop, [stop]); // the upstream call is cancelled when the component unmounts

  const start = useCallback(async (path, body) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let text = '';
    let failure = null;
    let provider = null;
    setState({ text: '', phase: 'streaming', error: null, provider: null, incomplete: false });
    try {
      await streamSSE(path, body, {
        delta: ({ text: chunk }) => { text += chunk; setState((s) => ({ ...s, text })); },
        done: (data) => { provider = data.provider ?? null; },
        error: ({ message }) => { failure = message || 'The AI service is unavailable right now.'; },
      }, { signal: controller.signal });
      if (abortRef.current !== controller) return;
      setState(failure
        ? { text, phase: 'error', error: failure, provider, incomplete: Boolean(text) }
        : { text, phase: 'done', error: null, provider, incomplete: false });
    } catch (err) {
      if (err.name === 'AbortError' || abortRef.current !== controller) return;
      setState({ text, phase: 'error', error: err.message || 'The AI service is unavailable right now.', provider, incomplete: Boolean(text) });
    }
  }, []);

  return { ...state, start, stop };
}
