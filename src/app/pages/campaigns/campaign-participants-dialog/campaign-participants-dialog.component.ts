import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { take } from 'rxjs';
import { CampaignService } from '../../../services/http-services/campaign.service';
import {
  Campaign,
  CampaignParticipant,
  PROGRESS_STATUS_CLASSES,
  PROGRESS_STATUS_LABELS,
} from '../../../shared/models/campaign.model';
import { tetriToGel } from '../../../shared/utils/money.util';
import { formatMemberId } from '../../../shared/utils/member-id.util';
import { TPipe } from '../../../shared/i18n/t.pipe';
import { SS_DIALOG_CONTEXT, SsDialogContext } from '../../../shared/ui/dialog.service';

/**
 * Participants of one campaign — a paged, read-only table of who is running
 * it, how far they got, when their window closes and which voucher they won.
 * Amounts render in GEL (wire is tetri).
 */
@Component({
  selector: 'app-campaign-participants-dialog',
  standalone: true,
  imports: [CommonModule, TPipe],
  templateUrl: './campaign-participants-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CampaignParticipantsDialogComponent implements OnInit {
  private readonly context = inject(SS_DIALOG_CONTEXT) as SsDialogContext<
    void,
    { campaign: Campaign }
  >;
  private readonly campaignService = inject(CampaignService);

  protected readonly participants = signal<CampaignParticipant[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly limit = 20;
  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.limit)),
  );

  protected get campaign(): Campaign {
    return this.context.data.campaign;
  }

  ngOnInit(): void {
    this.load();
  }

  protected onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  private load(): void {
    this.isLoading.set(true);
    this.campaignService
      .getParticipants(this.campaign._id, this.page(), this.limit)
      .pipe(take(1))
      .subscribe({
        next: ({ data, page }) => {
          this.participants.set(data);
          this.total.set(page?.total ?? data.length);
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
  }

  // ── display helpers ────────────────────────────────────────────────────────

  /** 'First Last' of the populated user, or the phone / a dash as fallback. */
  protected userName(p: CampaignParticipant): string {
    return p.userName?.trim() || p.userPhone || '—';
  }

  /** 'ID 000059 · +995…' — the member id first, matching the other tables. */
  protected userPhone(p: CampaignParticipant): string | null {
    const id = formatMemberId(p.userMemberId);
    const phone = p.userPhone ?? null;
    if (id) return phone ? `ID ${id} · ${phone}` : `ID ${id}`;
    return phone;
  }

  /** '3 / 5' or '180 / 300 ₾' — progress in the campaign's own unit. */
  protected progressLabel(p: CampaignParticipant): string {
    return this.campaign.goalType === 'spend'
      ? `${tetriToGel(p.current)} / ${tetriToGel(p.target)} ₾`
      : `${p.current} / ${p.target}`;
  }

  /** 0–100, clamped — drives the inline bar width. */
  protected progressPercent(p: CampaignParticipant): number {
    if (!p.target) return 0;
    return Math.max(0, Math.min(100, Math.round((p.current / p.target) * 100)));
  }

  protected statusLabel(p: CampaignParticipant): string {
    return PROGRESS_STATUS_LABELS[p.status] ?? p.status;
  }

  protected statusClass(p: CampaignParticipant): string {
    return PROGRESS_STATUS_CLASSES[p.status] ?? PROGRESS_STATUS_CLASSES.expired;
  }
}
