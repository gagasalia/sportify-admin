import { isEnglish } from './lang';

/**
 * Operator-entered CONTENT (facility / court / tournament names and blurbs) —
 * the admin port of the webapp's `shared/i18n/localized.ts`, so an operator
 * reading the panel in English sees the same strings players do.
 *
 * These are not dictionary lookups: the English text exists only when the
 * operator typed it into the `*En` field, so every helper falls back to the
 * Georgian original. Call them at RENDER time (template expression, `computed`,
 * pipe) — `isEnglish()` reads the language SIGNAL, so a call inside a reactive
 * context re-runs the instant the language flips, while a value baked at
 * construction time goes stale (see the warning in `lang.ts`).
 */
export function localizedText(ka: string | undefined, en: string | undefined): string | undefined {
  return isEnglish() && en ? en : ka;
}

export function localizedName(
  entity: { name?: string; nameEn?: string } | null | undefined,
): string {
  if (!entity) {
    return '';
  }
  return (isEnglish() && entity.nameEn) || entity.name || '';
}

/**
 * Same rule for a court name carried as a SNAPSHOT pair (`courtName` /
 * `courtNameEn`) — booking rows and statistics rows key it that way rather than
 * `name`/`nameEn`. Returns '' when nothing was snapshotted (legacy bookings
 * predate the rename), so callers can branch on the empty string.
 */
export function localizedCourtName(entity: { courtName?: string; courtNameEn?: string }): string {
  return (isEnglish() && entity.courtNameEn) || entity.courtName || '';
}
