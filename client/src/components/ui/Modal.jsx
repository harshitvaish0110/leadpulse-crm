import { useId } from 'react';
import { X } from 'lucide-react';
import { useDialog } from './useDialog';

export default function Modal({ isOpen, onClose, title, children, size = 'md' }) {
  const panelRef = useDialog(isOpen, onClose);
  const titleId = useId();
  if (!isOpen) return null;

  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`relative bg-white sm:rounded-2xl shadow-xl w-full ${sizes[size]} h-full sm:h-auto sm:max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 id={titleId} className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
