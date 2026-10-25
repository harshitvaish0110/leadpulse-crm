import { createElement } from 'react';

/**
 * Minimal markdown for AI output. HTML is escaped first, so model output can
 * never inject markup; only the patterns below become tags. This is the one
 * place in the app that uses dangerouslySetInnerHTML.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);

export function renderMarkdown(markdown) {
  if (!markdown) return '';
  return escapeHtml(markdown)
    .replace(/^### (.+)$/gm, '<h4 class="text-xs font-semibold text-gray-700 mt-2 mb-0.5">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="text-sm font-semibold text-gray-800 mt-3 mb-1">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-*] (.+)$/gm, '<li class="text-sm text-gray-600 ml-4 list-disc">$1</li>')
    .replace(/\n{2,}/g, '<div class="mb-2"></div>')
    .replace(/\n/g, '<br/>');
}

/** <Markdown text={...} className="..." /> */
export function Markdown({ text, className }) {
  return createElement('div', { className, dangerouslySetInnerHTML: { __html: renderMarkdown(text) } });
}
