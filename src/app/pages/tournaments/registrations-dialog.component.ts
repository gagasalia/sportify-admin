import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { take } from 'rxjs';
import { TournamentService } from '../../services/http-services/tournament.service';
import {
  Tournament,
  TournamentRegistration,
} from '../../shared/models/tournament.model';

import { liveLabels } from '../../shared/i18n/lang';
import { TPipe } from '../../shared/i18n/t.pipe';
import { SS_DIALOG_CONTEXT, SsDialogContext } from '../../shared/ui/dialog.service';
import { SsAvatarComponent } from '../../shared/ui/ss-avatar.component';
import { formatMemberId } from '../../shared/utils/member-id.util';
const PAYMENT_LABELS: Record<string, string> = liveLabels({
  pay_at_venue: 'ადგილზე',
  paid: 'გადახდილი',
  refunded: 'დაბრუნებული',
});

/** Participant list for one tournament — snapshots, so no user joins. */
@Component({
  selector: 'app-registrations-dialog',
  standalone: true,
  imports: [CommonModule, DatePipe, SsAvatarComponent, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="max-h-[70vh] overflow-y-auto">
      @if (isLoading()) {
        <p class="py-8 text-center georgian-text" lang="ka">{{ 'იტვირთება...' | t }}</p>
      } @else if (registrations().length === 0) {
        <p class="py-8 text-center georgian-text" lang="ka" data-testid="regs-empty">
          {{ 'რეგისტრაციები ჯერ არ არის' | t }}
        </p>
      } @else {
        <ul class="m-0 p-0 list-none" data-testid="regs-list">
          @for (reg of registrations(); track reg._id) {
            <li
              class="py-3 flex items-center gap-3 border-b last:border-b-0"
              style="border-color: var(--tui-border-normal)"
              [class.opacity-50]="reg.status === 'cancelled'"
            >
              <ss-avatar [name]="reg.playerName" [url]="reg.playerAvatar" [size]="36" />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">
                  {{ reg.playerName || reg.playerEmail || '—' }}
                  @if (reg.partnerName) {
                    <span class="georgian-text" lang="ka"> + {{ reg.partnerName }}</span>
                  }
                </div>
                <div class="text-xs truncate" style="color: var(--tui-text-secondary)">
                  @if (memberIdOf(reg)) { ID {{ memberIdOf(reg) }} · }
                  {{ reg.playerEmail }} @if (reg.playerPhone) { · {{ reg.playerPhone }} }
                  · {{ reg.createdAt | date: 'dd/MM/yyyy HH:mm' }}
                </div>
              </div>
              <span
                class="georgian-text"
                lang="ka"
                [class]="
                  reg.status === 'cancelled'
                    ? 'ss-badge ss-badge--negative'
                    : reg.paymentStatus === 'paid'
                      ? 'ss-badge ss-badge--positive'
                      : 'ss-badge ss-badge--info'
                "
              >
                {{ reg.status === 'cancelled' ? ('გაუქმებული' | t) : paymentLabel(reg) }}
              </span>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class RegistrationsDialogComponent implements OnInit {
  private readonly context = inject(SS_DIALOG_CONTEXT) as SsDialogContext<
    void,
    { tournament: Tournament }
  >;
  private readonly tournamentService = inject(TournamentService);

  protected readonly registrations = signal<TournamentRegistration[]>([]);
  protected readonly isLoading = signal(true);

  ngOnInit(): void {
    this.tournamentService
      .getRegistrations(this.context.data.tournament._id)
      .pipe(take(1))
      .subscribe({
        next: (regs) => {
          this.registrations.set(regs);
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
  }

  protected paymentLabel(reg: TournamentRegistration): string {
    return PAYMENT_LABELS[reg.paymentStatus] ?? reg.paymentStatus;
  }

  /** Snapshotted public member ID ("000042"); '' on legacy registrations. */
  protected memberIdOf(reg: TournamentRegistration): string {
    return formatMemberId(reg.playerMemberId);
  }
}
