/**
 * Campaign domain models (docs/24 v2). A campaign is a loyalty challenge —
 * "do N at these venues before the end date → get a Z ₾ voucher". Money
 * crosses the wire as integer **tetri** (1 GEL = 100 tetri); the admin UI
 * edits GEL and converts at the edge (`gelToTetri`/`tetriToGel`).
 *
 * A campaign stores NO copy and NO icon: every player-facing sentence is
 * generated from the terms (this UI previews exactly that sentence), and the
 * badge is always the gift. `endsAt` is THE deadline shared by every player;
 * absent = none (runs until deactivated). Deactivating stops NEW entrants —
 * players already mid-run keep advancing and can still collect.
 *
 * `academy: null` = platform-wide (superadmin-created). `facilities: []` =
 * every facility of the academy.
 */

import { liveLabels } from '../i18n/lang';

/** What the player accumulates: paid bookings, or gross tetri spent. */
export type CampaignGoalType = 'bookings' | 'spend';

/**
 * The four states the admin list surfaces as a badge. Only `active` is stored;
 * the rest derive from the publication window at render time.
 */
export type CampaignDerivedStatus = 'inactive' | 'expired' | 'scheduled' | 'live';

/** One player's run, as the participants table shows it. */
export type CampaignProgressStatus = 'in_progress' | 'completed' | 'expired';

// Label maps keep RAW Georgian values and go through `liveLabels` so every
// read translates on the live language (never baked at import time).
export const GOAL_TYPE_LABELS: Record<CampaignGoalType, string> = liveLabels({
  bookings: 'ჯავშნები',
  spend: 'დახარჯული თანხა',
});

export const CAMPAIGN_STATUS_LABELS: Record<CampaignDerivedStatus, string> = liveLabels({
  inactive: 'გამორთული',
  expired: 'ვადაგასული',
  scheduled: 'დაგეგმილი',
  live: 'აქტიური',
});

// Theme-aware ss-badge variants (mirrors the promocodes STATUS_CLASSES map).
export const CAMPAIGN_STATUS_CLASSES: Record<CampaignDerivedStatus, string> = {
  inactive: 'ss-badge ss-badge--neutral',
  expired: 'ss-badge ss-badge--negative',
  scheduled: 'ss-badge ss-badge--info',
  live: 'ss-badge ss-badge--positive',
};

export const PROGRESS_STATUS_LABELS: Record<CampaignProgressStatus, string> = liveLabels({
  in_progress: 'მიმდინარე',
  completed: 'დასრულებული',
  expired: 'ვადაგასული',
});

export const PROGRESS_STATUS_CLASSES: Record<CampaignProgressStatus, string> = {
  in_progress: 'ss-badge ss-badge--info',
  completed: 'ss-badge ss-badge--positive',
  expired: 'ss-badge ss-badge--neutral',
};

/** A campaign row as returned by `GET /campaigns` (admin academy-scoped). */
export interface Campaign {
  _id: string;
  /** Owning academy id, or `null`/absent for a platform-wide campaign. */
  academy?: string | null;
  academyName?: string;
  /** Empty = every facility of the academy. */
  facilities: string[];
  facilityNames: string[];
  goalType: CampaignGoalType;
  /** A COUNT for `bookings`, integer TETRI for `spend`. */
  goalTarget: number;
  rewardTetri: number;
  rewardValidDays?: number;
  /** null = unlimited repeats. */
  maxCompletionsPerUser?: number | null;
  startsAt?: string;
  /** THE shared player deadline (END of a date-only day); absent = none. */
  endsAt?: string;
  active: boolean;
  enrolledCount: number;
  completedCount: number;
  createdAt?: string;
}

/** The populated `user` of a participant row (deleted accounts come as null). */
export interface CampaignParticipantUser {
  _id: string;
  memberId?: number;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

/** One row of `GET /campaigns/:id/participants`. */
export interface CampaignParticipant {
  _id: string;
  campaign: string;
  user: CampaignParticipantUser | string | null;
  /** Flattened by the server so the table needs no client-side join. */
  userMemberId?: number;
  userName?: string;
  userPhone?: string;
  cycle: number;
  windowStartsAt: string;
  /** Deadline snapshot at cycle open; the live one is the campaign's endsAt. */
  windowEndsAt?: string;
  bookingsCount: number;
  spentTetri: number;
  contributionsCount: number;
  /** Count or tetri, matching the campaign's goalType. */
  current: number;
  target: number;
  status: CampaignProgressStatus;
  completedAt?: string;
  voucherCode?: string;
  createdAt: string;
}

/** `POST /campaigns` body. Money is integer tetri; `academyId` superadmin-only. */
export interface CreateCampaignDto {
  goalType: CampaignGoalType;
  goalTarget: number;
  rewardTetri: number;
  rewardValidDays?: number;
  maxCompletionsPerUser?: number | null;
  /** Omit/empty = every facility of the academy. */
  facilityIds?: string[];
  startsAt?: string;
  /** THE shared player deadline; omit = none. */
  endsAt?: string;
  active?: boolean;
  /** Superadmin only; omitted = platform-wide. Admins must not send it. */
  academyId?: string;
}

/**
 * `PATCH /campaigns/:id` body — all optional; an explicit `null` clears an
 * optional field. The TERMS (goalType/goalTarget/rewardTetri) are refused
 * with a 409 once anyone has joined; `endsAt` stays editable.
 */
export interface UpdateCampaignDto {
  goalType?: CampaignGoalType;
  goalTarget?: number;
  rewardTetri?: number;
  rewardValidDays?: number | null;
  maxCompletionsPerUser?: number | null;
  facilityIds?: string[];
  startsAt?: string | null;
  endsAt?: string | null;
  active?: boolean;
}
