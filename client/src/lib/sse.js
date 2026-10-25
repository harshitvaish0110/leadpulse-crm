import { authFetch } from '../api/axiosInstance';

/**
 * Incremental parser for named server-sent events. Feed it decoded text in any
 * chunk sizes; it calls `handlers[eventName](data)` once per complete event.
 * `data` is JSON-parsed; events without a handler are ignored.
 */
export function createSSEParser(handlers) {
  let buffer = '';

  const dispatch = (block) => {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length || !handlers[event]) return;
    try {
      handlers[event](JSON.parse(data.join('\n')));
    } catch {
      /* ignore malformed payloads */
    }
  };

  return {
    push(text) {
      buffer += text.replace(/\r\n/g, '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        dispatch(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    },
    flush() {
      if (buffer.trim()) dispatch(buffer);
      buffer = '';
    },
  };
}

/**
 * POSTs `body` as JSON to a streaming endpoint and dispatches its events
 * (`delta`, `done`, `error`, …) to `handlers`. Resolves when the stream ends.
 * Throws with the API's error message if the request is rejected before streaming.
 */
export async function streamSSE(path, body, handlers, { signal } = {}) {
  const res = await authFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { message = (await res.json()).error || message; } catch { /* not JSON */ }
    throw new Error(message);
  }

  const parser = createSSEParser(handlers);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.flush();
}
