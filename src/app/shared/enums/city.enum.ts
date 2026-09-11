import { tr } from '../i18n/lang';

export enum City {
  Tbilisi = 1,
  Tskneti = 2,
}

/** RAW Georgian labels — never read directly, see {@link CITY_OPTIONS}. */
const CITY_OPTIONS_KA: readonly { id: string; name: string }[] = [
  { id: 'Tbilisi', name: 'თბილისი' },
  { id: 'Tskneti', name: 'წყნეთი' },
];

/**
 * Canonical city list — the latin `id` is the stored facility `city` value
 * (sent to the API verbatim, never translated), `name` is the display label:
 * a live getter, so it follows the language toggle on every read.
 */
export const CITY_OPTIONS: readonly { id: string; name: string }[] = CITY_OPTIONS_KA.map(
  ({ id, name }) => ({
    id,
    get name(): string {
      return tr(name);
    },
  }),
);

/** Display label for a stored city value, falling back to the raw value. */
export function cityName(city: string | undefined): string {
  return CITY_OPTIONS.find((c) => c.id === city)?.name ?? city ?? tr('თბილისი');
}
