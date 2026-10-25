import { useId } from 'react';
import { X } from 'lucide-react';
import { useDialog } from './useDialog';

export default function SlideOver({ isOpen, onClose, title, children, width = 'sm:max-w-md' }) {
  const panelRef = useDialog(isOpen, onClose);
  const titleId = useId();
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`relative bg-white h-full w-full ${width} shadow-2xl flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 id={titleId} className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
