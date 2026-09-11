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
import { filter, switchMap, take } from 'rxjs';
import { TournamentService } from '../../services/http-services/tournament.service';
import {
  Tournament,
  TournamentStatus,
} from '../../shared/models/tournament.model';
import { tetriToGel } from '../../shared/utils/money.util';
import {
  CATEGORY_LABELS,
  FORMAT_LABELS,
  LEVEL_LABELS,
  TYPE_LABELS,
  TournamentFormComponent,
} from './tournament-form/tournament-form.component';
import { RegistrationsDialogComponent } from './registrations-dialog.component';

import { liveLabels, tr } from '../../shared/i18n/lang';
import { FacilityNamesService } from '../../shared/i18n/facility-names.service';
import { localizedName } from '../../shared/i18n/localized';
import { TPipe } from '../../shared/i18n/t.pipe';
import { SsToastService } from '../../shared/ui/toast.service';
import { SsDialogService } from '../../shared/ui/dialog.service';
import { SsConfirmComponent, SsConfirmData } from '../../shared/ui/confirm.component';
const STATUS_LABELS: Record<TournamentStatus, string> = liveLabels({
  draft: 'დრაფტი',
  published: 'გამოქვეყნებული',
  completed: 'დასრულებული',
  cancelled: 'გაუქმებული',
});

// Theme-aware ss-badge variants (the old Tailwind color classes broke in dark mode).
const STATUS_CLASSES: Record<TournamentStatus, string> = {
  draft: 'ss-badge ss-badge--neutral',
  published: 'ss-badge ss-badge--positive',
  completed: 'ss-badge ss-badge--info',
  cancelled: 'ss-badge ss-badge--negative',
};

/**
 * Operator tournaments (docs/13 §7): the academy's tournaments in every
 * status, lifecycle actions with confirms (cancelling warns about the
 * automatic fee refunds), the participants dialog and the create/edit form.
 */
@Component({
  selector: 'app-tournaments',
  standalone: true,
  imports: [CommonModule, TPipe],
  templateUrl: './tournaments.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TournamentsComponent implements OnInit {
  private readonly tournamentService = inject(TournamentService);
  private readonly facilityNames = inject(FacilityNamesService);
  private readonly dialogs = inject(SsDialogService);
  private readonly alerts = inject(SsToastService);
    private readonly destroyRef = inject(DestroyRef);

  protected readonly tournaments = signal<Tournament[]>([]);

  /** Operator content: `nameEn` in an English session, Georgian otherwise. */
  protected tournamentLabel(tournament: Tournament): string {
    return localizedName(tournament);
  }

  /** Venue line: the live facility name, falling back to the row snapshot. */
  protected facilityLabel(tournament: Tournament): string {
    return this.facilityNames.label(tournament.facility, tournament.facilityName);
  }

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

  protected onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  private load(): void {
    this.isLoading.set(true);
    this.tournamentService
      .getMyTournaments(this.page(), this.limit)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data, page }) => {
          this.tournaments.set(data);
          this.total.set(page?.total ?? data.length);
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
  }

  protected addTournament(): void {
    this.dialogs
      .open<Tournament | null>(
        TournamentFormComponent,
        {
          label: tr('ტურნირის დამატება'),
          size: 'l',
          dismissible: true,
          closable: true,
          data: {},
        },
      )
      .pipe(take(1))
      .subscribe((result) => {
        if (result) {
          this.load();
          this.alerts
            .open(tr('ტურნირი შეიქმნა (დრაფტი)'), { appearance: 'success' })
            .pipe(take(1))
            .subscribe();
        }
      });
  }

  protected editTournament(tournament: Tournament): void {
    this.dialogs
      .open<Tournament | null>(
        TournamentFormComponent,
        {
          label: tr('ტურნირის რედაქტირება'),
          size: 'l',
          dismissible: true,
          closable: true,
          data: { tournament },
        },
      )
      .pipe(take(1))
      .subscribe((result) => {
        if (result) {
          this.load();
        }
      });
  }

  protected openRegistrations(tournament: Tournament): void {
    this.dialogs
      .open<void>(
        RegistrationsDialogComponent,
        {
          label: `${tr('რეგისტრაციები')} · ${localizedName(tournament)}`,
          size: 'l',
          dismissible: true,
          closable: true,
          data: { tournament },
        },
      )
      .pipe(take(1))
      .subscribe();
  }

  protected publish(tournament: Tournament): void {
    this.confirmThenSetStatus(
      tournament,
      'published',
      tr('ტურნირის გამოქვეყნება'),
      `${tr('გამოვაქვეყნოთ')} „${localizedName(tournament)}"? ${tr('ის ხილული გახდება მოთამაშეებისთვის და გაიხსნება რეგისტრაცია.')}`,
      tr('ტურნირი გამოქვეყნდა'),
    );
  }

  protected complete(tournament: Tournament): void {
    this.confirmThenSetStatus(
      tournament,
      'completed',
      tr('ტურნირის დასრულება'),
      `${tr('დავასრულოთ')} „${localizedName(tournament)}"?`,
      tr('ტურნირი დასრულდა'),
    );
  }

  protected cancel(tournament: Tournament): void {
    this.confirmThenSetStatus(
      tournament,
      'cancelled',
      tr('ტურნირის გაუქმება'),
      `${tr('გავაუქმოთ')} „${localizedName(tournament)}"? ${tr('ბალანსით გადახდილი საფასურები ავტომატურად დაბრუნდება.')}`,
      tr('ტურნირი გაუქმდა — გადახდილი საფასურები დაბრუნდა'),
    );
  }

  protected deleteTournament(tournament: Tournament): void {
    this.dialogs
      .open<boolean>(SsConfirmComponent, {
        label: tr('ტურნირის წაშლა'),
        size: 's',
        data: {
          content: `${tr('ნამდვილად წავშალოთ დრაფტი')} „${localizedName(tournament)}"?`,
          yes: tr('წაშლა'),
          no: tr('გაუქმება'),
        } as SsConfirmData,
      })
      .pipe(
        take(1),
        filter(Boolean),
        switchMap(() => this.tournamentService.deleteTournament(tournament._id)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.tournaments.update((list) =>
            list.filter((t) => t._id !== tournament._id),
          );
          this.alerts
            .open(tr('დრაფტი წაიშალა'), { appearance: 'success' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }

  private confirmThenSetStatus(
    tournament: Tournament,
    status: TournamentStatus,
    label: string,
    content: string,
    successMessage: string,
  ): void {
    this.dialogs
      .open<boolean>(SsConfirmComponent, {
        label,
        size: 's',
        data: { content, yes: tr('დიახ'), no: tr('არა') } as SsConfirmData,
      })
      .pipe(take(1), filter(Boolean))
      .subscribe(() => this.setStatus(tournament, status, successMessage));
  }

  private setStatus(
    tournament: Tournament,
    status: TournamentStatus,
    successMessage: string,
  ): void {
    this.tournamentService
      .setStatus(tournament._id, status)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.tournaments.update((list) =>
            list.map((t) => (t._id === updated._id ? updated : t)),
          );
          this.alerts
            .open(successMessage, { appearance: 'success' })
            .pipe(take(1))
            .subscribe();
        },
      });
  }

  // ─── Display helpers ────────────────────────────────────────────────────────

  protected statusLabel(status: TournamentStatus): string {
    return STATUS_LABELS[status] ?? status;
  }

  protected statusClass(status: TournamentStatus): string {
    return STATUS_CLASSES[status] ?? STATUS_CLASSES.draft;
  }

  protected typeLabel(t: Tournament): string {
    return TYPE_LABELS[t.type] ?? t.type;
  }

  protected formatLabel(t: Tournament): string {
    return FORMAT_LABELS[t.format] ?? t.format;
  }

  protected levelLabel(t: Tournament): string {
    return LEVEL_LABELS[t.level] ?? t.level;
  }

  protected categoryLabel(t: Tournament): string {
    return CATEGORY_LABELS[t.category] ?? t.category;
  }

  protected feeLabel(t: Tournament): string {
    return t.entryFeeTetri === 0 ? tr('უფასო') : `${tetriToGel(t.entryFeeTetri)} ₾`;
  }
}
