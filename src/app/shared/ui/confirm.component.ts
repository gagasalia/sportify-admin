import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TPipe } from '../i18n/t.pipe';
import { SS_DIALOG_CONTEXT, SsDialogContext } from './dialog.service';

/** Payload for {@link SsConfirmComponent} — mirrors the old `TuiConfirmData`. */
export interface SsConfirmData {
  content: string;
  yes?: string;
  no?: string;
  appearance?: 'destructive' | (string & {});
}

/**
 * Kit confirm dialog — open via `SsDialogService.open<boolean>(SsConfirmComponent,
 * { label, size: 's', data })`. Yes emits `true`, no emits `false`, dismissal
 * completes without emitting (matching the old `TUI_CONFIRM` semantics).
 *
 * Callers gating a REVERSIBLE UI state (e.g. a switch that must snap back)
 * should treat dismissal as "no": `.pipe(take(1), defaultIfEmpty(false))`.
 *
 * `appearance: 'destructive'` turns the icon and the yes-button red; anything
 * else renders the neutral question icon with a primary yes-button.
 */
@Component({
  selector: 'ss-confirm',
  standalone: true,
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ss-confirm">
      <span class="ss-confirm-ic" [class.ss-confirm-ic--danger]="destructive" aria-hidden="true">
        @if (destructive) {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
        } @else {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
          </svg>
        }
      </span>
      <p class="ss-confirm-msg georgian-text" lang="ka">{{ data.content }}</p>
      <div class="ss-confirm-actions">
        <button class="ss-btn ss-btn--outline" type="button" (click)="context.completeWith(false)">
          <span class="georgian-text" lang="ka">{{ data.no ?? ('არა' | t) }}</span>
        </button>
        <button
          [class]="destructive ? 'ss-btn ss-btn--danger' : 'ss-btn ss-btn--primary'"
          type="button"
          (click)="context.completeWith(true)"
        >
          <span class="georgian-text" lang="ka">{{ data.yes ?? ('დიახ' | t) }}</span>
        </button>
      </div>
    </div>
  `,
})
export class SsConfirmComponent {
  protected readonly context = inject(SS_DIALOG_CONTEXT) as SsDialogContext<boolean, SsConfirmData>;
  protected readonly data: SsConfirmData = this.context.data ?? { content: '' };
  protected readonly destructive = this.data.appearance === 'destructive';
}
