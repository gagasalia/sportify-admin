/**
 * Promocode domain models. A promocode is a percent or fixed discount applied
 * at booking time, optionally scoped to one academy (`academy: null` =
 * platform-wide, superadmin-created). Money crosses the wire as integer
 * **tetri** (1 GEL = 100 tetri); the admin UI edits GEL and converts at the
 * edge (`gelToTetri`/`tetriToGel`).
 */

import { liveLabels } from '../i18n/lang';

export type PromoDiscountType = 'percent' | 'fixed';

export type PromoEligibility = 'everyone' | 'first_booking' | 'booking_count_range';

/**
 * The five states the admin list surfaces as a badge. Only `active` is stored
 * (`active: boolean`); the rest derive from the window/limits at render time.
 */
export type PromoDerivedStatus = 'inactive' | 'expired' | 'scheduled' | 'depleted' | 'active';

/** `code` wire format: 3–24 chars, A–Z 0–9 dashes, alphanumeric at both ends. */
export const PROMO_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,22}[A-Z0-9]$/;

// Values stay RAW Georgian — `liveLabels` translates on every read, so a
// language flip re-renders instead of going stale (i18n rule: never bake).
export const ELIGIBILITY_LABELS: Record<PromoEligibility, string> = liveLabels({
  everyone: 'ყველასთვის',
  first_booking: 'პირველი ჯავშნისთვის',
  booking_count_range: 'ჯავშნების რაოდენობით',
});

export const PROMO_STATUS_LABELS: Record<PromoDerivedStatus, string> = liveLabels({
  inactive: 'გამორთული',
  expired: 'ვადაგასული',
  scheduled: 'დაგეგმილი',
  depleted: 'ამოწურული',
  active: 'აქტიური',
});

// Theme-aware ss-badge variants (mirrors the tournaments STATUS_CLASSES map).
export const PROMO_STATUS_CLASSES: Record<PromoDerivedStatus, string> = {
  inactive: 'ss-badge ss-badge--neutral',
  expired: 'ss-badge ss-badge--negative',
  scheduled: 'ss-badge ss-badge--info',
  depleted: 'ss-badge ss-badge--warning',
  active: 'ss-badge ss-badge--positive',
};

/** A promocode row as returned by `GET /promocodes` (admin academy-scoped). */
export interface Promocode {
  _id: string;
  /** Owning academy id, or `null`/absent for a platform-wide code. */
  academy?: string | null;
  academyName?: string;
  code: string;
  name?: string;
  discountType: PromoDiscountType;
  percentOff?: number;
  amountTetri?: number;
  maxDiscountTetri?: number;
  minPriceTetri?: number;
  eligibility: PromoEligibility;
  minBookings?: number;
  maxBookings?: number;
  startsAt?: string;
  /** Date-only values are treated by the server as END of that day. */
  expiresAt?: string;
  usageLimitTotal?: number;
  usageLimitPerUser?: number;
  usedCount: number;
  active: boolean;
  createdAt?: string;
}

/** The populated `user` of a redemption row (deleted accounts come as null). */
export interface PromoRedemptionUser {
  _id: string;
  /** Public numeric member ID (absent on legacy docs). */
  memberId?: number;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

/** One redemption as returned by `GET /promocodes/:id/redemptions`. */
export interface PromoRedemption {
  _id: string;
  promo: string;
  code: string;
  user: PromoRedemptionUser | string | null;
  booking: string;
  discountTetri: number;
  priceTetri: number;
  createdAt: string;
}

/** `POST /promocodes` body. Money is integer tetri; `academyId` is superadmin-only. */
export interface CreatePromocodeDto {
  code: string;
  name?: string;
  discountType: PromoDiscountType;
  /** 1–100; required for `discountType: 'percent'`. */
  percentOff?: number;
  /** Required for `discountType: 'fixed'`. */
  amountTetri?: number;
  maxDiscountTetri?: number;
  minPriceTetri?: number;
  eligibility?: PromoEligibility;
  /** Required for `eligibility: 'booking_count_range'`. */
  minBookings?: number;
  maxBookings?: number;
  startsAt?: string;
  expiresAt?: string;
  usageLimitTotal?: number;
  usageLimitPerUser?: number;
  active?: boolean;
  /** Superadmin only; omitted = platform-wide code. Admins must not send it. */
  academyId?: string;
}

/**
 * `PATCH /promocodes/:id` body — all optional; an explicit `null` clears an
 * optional bound server-side (omitting a key leaves it untouched).
 */
export interface UpdatePromocodeDto {
  name?: string | null;
  discountType?: PromoDiscountType;
  percentOff?: number | null;
  amountTetri?: number | null;
  maxDiscountTetri?: number | null;
  minPriceTetri?: number | null;
  eligibility?: PromoEligibility;
  minBookings?: number | null;
  maxBookings?: number | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  usageLimitTotal?: number | null;
  usageLimitPerUser?: number | null;
  active?: boolean;
}
