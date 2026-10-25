import { useId } from 'react';

export default function Input({ label, error, className = '', id, ...props }) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <div className={className}>
      {label && <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={`w-full border rounded-lg px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${error ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-white hover:border-gray-400'}`}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
