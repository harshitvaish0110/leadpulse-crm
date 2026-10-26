import { describe, expect, it, vi } from 'vitest';
import { currencySymbol, formatCurrency, formatDate, formatPercent, setCurrency, timeAgo, toPercent } from './format';
import { customFieldPayload, customFieldState } from './customFields';
import { parseEmail } from './email';
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

  it('uses the workspace currency', () => {
    setCurrency('EUR');
    try {
      expect(formatCurrency(12_400)).toBe('€12K');
      expect(formatCurrency(950)).toBe('€950');
      expect(currencySymbol()).toBe('€');
    } finally {
      setCurrency('USD');
    }
    expect(currencySymbol()).toBe('$');
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

describe('csv mapping', async () => {
  const { guessMapping, applyMapping, missingRequired } = await import('./csvMapping');

  it('maps common header spellings and leaves unknown columns unmapped', () => {
    const mapping = guessMapping(['First_Name', 'Surname', 'E-mail', 'Organisation', 'Favourite colour', 'first']);
    expect(mapping).toEqual({
      First_Name: 'firstName', Surname: 'lastName', 'E-mail': 'email',
      Organisation: 'company', 'Favourite colour': '', first: '',
    });
    expect(missingRequired(mapping)).toEqual([]);
  });

  it('applies the mapping and drops empty cells', () => {
    const rows = applyMapping([{ A: ' Ann ', B: '', C: 'x' }], { A: 'firstName', B: 'phone', C: '' });
    expect(rows).toEqual([{ firstName: 'Ann' }]);
    expect(missingRequired({ A: 'firstName' }).map((f) => f.key)).toEqual(['lastName', 'email']);
  });
});

describe('task grouping', async () => {
  const { groupTasks, monthGrid } = await import('./taskGroups');
  // Wednesday 15 Oct 2025, local time.
  const now = new Date(2025, 9, 15, 14, 0);
  const at = (d, h = 10) => new Date(2025, 9, d, h).toISOString();

  it('splits by local day and week (Monday to Sunday)', () => {
    const g = groupTasks([
      { id: 'a', dueDate: at(14, 23) }, { id: 'b', dueDate: at(15, 8) }, { id: 'c', dueDate: at(15, 23) },
      { id: 'd', dueDate: at(19, 12) }, { id: 'e', dueDate: at(20, 9) }, { id: 'f', dueDate: null },
    ], now);
    const ids = (k) => g[k].map((t) => t.id);
    expect([ids('overdue'), ids('today'), ids('week'), ids('later'), ids('none')])
      .toEqual([['a'], ['b', 'c'], ['d'], ['e'], ['f']]);
  });

  it('builds a 6-week month grid starting on Monday', () => {
    const grid = monthGrid(new Date(2025, 9, 1));
    expect(grid).toHaveLength(42);
    expect(grid[0].getDay()).toBe(1);
    expect(grid.some((d) => d.getMonth() === 9 && d.getDate() === 31)).toBe(true);
  });
});

describe('parseEmail', () => {
  it('splits the subject line from the body', () => {
    expect(parseEmail('Subject: Next steps\n\nHi Ana,\nThanks!')).toEqual({ subject: 'Next steps', body: 'Hi Ana,\nThanks!' });
    expect(parseEmail('  subject:Hello\r\n\r\nBody')).toEqual({ subject: 'Hello', body: 'Body' });
  });

  it('keeps an unfinished subject line out of the body while streaming', () => {
    expect(parseEmail('Subject: Next st')).toEqual({ subject: 'Next st', body: '' });
  });

  it('treats text without a subject line as body', () => {
    expect(parseEmail('Hi Ana')).toEqual({ subject: '', body: 'Hi Ana' });
    expect(parseEmail(undefined)).toEqual({ subject: '', body: '' });
  });
});

describe('timeAgo', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  it('describes past times in words', () => {
    expect(timeAgo('2026-10-26T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-10-26T10:00:00Z', now)).toBe('2 hours ago');
    expect(timeAgo('2026-10-25T12:00:00Z', now)).toBe('yesterday');
    expect(timeAgo('not a date', now)).toBe('');
  });
});

describe('custom field form values', () => {
  it('sends filled-in values on create and only changes on edit', () => {
    expect(customFieldPayload({ plan: 'Growth', seats: '' })).toEqual({ plan: 'Growth' });
    expect(customFieldPayload({ plan: '' })).toBeUndefined();

    const stored = { plan: 'Growth', seats: 25, budgetTier: 'SMB' };
    const state = customFieldState(stored);
    expect(state).toEqual({ plan: 'Growth', seats: '25', budgetTier: 'SMB' });
    expect(customFieldPayload(state, stored)).toBeUndefined();
    expect(customFieldPayload({ ...state, seats: '', plan: 'Starter' }, stored)).toEqual({ seats: null, plan: 'Starter' });
  });
});
