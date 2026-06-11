export default function Skeleton({ className = '', lines = 1 }) {
  if (lines > 1) {
    return (
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className={`animate-pulse bg-gray-200 rounded ${i === lines - 1 ? 'w-3/4' : 'w-full'} h-4`} />
        ))}
      </div>
    );
  }
  return <div className={`animate-pulse bg-gray-200 rounded ${className}`} />;
}
