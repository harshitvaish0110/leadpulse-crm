export default function Avatar({ firstName = '', lastName = '', size = 'md', src }) {
  const initials = `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase();
  const colours = ['bg-indigo-500','bg-purple-500','bg-pink-500','bg-red-500','bg-orange-500','bg-amber-500','bg-green-500','bg-teal-500'];
  const colourIndex = (firstName.charCodeAt(0) || 0) % colours.length;
  const sizes = { xs: 'w-6 h-6 text-xs', sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-12 h-12 text-base' };

  if (src) return <img src={src} className={`${sizes[size]} rounded-full object-cover`} alt={initials} />;

  return (
    <div className={`${sizes[size]} ${colours[colourIndex]} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0`}>
      {initials}
    </div>
  );
}
