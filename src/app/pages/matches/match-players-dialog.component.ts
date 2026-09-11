import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { take } from 'rxjs';
import { MatchService } from '../../services/http-services/match.service';
import {
  AdminMatch,
  AdminMatchPlayer,
  MatchPlayerStatus,
} from '../../shared/models/match.model';

import { liveLabels } from '../../shared/i18n/lang';
import { TPipe } from '../../shared/i18n/t.pipe';
import { SS_DIALOG_CONTEXT, SsDialogContext } from '../../shared/ui/dialog.service';
import { SsAvatarComponent } from '../../shared/ui/ss-avatar.component';
import { formatMemberId } from '../../shared/utils/member-id.util';
const STATUS_LABELS: Record<MatchPlayerStatus, string> = liveLabels({
  joined: 'შეერთებული',
  left: 'გავიდა',
  removed: 'მოხსნილი',
});

const STATUS_CLASSES: Record<MatchPlayerStatus, string> = {
  joined: 'ss-badge ss-badge--positive',
  left: 'ss-badge ss-badge--neutral',
  removed: 'ss-badge ss-badge--negative',
};

/** Every membership row of one match — snapshots incl. contacts. */
@Component({
  selector: 'app-match-players-dialog',
  standalone: true,
  imports: [CommonModule, DatePipe, SsAvatarComponent, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="max-h-[70vh] overflow-y-auto">
      @if (isLoading()) {
        <p class="py-8 text-center georgian-text" lang="ka">{{ 'იტვირთება...' | t }}</p>
      } @else if (players().length === 0) {
        <p class="py-8 text-center georgian-text" lang="ka" data-testid="players-empty">
          {{ 'მოთამაშეები არ არიან' | t }}
        </p>
      } @else {
        <ul class="m-0 p-0 list-none" data-testid="players-list">
          @for (p of players(); track p._id) {
            <li
              class="py-3 flex items-center gap-3 border-b last:border-b-0"
              style="border-color: var(--tui-border-normal)"
              [class.opacity-50]="p.status !== 'joined'"
            >
              <ss-avatar [name]="p.playerName" [url]="p.playerAvatar" [size]="36" />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">
                  {{ p.playerName || p.playerEmail || '—' }}
                  @if (p.role === 'owner') {
                    <span
                      class="ml-1 ss-badge ss-badge--accent georgian-text"
                      lang="ka"
                      >{{ 'ორგანიზატორი' | t }}</span
                    >
                  }
                </div>
                <div class="text-xs truncate" style="color: var(--tui-text-secondary)">
                  @if (memberIdOf(p)) { ID {{ memberIdOf(p) }} · }
                  {{ p.playerEmail }} @if (p.playerPhone) { · {{ p.playerPhone }} } ·
                  {{ p.createdAt | date: 'dd/MM/yyyy HH:mm' }}
                </div>
              </div>
              <span
                class="georgian-text"
                lang="ka"
                [class]="statusClass(p.status)"
              >
                {{ statusLabel(p.status) }}
              </span>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class MatchPlayersDialogComponent implements OnInit {
  private readonly context = inject(SS_DIALOG_CONTEXT) as SsDialogContext<
    void,
    { match: AdminMatch }
  >;
  private readonly matchService = inject(MatchService);

  protected readonly players = signal<AdminMatchPlayer[]>([]);
  protected readonly isLoading = signal(true);

  ngOnInit(): void {
    this.matchService
      .getPlayers(this.context.data.match._id)
      .pipe(take(1))
      .subscribe({
        next: (players) => {
          this.players.set(players);
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
  }

  protected statusLabel(status: MatchPlayerStatus): string {
    return STATUS_LABELS[status] ?? status;
  }

  protected statusClass(status: MatchPlayerStatus): string {
    return STATUS_CLASSES[status] ?? STATUS_CLASSES.joined;
  }

  /** Snapshotted public member ID ("000042"); '' on legacy rows. */
  protected memberIdOf(p: AdminMatchPlayer): string {
    return formatMemberId(p.playerMemberId);
  }
}
