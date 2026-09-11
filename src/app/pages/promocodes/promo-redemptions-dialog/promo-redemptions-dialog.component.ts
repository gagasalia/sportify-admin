import { CommonModule, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { take } from 'rxjs';
import { PromocodeService } from '../../../services/http-services/promocode.service';
import { PromoRedemption, Promocode } from '../../../shared/models/promocode.model';
import { tetriToGel } from '../../../shared/utils/money.util';
import { formatMemberId } from '../../../shared/utils/member-id.util';
import { TPipe } from '../../../shared/i18n/t.pipe';
import { SS_DIALOG_CONTEXT, SsDialogContext } from '../../../shared/ui/dialog.service';

/**
 * Redemptions of one promocode — a paged, read-only table of who used the
 * code, when, and for how much. Amounts render in GEL (wire is tetri).
 */
@Component({
  selector: 'app-promo-redemptions-dialog',
  standalone: true,
  imports: [CommonModule, DatePipe, TPipe],
  templateUrl: './promo-redemptions-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromoRedemptionsDialogComponent implements OnInit {
  private readonly context = inject(SS_DIALOG_CONTEXT) as SsDialogContext<
    void,
    { promocode: Promocode }
  >;
  private readonly promocodeService = inject(PromocodeService);

  protected readonly redemptions = signal<PromoRedemption[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly limit = 20;
  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.limit)),
  );

  ngOnInit(): void {
    this.load();
  }

  protected onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  private load(): void {
    this.isLoading.set(true);
    this.promocodeService
      .getRedemptions(this.context.data.promocode._id, this.page(), this.limit)
      .pipe(take(1))
      .subscribe({
        next: ({ data, page }) => {
          this.redemptions.set(data);
          this.total.set(page?.total ?? data.length);
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
  }

  // ── display helpers ────────────────────────────────────────────────────────

  /** 'First Last' of the populated user, or a dash for unpopulated/deleted. */
  protected userName(r: PromoRedemption): string {
    const user = r.user;
    if (!user || typeof user === 'string') return '—';
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
    return name || user.phone || '—';
  }

  protected userPhone(r: PromoRedemption): string | null {
    const user = r.user;
    if (!user || typeof user === 'string') return null;
    // Prefix the phone with the public member ID once the API backfill served it.
    const id = formatMemberId(user.memberId);
    const phone = user.phone ?? null;
    if (id) return phone ? `ID ${id} · ${phone}` : `ID ${id}`;
    return phone;
  }

  protected discountGel(r: PromoRedemption): number {
    return tetriToGel(r.discountTetri);
  }

  protected priceGel(r: PromoRedemption): number {
    return tetriToGel(r.priceTetri);
  }
}
