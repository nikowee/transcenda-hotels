import { useNavigate, useSearchParams } from 'react-router';

export default function CompactSearchBar() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const destName = searchParams.get('name');
  const checkIn = searchParams.get('in');
  const checkOut = searchParams.get('out');
  const guests = searchParams.get('guests');

  // If no search params are present, don't render anything
  if (!checkIn || !checkOut || !guests) return null;

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const label = [
    destName ? `📍 ${destName}` : null,
    checkIn && checkOut ? `${formatDate(checkIn)} - ${formatDate(checkOut)}` : null,
    `👤 ${guests} ${Number(guests) === 1 ? 'guest' : 'guests'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      onClick={() => navigate('/')}
      className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/20 cursor-pointer"
    >
      <span className="truncate max-w-[260px] sm:max-w-[400px]">{label}</span>
    </button>
  );
}