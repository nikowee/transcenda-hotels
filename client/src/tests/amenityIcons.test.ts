import { describe, it, expect } from 'vitest';
import { amenityIcons, fallbackAmenityIcon } from '../lib/amenityIcons';
import { amenityLabels } from '../lib/amenityLabels';

describe('amenityIcons', () => {
    it('provides an icon for every labelled amenity', () => {
        const missing = Object.keys(amenityLabels).filter((key) => !amenityIcons[key]);

        expect(missing).toEqual([]);
    });

    it('exposes a fallback icon for unmapped amenity keys', () => {
        expect(fallbackAmenityIcon).toBeDefined();
        expect(amenityIcons['someUnknownAmenity']).toBeUndefined();
    });

    it('maps every key to a renderable component', () => {
        for (const [key, Icon] of Object.entries(amenityIcons)) {
            expect(Icon, `icon for ${key}`).toBeDefined();
            expect(['function', 'object'], `icon for ${key}`).toContain(typeof Icon);
        }
    });
});
