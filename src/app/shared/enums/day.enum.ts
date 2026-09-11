import { liveLabels } from '../i18n/lang';

export enum Day {
  Monday = 0,
  Tuesday = 1,
  Wednesday = 2,
  Thursday = 3,
  Friday = 4,
  Saturday = 5,
  Sunday = 6,
}

/** Labels stay RAW Georgian; `liveLabels` translates on every read. */
export const DAY_LABELS: Record<Day, string> = liveLabels({
  [Day.Monday]: 'ორშაბათი',
  [Day.Tuesday]: 'სამშაბათი',
  [Day.Wednesday]: 'ოთხშაბათი',
  [Day.Thursday]: 'ხუთშაბათი',
  [Day.Friday]: 'პარასკევი',
  [Day.Saturday]: 'შაბათი',
  [Day.Sunday]: 'კვირა',
});

export const DAY_SHORT_LABELS: Record<Day, string> = liveLabels({
  [Day.Monday]: 'ორშ',
  [Day.Tuesday]: 'სამ',
  [Day.Wednesday]: 'ოთხ',
  [Day.Thursday]: 'ხუთ',
  [Day.Friday]: 'პარ',
  [Day.Saturday]: 'შაბ',
  [Day.Sunday]: 'კვი',
});
