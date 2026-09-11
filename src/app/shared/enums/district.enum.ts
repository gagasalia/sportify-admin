import { liveLabels, tr } from '../i18n/lang';

// RAW Georgian labels — never read directly, see DISTRICT_OPTIONS/_LABELS.
const DISTRICT_OPTIONS_KA: { id: string; name: string }[] = [
  { id: 'Vake', name: 'ვაკე' },
  { id: 'Saburtalo', name: 'საბურთალო' },
  { id: 'Vera', name: 'ვერა' },
  { id: 'Mtatsminda', name: 'მთაწმინდა' },
  { id: 'OldTbilisi', name: 'ძველი თბილისი' },
  { id: 'Chughureti', name: 'ჩუღურეთი' },
  { id: 'Didube', name: 'დიდუბე' },
  { id: 'Nadzaladevi', name: 'ნაძალადევი' },
  { id: 'Gldani', name: 'გლდანი' },
  { id: 'Isani', name: 'ისანი' },
  { id: 'Samgori', name: 'სამგორი' },
  { id: 'Krtsanisi', name: 'კრწანისი' },
  { id: 'Dighomi', name: 'დიღომი' },
  { id: 'Varketili', name: 'ვარკეთილი' },
  { id: 'Ortachala', name: 'ორთაჭალა' },
];

// Canonical Tbilisi district (უბანი) list. The latin `id` is the stored value
// (identical across admin + webapp + api, never translated); `name` is a live
// getter, so the label follows the language toggle on every read.
export const DISTRICT_OPTIONS: { id: string; name: string }[] = DISTRICT_OPTIONS_KA.map(
  ({ id, name }) => ({
    id,
    get name(): string {
      return tr(name);
    },
  }),
);

export const DISTRICT_LABELS: Record<string, string> = liveLabels(
  DISTRICT_OPTIONS_KA.reduce(
    (acc, { id, name }) => {
      acc[id] = name;
      return acc;
    },
    {} as Record<string, string>,
  ),
);
