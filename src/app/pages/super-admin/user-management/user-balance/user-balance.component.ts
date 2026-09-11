import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, take } from 'rxjs';
import { WalletAdminService } from '../../../../services/http-services/wallet-admin.service';
import { User } from '../../../../shared/models/user.model';
import {
  WalletTransaction,
  WalletTransactionType,
} from '../../../../shared/models/wallet.model';
import { gelToTetri, tetriToGel } from '../../../../shared/utils/money.util';
import { formatMemberId } from '../../../../shared/utils/member-id.util';
import { liveLabels, tr } from '../../../../shared/i18n/lang';
import { TPipe } from '../../../../shared/i18n/t.pipe';

import {
  SS_DIALOG_CONTEXT,
  SsDialogContext,
  SsDialogService,
} from '../../../../shared/ui/dialog.service';
import { SsToastService } from '../../../../shared/ui/toast.service';
import { SsConfirmComponent, SsConfirmData } from '../../../../shared/ui/confirm.component';
/**
 * Ledger row types → RAW-Georgian titles, read through `liveLabels` so every
 * lookup translates on the live language (never bake a translation into a const).
 */
const TX_TYPE_LABELS: Record<WalletTransactionType, string> = liveLabels({
  topup: 'შევსება (ბარათით)',
  admin_credit: 'დარიცხვა (ადმინი)',
  admin_debit: 'ჩამოჭრა (ადმინი)',
  booking_payment: 'ჯავშნის გადახდა',
  refund: 'თანხის დაბრუნება',
});

const TX_PAGE_SIZE = 10;

/**
 * Superadmin balance dialog for one user: current balance, manual add/remove
 * with a mandatory reason (both land in the user's ledger), and the paged
 * transaction history. Opened from the user-management list, which is already
 * superadmin-gated (route guard + server-side @Roles).
 */
@Component({
  selector: 'app-user-balance',
  standalone: true,
  imports: [CommonModule, DatePipe, ReactiveFormsModule, TPipe],
  templateUrl: './user-balance.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserBalanceComponent implements OnInit {
  private readonly context = inject(SS_DIALOG_CONTEXT) as SsDialogContext<
    void,
    { user: User }
  >;
  private readonly walletService = inject(WalletAdminService);
  private readonly dialogs = inject(SsDialogService);
  private readonly alerts = inject(SsToastService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly balanceTetri = signal<number | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);

  protected readonly transactions = signal<WalletTransaction[]>([]);
  protected readonly txLoading = signal(false);
  protected readonly txTotal = signal(0);
  private txPage = 0;

  protected readonly balanceGel = computed(() => {
    const b = this.balanceTetri();
    return b == null ? '—' : String(tetriToGel(b));
  });
  protected readonly hasMoreTx = computed(
    () => this.transactions().length < this.txTotal(),
  );

  protected readonly form = this.fb.nonNullable.group({
    amountGel: [
      null as number | null,
      [Validators.required, Validators.min(0.01), Validators.max(10_000)],
    ],
    note: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(300)]],
  });

  protected get user(): User {
    return this.context.data.user;
  }

  protected get userLabel(): string {
    const parts = [this.user.firstName, this.user.lastName].filter(Boolean);
    const name = parts.length > 0 ? parts.join(' ') : this.user.email;
    const id = formatMemberId(this.user.memberId);
    return id ? `${name} · ID ${id}` : name;
  }

  ngOnInit(): void {
    this.loadBalance();
    this.loadTransactions(true);
  }

  private loadBalance(): void {
    if (!this.user._id) {
      return;
    }
    this.isLoading.set(true);
    this.walletService
      .getBalance(this.user._id)
      .pipe(
        finalize(() => this.isLoading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (wallet) => this.balanceTetri.set(wallet.balanceTetri),
        error: () => this.balanceTetri.set(null),
      });
  }

  protected loadTransactions(reset = false): void {
    if (!this.user._id || this.txLoading()) {
      return;
    }
    if (reset) {
      this.txPage = 0;
    }
    const nextPage = this.txPage + 1;
    this.txLoading.set(true);

    this.walletService
      .getTransactions(this.user._id, nextPage, TX_PAGE_SIZE)
      .pipe(
        finalize(() => this.txLoading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data, page }) => {
          this.txPage = nextPage;
          this.txTotal.set(page?.total ?? data.length);
          this.transactions.set(reset ? data : [...this.transactions(), ...data]);
        },
        error: () => undefined,
      });
  }

  /**
   * Applies the form as a credit (`direction: 1`) or debit (`direction: -1`) —
   * after an explicit confirm, since this moves real balance.
   */
  protected adjust(direction: 1 | -1): void {
    if (!this.user._id || this.isSaving()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { amountGel } = this.form.getRawValue();
    const data: SsConfirmData =
      direction > 0
        ? {
            content: `${tr('დაერიცხოს')} ${amountGel} ₾ — ${this.userLabel}?`,
            yes: tr('დარიცხვა'),
            no: tr('გაუქმება'),
          }
        : {
            content: `${tr('ჩამოეჭრას')} ${amountGel} ₾ — ${this.userLabel}?`,
            yes: tr('ჩამოჭრა'),
            no: tr('გაუქმება'),
            appearance: 'destructive',
          };

    this.dialogs
      .open<boolean>(SsConfirmComponent, {
        label: tr(direction > 0 ? 'დარიცხვის დადასტურება' : 'ჩამოჭრის დადასტურება'),
        size: 's',
        data,
      })
      .pipe(take(1))
      .subscribe((confirmed) => {
        if (confirmed) this.doAdjust(direction);
      });
  }

  private doAdjust(direction: 1 | -1): void {
    if (!this.user._id) {
      return;
    }
    const { amountGel, note } = this.form.getRawValue();
    const amountTetri = direction * gelToTetri(amountGel ?? 0);

    this.isSaving.set(true);
    this.walletService
      .adjust(this.user._id, { amountTetri, note: note.trim() })
      .pipe(
        finalize(() => this.isSaving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          this.balanceTetri.set(result.balanceTetri);
          this.form.reset({ amountGel: null, note: '' });
          this.loadTransactions(true);
          this.alerts
            .open(tr(direction > 0 ? 'ბალანსი დაირიცხა' : 'ბალანსი ჩამოიჭრა'), {
              appearance: 'success',
            })
            .pipe(take(1))
            .subscribe();
        },
        error: (err: HttpErrorResponse) => {
          const message = tr(
            err.status === 400
              ? direction > 0
                ? 'ლიმიტი გადაჭარბდა (მაქს. 10 000 ₾)'
                : 'არასაკმარისი ბალანსი'
              : 'ოპერაცია ვერ შესრულდა',
          );
          this.alerts.open(message, { appearance: 'negative' }).pipe(take(1)).subscribe();
        },
      });
  }

  // ─── History display helpers ────────────────────────────────────────────────

  protected typeLabel(type: WalletTransactionType): string {
    return TX_TYPE_LABELS[type] ?? type;
  }

  protected isCredit(tx: WalletTransaction): boolean {
    return tx.amountTetri > 0;
  }

  protected amountGelLabel(tx: WalletTransaction): string {
    const sign = tx.amountTetri > 0 ? '+' : tx.amountTetri < 0 ? '−' : '';
    return `${sign}${tetriToGel(Math.abs(tx.amountTetri))} ₾`;
  }

  protected afterGelLabel(tx: WalletTransaction): string {
    return `${tetriToGel(tx.balanceAfterTetri)} ₾`;
  }

  /** App-support tip inside a booking_payment debit; '' when none. */
  protected tipGelLabel(tx: WalletTransaction): string {
    return tx.tipTetri ? `${tetriToGel(tx.tipTetri)} ₾` : '';
  }

  protected close(): void {
    this.context.completeWith();
  }
}
