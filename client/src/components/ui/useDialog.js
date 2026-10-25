import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog behaviour for modals and slide-overs: Escape closes, focus moves
 * into the panel and Tab stays inside it, the page behind does not scroll,
 * and focus returns to whatever opened the dialog.
 */
export function useDialog(isOpen, onClose) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const opener = document.activeElement;
    const panel = panelRef.current;
    const focusables = () => [...(panel?.querySelectorAll(FOCUSABLE) ?? [])];

    // Prefer the first form field over the close button.
    const first = panel?.querySelector('input, select, textarea') ?? focusables()[0];
    first?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current?.(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
    };

    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [isOpen]);

  return panelRef;
}
