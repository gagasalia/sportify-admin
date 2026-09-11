import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, take } from 'rxjs';
import { MatchService } from '../../services/http-services/match.service';
import {
  AdminMatch,
  MatchCategory,
  MatchLevel,
  MatchStatus,
  MatchVisibility,
} from '../../shared/models/match.model';
import { tetriToGel } from '../../shared/utils/money.util';
import { MatchPlayersDialogComponent } from './match-players-dialog.component';

import { liveLabels, tr } from '../../shared/i18n/lang';
import { TPipe } from '../../shared/i18n/t.pipe';
import { FacilityNamesService } from '../../shared/i18n/facility-names.service';
import { SsToastService } from '../../shared/ui/toast.service';
import { SsDialogService } from '../../shared/ui/dialog.service';
import { SsConfirmComponent, SsConfirmData } from '../../shared/ui/confirm.component';
const STATUS_LABELS: Record<MatchStatus, string> = liveLabels({
  open: 'ღია',
  cancelled: 'გაუქმებული',
});
const STATUS_CLASSES: Record<MatchStatus, string> = {
  open: 'ss-badge ss-badge--positive',
  cancelled: 'ss-badge ss-badge--negative',
};
const VISIBILITY_LABELS: Record<MatchVisibility, string> = liveLabels({
  public: 'საჯარო',
  private: 'პრივატული',
});
const LEVEL_LABELS: Record<MatchLevel, string> = liveLabels({
  any: 'ნებისმიერი',
  beginner: 'დამწყები',
  intermediate: 'საშუალო',
  advanced: 'გამოცდილი',
});
const CATEGORY_LABELS: Record<MatchCategory, string> = liveLabels({
  men: 'კაცები',
  women: 'ქალები',
  mixed: 'შერეული',
});

/**
 * Operator moderation of player-organized matches (docs/15 §5): read-only
 * list of matches hosted at the academy's venues, the full membership dialog
 * (contacts included) and the moderation cancel. Matches are USER-generated —
 * operators don't create or edit them.
 */
@Component({
  selector: 'app-matches',
  standalone: true,
  imports: [CommonModule, TPipe],
  templateUrl: './matches.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MatchesComponent implements OnInit {
  private readonly matchService = inject(MatchService);
  private readonly facilityNames = inject(FacilityNamesService);
  private readonly dialogs = inject(SsDialogService);
  private readonly alerts = inject(SsToastService);
    private readonly destroyRef = inject(DestroyRef);

  protected readonly matches = signal<AdminMatch[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly isMobile = signal(window.innerWidth <= 768);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly limit = 20;
  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.limit)),
  );

  @HostListener('window:resize')
  protected onResize(): void {
    this.isMobile.set(window.innerWidth <= 768);
  }

  ngOnInit(): void {
    this.facilityNames.ensure();
    this.load();
  }

  /**
   * Match rows carry a Georgian `facilityName` snapshot; resolve it to the
   * operator's English name when the facility is still around.
   */
  protected facilityLabel(match: { facility?: string; facilityName?: string }): string {
    return this.facilityNames.label(match.facility, match.facilityName);
  }

  protected onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  private load(): void {
    this.isLoading.set(true);
    this.matchService
      .getMatches({ page: this.page(), limit: this.limit })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data, page }) => {
          this.matches.set(data);
          this.total.set(page?.total ?? data.length);
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
  }

  protected openPlayers(match: AdminMatch): void {
    this.dialogs
      .open<void>(
        MatchPlayersDialogComponent,
        {
          label: `${tr('მოთამაშეები')} · ${this.facilityLabel(match)} ${match.date} ${match.startTime}`,
          size: 'l',
          dismissible: true,
          closable: true,
          data: { match },
        },
      )
      .pipe(take(1))
      .subscribe();
  }

  protected cancel(match: AdminMatch): void {
    this.dialogs
      .open<boolean>(SsConfirmComponent, {
        label: tr('თამაშის გაუქმება'),
        size: 's',
        data: {
          content: `${tr('გავაუქმოთ')} ${match.date} ${match.startTime} ${tr('თამაში')} (${this.facilityLabel(match)})? ${tr('მოთამაშეები დაინახავენ რომ ადმინისტრაციამ გააუქმა.')}`,
          yes: tr('გაუქმება'),
          no: tr('არა'),
        } as SsConfirmData,
      })
      .pipe(take(1), filter(Boolean))
      .subscribe(() => {
        this.matchService
          .cancelMatch(match._id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (updated) => {
              this.matches.update((list) =>
                list.map((m) => (m._id === updated._id ? updated : m)),
              );
              this.alerts
                .open(tr('თამაში გაუქმდა'), { appearance: 'success' })
                .pipe(take(1))
                .subscribe();
            },
          });
      });
  }

  // ─── Display helpers ────────────────────────────────────────────────────────

  protected statusLabel(status: MatchStatus): string {
    return STATUS_LABELS[status] ?? status;
  }

  protected statusClass(status: MatchStatus): string {
    return STATUS_CLASSES[status] ?? STATUS_CLASSES.open;
  }

  protected visibilityLabel(m: AdminMatch): string {
    return VISIBILITY_LABELS[m.visibility] ?? m.visibility;
  }

  protected levelLabel(m: AdminMatch): string {
    return LEVEL_LABELS[m.level] ?? m.level;
  }

  protected categoryLabel(m: AdminMatch): string {
    return CATEGORY_LABELS[m.category] ?? m.category;
  }

  protected priceLabel(m: AdminMatch): string {
    if (m.pricePerPlayerTetri == null) {
      return '—';
    }
    return m.pricePerPlayerTetri === 0
      ? tr('უფასო')
      : `${tetriToGel(m.pricePerPlayerTetri)} ${tr('₾/კაცი')}`;
  }
}
