import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin, take } from 'rxjs';
import { type MaskitoOptions } from '@maskito/core';
import { MaskitoDirective } from '@maskito/angular';
import {
  maskitoPrefixPostprocessorGenerator,
  maskitoAddOnFocusPlugin,
  maskitoRemoveOnBlurPlugin,
} from '@maskito/kit';
import { HttpErrorResponse } from '@angular/common/http';
import { BookingService } from '../../../services/http-services/booking.service';
import { CreateBlockDto, CreateBookingDto } from '../../../shared/models/booking.model';
import { ScheduleService } from '../../../services/http-services/schedule.service';
import { blockChunks, hhmmToMinutes, isBookableDuration } from '../calendar-grid';

import { SsToastService } from '../../../shared/ui/toast.service';
import { SS_DIALOG_CONTEXT, SsDialogContext } from '../../../shared/ui/dialog.service';
import { TPipe } from '../../../shared/i18n/t.pipe';
import { tr } from '../../../shared/i18n/lang';
/**
 * Default names per the operator's request (booking vs disable). NOT
 * translated: they are editable form values that go to the API as the stored
 * `customerName` / `note`, so they must stay language-stable data.
 */
export const DEFAULT_BOOKING_NAME = 'ჯავშანი ადმინის მიერ';
export const DEFAULT_BLOCK_NOTE = 'დაბლოკვა ადმინის მიერ';

/** Data passed into the create dialog from the calendar's cell selection. */
export interface BookingDialogData {
  facilityId: string;
  court: string; // court _id
  courtLabel: string;
  date: string; // "YYYY-MM-DD"
  start: string; // "HH:mm" — selection start
  end: string; // "HH:mm" — selection end (exclusive)
  durationMinutes: number; // selection span
  priceTetri?: number; // window price (display only; server snapshots its own)
  /** False when the span is not a bookable duration (60/90/120) — block only. */
  allowBooking: boolean;
}

/**
 * Create dialog for the operator calendar. The slot range comes fully resolved
 * from the calendar's multi-cell selection (no end-time editing here — the
 * operator marked the range before opening). Toggles between a manual
 * **booking** (name defaults to "ჯავშანი ადმინის მიერ", Georgian phone mask,
 * note) and a **block** (note defaults to "დაბლოკვა ადმინის მიერ"). Booking
 * mode is available only for 60/90/120-minute spans; other spans are created
 * as blocks — uniform spans in one request, ragged spans (90+60k) in two (see
 * `blockChunks`). On a 409 the caller refreshes and the dialog surfaces the
 * Georgian "slot already taken" message.
 */
@Component({
  selector: 'app-booking-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule, MaskitoDirective, TPipe],
  templateUrl: './booking-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookingDialogComponent implements OnInit {
  private readonly context = inject(SS_DIALOG_CONTEXT) as SsDialogContext<
    boolean,
    BookingDialogData
  >;
  private readonly fb = inject(FormBuilder);
  private readonly bookingService = inject(BookingService);
  private readonly alerts = inject(SsToastService);

  readonly mode = signal<'booking' | 'block'>('booking');
  readonly submitting = signal(false);

  form!: FormGroup;

  readonly phoneMask: MaskitoOptions = {
    mask: ['+', '9', '9', '5', /[5]/, /\d/, /\d/, /\d/, /\d/, /\d/, /\d/, /\d/, /\d/],
    postprocessors: [maskitoPrefixPostprocessorGenerator('+995')],
    plugins: [maskitoAddOnFocusPlugin('+995'), maskitoRemoveOnBlurPlugin('+995')],
  };

  get data(): BookingDialogData {
    return this.context.data;
  }

  readonly priceGel = (): number | null =>
    this.data.priceTetri != null ? ScheduleService.tetriToGel(this.data.priceTetri) : null;

  ngOnInit(): void {
    this.form = this.fb.group({
      customerName: [DEFAULT_BOOKING_NAME, Validators.required],
      customerPhone: ['', Validators.pattern(/^\+9955\d{8}$/)],
      note: [''],
    });
    // Spans outside 60/90/120 cannot be bookings — open straight in block mode.
    if (!this.data.allowBooking || !isBookableDuration(this.data.durationMinutes)) {
      this.setMode('block');
    }
  }

  setMode(mode: 'booking' | 'block'): void {
    if (mode === 'booking' && !this.data.allowBooking) return;
    this.mode.set(mode);
    const name = this.form.get('customerName');
    const note = this.form.get('note');
    if (mode === 'block') {
      name?.clearValidators();
      // Prefill the disable reason, but never clobber operator input.
      if (!note?.value) note?.setValue(DEFAULT_BLOCK_NOTE);
    } else {
      name?.setValidators([Validators.required]);
      if (note?.value === DEFAULT_BLOCK_NOTE) note?.setValue('');
    }
    name?.updateValueAndValidity();
  }

  private extractPhoneDigits(phone: string): string {
    return (phone || '').replace(/\D/g, '');
  }

  submit(): void {
    if (this.mode() === 'booking') {
      this.submitBooking();
    } else {
      this.submitBlock();
    }
  }

  private submitBooking(): void {
    if (this.form.get('customerName')?.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.value;
    const dto: CreateBookingDto = {
      court: this.data.court,
      date: this.data.date,
      start: this.data.start,
      durationMinutes: this.data.durationMinutes,
      customerName: v.customerName,
      customerPhone: v.customerPhone ? this.extractPhoneDigits(v.customerPhone) : undefined,
      note: v.note || undefined,
    };
    this.submitting.set(true);
    this.bookingService
      .createBooking(this.data.facilityId, dto)
      .pipe(take(1))
      .subscribe({
        next: () => this.onSuccess(tr('ჯავშანი წარმატებით დაემატა!')),
        error: (err) => this.onError(err),
      });
  }

  private submitBlock(): void {
    const v = this.form.value;
    const chunks = blockChunks(hhmmToMinutes(this.data.start), hhmmToMinutes(this.data.end));
    if (chunks.length === 0) {
      this.alerts
        .open(tr('ბლოკი მინიმუმ 60 წუთია'), { appearance: 'error' })
        .pipe(take(1))
        .subscribe();
      return;
    }
    const requests = chunks.map((chunk) => {
      const dto: CreateBlockDto = {
        type: 'block',
        court: this.data.court,
        date: this.data.date,
        start: chunk.start,
        end: chunk.end,
        durationMinutes: chunk.durationMinutes,
        note: v.note || undefined,
      };
      return this.bookingService.createBlock(this.data.facilityId, dto);
    });
    this.submitting.set(true);
    forkJoin(requests)
      .pipe(take(1))
      .subscribe({
        next: () => this.onSuccess(tr('სლოტი დაბლოკილია')),
        error: (err) => this.onError(err),
      });
  }

  private onSuccess(message: string): void {
    this.submitting.set(false);
    this.alerts.open(message, { appearance: 'success' }).pipe(take(1)).subscribe();
    this.context.completeWith(true);
  }

  private onError(err: unknown): void {
    this.submitting.set(false);
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    if (status === 409) {
      // Slot was taken concurrently — tell the operator and close so the
      // calendar refreshes the day (the freshly-taken slot reappears).
      this.alerts
        .open(tr('სლოტი უკვე დაკავებულია'), { appearance: 'error' })
        .pipe(take(1))
        .subscribe();
      this.context.completeWith(true);
      return;
    }
    this.alerts.open(tr('შეცდომა ჯავშნის შენახვისას.'), { appearance: 'error' }).pipe(take(1)).subscribe();
  }

  cancel(): void {
    this.context.completeWith(false);
  }
}
