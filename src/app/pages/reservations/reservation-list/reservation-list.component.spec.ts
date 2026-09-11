import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { ReservationListComponent } from './reservation-list.component';
import { BookingService } from '../../../services/http-services/booking.service';
import { AuthService } from '../../../shared/services/auth.service';
import { SsToastService } from '../../../shared/ui/toast.service';
import { SsDialogService } from '../../../shared/ui/dialog.service';
import { Booking } from '../../../shared/models/booking.model';
import { GridCourt } from '../calendar-grid';
import { TPipe } from '../../../shared/i18n/t.pipe';

const courts: GridCourt[] = [{ id: 'court-1', name: 'კორტი 1', label: 'კორტი 1' }];

const booking: Booking = {
  _id: 'b-1',
  court: 'court-1',
  type: 'booking',
  date: '2026-09-10',
  start: '18:00',
  end: '19:30',
  status: 'confirmed',
  user: { _id: '64b8f0c2e1d3c2a5f0e4b8c1', memberId: 42, firstName: 'გიო', lastName: 'ბერიძე' },
  priceTetri: 5000,
  paymentStatus: 'pay_at_venue',
  createdAt: '2026-08-30T10:00:00.000Z',
};

describe('ReservationListComponent', () => {
  let component: ReservationListComponent;
  let fixture: ComponentFixture<ReservationListComponent>;
  let bookingSpy: jasmine.SpyObj<BookingService>;
  let dialogSpy: jasmine.SpyObj<SsDialogService>;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(async () => {
    bookingSpy = jasmine.createSpyObj<BookingService>('BookingService', [
      'getBookings',
      'cancelBooking',
    ]);
    bookingSpy.getBookings.and.returnValue(
      of({ data: [booking], page: { page: 1, size: 20, total: 1 } }),
    );
    bookingSpy.cancelBooking.and.returnValue(of({ ...booking, status: 'cancelled' }));
    dialogSpy = jasmine.createSpyObj<SsDialogService>('SsDialogService', ['open']);
    dialogSpy.open.and.returnValue(of(true));
    routerSpy = jasmine.createSpyObj<Router>('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [ReservationListComponent],
      providers: [
        { provide: BookingService, useValue: bookingSpy },
        { provide: AuthService, useValue: { isSuperAdmin: signal(false) } },
        { provide: Router, useValue: routerSpy },
        { provide: SsToastService, useValue: { open: () => of(undefined) } },
        { provide: SsDialogService, useValue: dialogSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(ReservationListComponent, {
        // Keep the pipes/directives; only the ss-avatar child is stubbed out.
        set: { imports: [CommonModule, ReactiveFormsModule, TPipe], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ReservationListComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('facilityId', 'fac-1');
    fixture.componentRef.setInput('courts', courts);
    fixture.detectChanges(); // runs the facility effect → initial load
  });

  it('loads on init sorted by reservation date (newest first) — the default', () => {
    expect(bookingSpy.getBookings).toHaveBeenCalledWith(
      'fac-1',
      jasmine.objectContaining({ sortBy: 'created', page: 1, limit: 20 }),
    );
    expect(component.bookings()).toEqual([booking]);
    expect(component.total()).toBe(1);
  });

  it('setSort switches to playing-date order (future top) and back, reloading page 1', () => {
    bookingSpy.getBookings.calls.reset();

    component.setSort('playing');
    expect(bookingSpy.getBookings).toHaveBeenCalledWith(
      'fac-1',
      jasmine.objectContaining({ sortBy: 'playing', page: 1 }),
    );

    component.setSort('playing'); // same sort → no extra fetch
    expect(bookingSpy.getBookings).toHaveBeenCalledTimes(1);

    component.setSort('created');
    expect(bookingSpy.getBookings).toHaveBeenCalledWith(
      'fac-1',
      jasmine.objectContaining({ sortBy: 'created' }),
    );
  });

  it('picker filters (dates/court/status/hour) apply immediately as query params', () => {
    bookingSpy.getBookings.calls.reset();

    component.createdFrom.setValue('2026-08-01');
    component.playFrom.setValue('2026-09-01');
    component.playTo.setValue('2026-09-30');
    component.startHour.setValue(18);
    component.court.setValue('court-1');
    component.status.setValue('confirmed');

    const query = bookingSpy.getBookings.calls.mostRecent().args[1];
    expect(query).toEqual(
      jasmine.objectContaining({
        createdFrom: '2026-08-01',
        from: '2026-09-01',
        to: '2026-09-30',
        startHour: 18,
        courtId: 'court-1',
        status: 'confirmed',
        page: 1,
      }),
    );
  });

  it('text/number filters debounce, and price GEL converts to tetri', fakeAsync(() => {
    bookingSpy.getBookings.calls.reset();

    component.customer.setValue('გიო');
    component.priceMin.setValue(30);
    component.priceMax.setValue(90);
    expect(bookingSpy.getBookings).not.toHaveBeenCalled(); // still settling

    tick(400);
    expect(bookingSpy.getBookings).toHaveBeenCalledTimes(1);
    expect(bookingSpy.getBookings.calls.mostRecent().args[1]).toEqual(
      jasmine.objectContaining({
        customer: 'გიო',
        priceMinTetri: 3000,
        priceMaxTetri: 9000,
      }),
    );
  }));

  it('ID filter: a non-numeric value blocks the fetch; digits are sent as a number', fakeAsync(() => {
    bookingSpy.getBookings.calls.reset();

    component.memberId.setValue('12a');
    tick(400);
    expect(component.memberIdInvalid()).toBeTrue();
    expect(bookingSpy.getBookings).not.toHaveBeenCalled();

    // Zero-padded input matches the padded display; the wire value is numeric.
    component.memberId.setValue('000042');
    tick(400);
    expect(component.memberIdInvalid()).toBeFalse();
    expect(bookingSpy.getBookings).toHaveBeenCalledWith(
      'fac-1',
      jasmine.objectContaining({ memberId: 42 }),
    );
  }));

  it('pagination is one-based: next/prev step within bounds', () => {
    bookingSpy.getBookings.and.returnValue(
      of({ data: [booking], page: { page: 1, size: 20, total: 45 } }),
    );
    component.load(1);
    expect(component.page()).toBe(1);
    expect(component.totalPages()).toBe(3);

    component.nextPage(); // 1*20=20 < 45 → page 2
    expect(component.page()).toBe(2);

    component.nextPage(); // 2*20=40 < 45 → page 3
    expect(component.page()).toBe(3);

    component.nextPage(); // 3*20=60 >= 45 → guarded, stays on 3
    expect(component.page()).toBe(3);

    component.prevPage();
    expect(component.page()).toBe(2);
  });

  it('switching facility resets the (per-facility) court filter and reloads', () => {
    component.court.setValue('court-1');
    bookingSpy.getBookings.calls.reset();

    fixture.componentRef.setInput('facilityId', 'fac-2');
    fixture.detectChanges();

    expect(component.court.value).toBeNull();
    const [facilityId, query] = bookingSpy.getBookings.calls.mostRecent().args;
    expect(facilityId).toBe('fac-2');
    expect((query as { courtId?: string }).courtId).toBeUndefined();
  });

  it('clearFilters wipes every column filter with ONE reload', () => {
    component.customer.setValue('გიო', { emitEvent: false });
    component.court.setValue('court-1', { emitEvent: false });
    component.playFrom.setValue('2026-09-01', { emitEvent: false });
    expect(component.hasActiveFilters()).toBeTrue();
    bookingSpy.getBookings.calls.reset();

    component.clearFilters();

    expect(component.hasActiveFilters()).toBeFalse();
    expect(bookingSpy.getBookings).toHaveBeenCalledTimes(1);
  });

  it('cancel flow: confirm → PATCH cancel → reload; declined confirm does nothing', () => {
    bookingSpy.getBookings.calls.reset();
    component.cancelFromList(booking);
    expect(bookingSpy.cancelBooking).toHaveBeenCalledWith('b-1');
    expect(bookingSpy.getBookings).toHaveBeenCalled(); // refreshed current page

    bookingSpy.cancelBooking.calls.reset();
    dialogSpy.open.and.returnValue(of(false));
    component.cancelFromList(booking);
    expect(bookingSpy.cancelBooking).not.toHaveBeenCalled();
  });

  it('statusBadgeClass: completed is neutral, cancelled negative, confirmed positive', () => {
    expect(component.statusBadgeClass('completed')).toBe('ss-badge ss-badge--neutral');
    expect(component.statusBadgeClass('cancelled')).toBe('ss-badge ss-badge--negative');
    expect(component.statusBadgeClass('confirmed')).toBe('ss-badge ss-badge--positive');
  });

  it('playerId exposes the padded member ID; manual rows have none', () => {
    expect(component.playerId(booking)).toBe('000042');
    expect(component.playerId({ ...booking, user: undefined, customerName: 'Walk In' })).toBeNull();
  });

  it('openPlayer navigates to the customer page for populated refs only', () => {
    component.openPlayer(booking);
    expect(routerSpy.navigate).toHaveBeenCalledWith([
      '/customers',
      '64b8f0c2e1d3c2a5f0e4b8c1',
    ]);

    routerSpy.navigate.calls.reset();
    component.openPlayer({ ...booking, user: 'raw-id' });
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  it('surfaces an error state when the fetch fails', () => {
    bookingSpy.getBookings.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 500 })),
    );
    component.load(1);
    expect(component.hasError()).toBeTrue();
    expect(component.isLoading()).toBeFalse();
  });
});
