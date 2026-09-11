import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TPipe } from '../../shared/i18n/t.pipe';
import { SS_DIALOG_CONTEXT, SsDialogContext } from '../../shared/ui/dialog.service';

/**
 * Payload for {@link ReasonDialogComponent}. Every field is RAW Georgian — the
 * template renders it through `| t`, so callers must NOT pre-translate.
 */
export interface ReasonDialogData {
  /** Explainer above the textarea. */
  content: string;
  placeholder?: string;
  yes: string;
  destructive?: boolean;
}

/**
 * Reason prompt for moderation actions (ban/flag): a required textarea whose
 * value becomes the audit-trail reason. Emits the trimmed reason; cancel emits
 * nothing (dismissal-compatible, like SsConfirmComponent).
 */
@Component({
  selector: 'app-reason-dialog',
  standalone: true,
  imports: [FormsModule, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4">
      <p class="georgian-text" lang="ka">{{ data.content | t }}</p>
      <label class="ss-field">
        <span class="ss-label georgian-text" lang="ka">{{ 'მიზეზი' | t }}</span>
        <textarea
          automation-id="reason-input"
          class="ss-input reason-area georgian-text"
          lang="ka"
          rows="3"
          maxlength="500"
          [placeholder]="(data.placeholder ?? '') | t"
          [ngModel]="reason()"
          (ngModelChange)="reason.set($event)"
        ></textarea>
      </label>
      <div class="flex justify-end gap-3">
        <button class="ss-btn ss-btn--outline" type="button" (click)="context.completeWith(null)">
          <span class="georgian-text" lang="ka">{{ 'გაუქმება' | t }}</span>
        </button>
        <button
          automation-id="reason-submit"
          [class]="data.destructive ? 'ss-btn ss-btn--danger' : 'ss-btn ss-btn--primary'"
          type="button"
          [disabled]="reason().trim().length < 3"
          (click)="submit()"
        >
          <span class="georgian-text" lang="ka">{{ data.yes | t }}</span>
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .reason-area {
        resize: vertical;
        min-height: 84px;
      }
    `,
  ],
})
export class ReasonDialogComponent {
  protected readonly context = inject(SS_DIALOG_CONTEXT) as SsDialogContext<
    string | null,
    ReasonDialogData
  >;
  protected readonly data: ReasonDialogData = this.context.data ?? {
    content: '',
    yes: 'დადასტურება',
  };
  protected readonly reason = signal('');

  protected submit(): void {
    const value = this.reason().trim();
    if (value.length < 3) return;
    this.context.completeWith(value);
  }
}
