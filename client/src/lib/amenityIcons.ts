import {
    Snowflake, Briefcase, Shirt, Plug, Sparkles, Wind, Users,
    Wine, Waves, Lock, Tv, Trophy, Car, Phone, Check,
    type LucideIcon,
} from 'lucide-react';

// Maps amenity keys -> lucide icons. Falls back to Check in the page.
// Keep in sync with lib/amenityLabels.ts
export const amenityIcons: Record<string, LucideIcon> = {
    airConditioning: Snowflake,
    businessCenter: Briefcase,
    clothingIron: Shirt,
    dataPorts: Plug,
    dryCleaning: Sparkles,
    hairDryer: Wind,
    meetingRooms: Users,
    miniBarInRoom: Wine,
    outdoorPool: Waves,
    safe: Lock,
    tVInRoom: Tv,
    tennisCourt: Trophy,
    valetParking: Car,
    voiceMail: Phone,
};

export const fallbackAmenityIcon = Check;
