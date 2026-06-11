export default function Badge({ children, variant = 'gray', size = 'sm' }) {
  const variants = {
    green:  'bg-green-100 text-green-800',
    red:    'bg-red-100 text-red-800',
    amber:  'bg-amber-100 text-amber-800',
    blue:   'bg-blue-100 text-blue-800',
    indigo: 'bg-indigo-100 text-indigo-800',
    gray:   'bg-gray-100 text-gray-700',
    purple: 'bg-purple-100 text-purple-800',
  };
  const sizes = { sm: 'px-2 py-0.5 text-xs', md: 'px-2.5 py-1 text-sm' };
  return (
    <span className={`inline-flex items-center font-medium rounded-full ${variants[variant]} ${sizes[size]}`}>
      {children}
    </span>
  );
}
