import { useState } from 'react';
import { Star, MapPin } from 'lucide-react';
import type { Hotel } from '../../types';


interface HotelCardProps {
  hotel: Hotel;
  onSelect: () => void;
}

// Helper: Get star rating display
const renderStars = (rating: number) => {
  return Array.from({ length: 5 }, (_, i) => (
    <Star
      key={i}
      className={`h-4 w-4 ${
        i < rating ? 'fill-yellow-400 text-yellow-400' : 'text-slate-300'
      }`}
    />
  ));
};

export default function HotelCard({ hotel, onSelect }: HotelCardProps) {
  const [imageError, setImageError] = useState(false);

  // Fallback placeholder image if the hotel does not provide images or if the image fails to load. 
  const imageUrl = hotel.images.length > 0 && !imageError ? hotel.images[0] : '/placeholder-hotel.jpg';

  return (
    <div className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      <div className="flex flex-col md:flex-row">
        {/* ── Image ── */}
        <div className="md:w-48 h-48 md:h-auto flex-shrink-0 bg-slate-100">
          <img
            src={imageUrl}
            alt={hotel.name}
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
            loading="lazy"
          />
        </div>

        {/* ── Content ── */}
        <div className="flex-1 p-4 flex flex-col">
          <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-2">
            <div>
              {/* Hotel name */}
              <h3 className="text-lg font-semibold text-slate-800">
                {hotel.name}
              </h3>

              {/* Address */}
              <div className="flex items-center gap-1 text-sm text-slate-500 mt-1">
                <MapPin className="h-4 w-4" />
                <span>{hotel.address || 'Location not available'}</span>
              </div>

              {/* Star rating */}
              <div className="flex items-center gap-1 mt-1">
                {renderStars(hotel.rating)}
                <span className="text-sm text-slate-500 ml-1">
                  ({hotel.rating})
                </span>
              </div>

              {/* Categories */}
              {hotel.categories.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {hotel.categories.map((category) => (
                    <span
                      key={category}
                      className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full"
                    >
                      {category}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* ── Price and Select ── */}
            <div className="flex flex-col items-end justify-between min-w-[140px]">
              <div className="text-right">
                <span className="text-2xl font-bold text-blue-600">
                  ${hotel.price}
                </span>
                <span className="text-sm text-slate-400"> / night</span>
              </div>
              <button
                onClick={onSelect}
                className="mt-2 w-full px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium"
              >
                Select Hotel →
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}