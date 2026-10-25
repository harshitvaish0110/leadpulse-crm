import { describe, expect, it, vi } from 'vitest';
import { formatCurrency, formatDate, formatPercent, toPercent } from './format';
import { renderMarkdown } from './markdown';
import { createSSEParser } from './sse';

describe('format', () => {
  it('formats compact currency', () => {
    expect(formatCurrency(950)).toBe('$950');
    expect(formatCurrency(12_400)).toBe('$12K');
    expect(formatCurrency(1_250_000)).toBe('$1.3M');
    expect(formatCurrency('2500.50', { compact: false })).toBe('$2,501');
    expect(formatCurrency(null)).toBe('$0');
  });

  it('treats probabilities as 0–1 and clamps them', () => {
    expect(formatPercent(0.456)).toBe('46%');
    expect(toPercent(1.7)).toBe(100);
    expect(toPercent(undefined)).toBe(0);
  });

  it('keeps date-only values on their calendar day', () => {
    expect(formatDate('2026-03-01T00:00:00.000Z', { dateOnly: true })).toBe('Mar 1, 2026');
    expect(formatDate(null)).toBe('—');
  });
});

describe('renderMarkdown', () => {
  it('escapes HTML before applying markdown', () => {
    const html = renderMarkdown('## Hi <img src=x onerror=alert(1)>\n- **bold**');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<h3');
  });
});

describe('createSSEParser', () => {
  it('dispatches named events split across arbitrary chunks', () => {
    const delta = vi.fn();
    const done = vi.fn();
    const parser = createSSEParser({ delta, done });
    parser.push('event: delta\ndata: {"text":"Hel');
    parser.push('lo"}\n\nevent: delta\r\ndata: {"text":" world"}\r\n\r\n: ping\n\nevent: done\ndata: {}');
    parser.flush();
    expect(delta.mock.calls.map(([d]) => d.text).join('')).toBe('Hello world');
    expect(done).toHaveBeenCalledOnce();
  });
});
