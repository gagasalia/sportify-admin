import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import {
  BookingDialogComponent,
  BookingDialogData,
  DEFAULT_BLOCK_NOTE,
  DEFAULT_BOOKING_NAME,
} from './booking-dialog.component';
import { BookingService } from '../../../services/http-services/booking.service';
import { Booking } from '../../../shared/models/booking.model';

import { SsToastService } from '../../../shared/ui/toast.service';
import { SS_DIALOG_CONTEXT } from '../../../shared/ui/dialog.service';
import { TPipe } from '../../../shared/i18n/t.pipe';
const data: BookingDialogData = {
  facilityId: 'fac-1',
  court: 'court-1',
  courtLabel: 'კორტი 1',
  date: '2026-06-13',
  start: '09:00',
  end: '10:30',
  durationMinutes: 90,
  priceTetri: 9000,
  allowBooking: true,
};

const created: Booking = {
  _id: 'b-1',
  court: 'court-1',
  type: 'booking',
  date: '2026-06-13',
  start: '09:00',
  end: '10:30',
  status: 'confirmed',
  customerName: 'გიო',
};

describe('BookingDialogComponent', () => {
  let component: BookingDialogComponent;
  let fixture: ComponentFixture<BookingDialogComponent>;
  let bookingSpy: jasmine.SpyObj<BookingService>;
  let completeWith: jasmine.Spy;

  async function setup(dialogData: BookingDialogData = data) {
    // Allow per-test re-setup (different dialog data).
    TestBed.resetTestingModule();
    bookingSpy = jasmine.createSpyObj<BookingService>('BookingService', [
      'createBooking',
      'createBlock',
    ]);
    bookingSpy.createBooking.and.returnValue(of(created));
    bookingSpy.createBlock.and.returnValue(of(created));
    completeWith = jasmine.createSpy('completeWith');

    await TestBed.configureTestingModule({
      imports: [BookingDialogComponent],
      providers: [
        { provide: BookingService, useValue: bookingSpy },
        { provide: SsToastService, useValue: { open: () => of(undefined) } },
        { provide: SS_DIALOG_CONTEXT, useValue: { data: dialogData, completeWith } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(BookingDialogComponent, {
        // The override REPLACES imports — the template needs the `t` pipe.
        set: { imports: [TPipe], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BookingDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => setup());

  it('creates in booking mode with the default admin-reservation name prefilled', () => {
    expect(component).toBeTruthy();
    expect(component.mode()).toBe('booking');
    expect(component.form.get('customerName')?.value).toBe(DEFAULT_BOOKING_NAME);
  });

  it('creates a booking with the selection range durationMinutes and completes true', () => {
    component.submit();

    expect(bookingSpy.createBooking).toHaveBeenCalledWith('fac-1', {
      court: 'court-1',
      date: '2026-06-13',
      start: '09:00',
      durationMinutes: 90,
      customerName: DEFAULT_BOOKING_NAME,
      customerPhone: undefined,
      note: undefined,
    });
    expect(completeWith).toHaveBeenCalledWith(true);
  });

  it('an emptied customer name blocks a booking submit', () => {
    component.form.get('customerName')?.setValue('');
    component.submit();
    expect(bookingSpy.createBooking).not.toHaveBeenCalled();
  });

  it('block mode prefills the disable-by-admin note and submits the full range in one chunk', () => {
    component.setMode('block');
    expect(component.form.get('note')?.value).toBe(DEFAULT_BLOCK_NOTE);

    component.submit();

    // 90-min span → one uniform chunk (durationMinutes 90) covering start→end.
    expect(bookingSpy.createBlock).toHaveBeenCalledTimes(1);
    expect(bookingSpy.createBlock).toHaveBeenCalledWith('fac-1', {
      type: 'block',
      court: 'court-1',
      date: '2026-06-13',
      start: '09:00',
      end: '10:30',
      durationMinutes: 90,
      note: DEFAULT_BLOCK_NOTE,
    });
    expect(completeWith).toHaveBeenCalledWith(true);
  });

  it('switching back to booking clears the untouched default block note', () => {
    component.setMode('block');
    expect(component.form.get('note')?.value).toBe(DEFAULT_BLOCK_NOTE);
    component.setMode('booking');
    expect(component.form.get('note')?.value).toBe('');
  });

  it('a hand-written note survives mode switches', () => {
    component.form.get('note')?.setValue('სარემონტო');
    component.setMode('block');
    expect(component.form.get('note')?.value).toBe('სარემონტო');
    component.setMode('booking');
    expect(component.form.get('note')?.value).toBe('სარემონტო');
  });

  it('a non-bookable span (150 min) opens in block mode and refuses booking mode', async () => {
    await setup({ ...data, end: '11:30', durationMinutes: 150, allowBooking: false });
    expect(component.mode()).toBe('block');

    component.setMode('booking'); // guarded
    expect(component.mode()).toBe('block');
  });

  it('a ragged 150-min block splits into a 90 head + 60 tail (two requests)', async () => {
    await setup({ ...data, end: '11:30', durationMinutes: 150, allowBooking: false });
    component.submit();

    expect(bookingSpy.createBlock).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = bookingSpy.createBlock.calls.allArgs();
    expect(firstCall[1]).toEqual(
      jasmine.objectContaining({ start: '09:00', end: '10:30', durationMinutes: 90 }),
    );
    expect(secondCall[1]).toEqual(
      jasmine.objectContaining({ start: '10:30', end: '11:30', durationMinutes: 60 }),
    );
    expect(completeWith).toHaveBeenCalledWith(true);
  });

  it('409 path: completes with true (so the calendar refreshes the taken slot)', () => {
    bookingSpy.createBooking.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 409 })),
    );
    component.submit();
    expect(completeWith).toHaveBeenCalledWith(true);
  });

  it('non-409 error keeps the dialog open (does not complete)', () => {
    bookingSpy.createBooking.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 500 })),
    );
    component.submit();
    expect(completeWith).not.toHaveBeenCalled();
  });

  it('cancel completes with false', () => {
    component.cancel();
    expect(completeWith).toHaveBeenCalledWith(false);
  });
});
