import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { ReservationsComponent } from './reservations.component';
import { BookingService } from '../../services/http-services/booking.service';
import { CourtService } from '../../services/http-services/court.service';
import { FacilityService } from '../../services/http-services/facility.service';
import { ScheduleService } from '../../services/http-services/schedule.service';
import { TenantService } from '../../shared/services/tenant.service';
import { AuthService } from '../../shared/services/auth.service';
import { Facility } from '../../shared/models/facility.model';
import { Court } from '../../shared/models/court.model';
import { Booking } from '../../shared/models/booking.model';
import { FacilityScheduleDTO, WeeklyHoursDTO } from '../../shared/models/schedule.model';
import {
  SportType,
  CourtLocationType,
  SurfaceMaterial,
  SurfaceColor,
} from '../../shared/enums/court-type.enum';
import { GridCell } from './calendar-grid';
import { shiftIso, todayIso } from './calendar-date.util';
import { BookingDialogData } from './booking-dialog/booking-dialog.component';

import { SsToastService } from '../../shared/ui/toast.service';
import { SsDialogService } from '../../shared/ui/dialog.service';
import { TPipe } from '../../shared/i18n/t.pipe';
const facility: Facility = {
  _id: 'fac-1',
  name: 'Padel House',
  country: 'Georgia',
  city: 'Tbilisi',
  description: 'desc',
  amenities: [],
};

const facility2: Facility = { ...facility, _id: 'fac-2', name: 'Padel Arena' };

const court: Court = {
  _id: 'court-1',
  facility: 'fac-1',
  name: 'კორტი 1',
  nameEn: 'Court 1',
  sportType: SportType.Padel,
  locationType: CourtLocationType.Indoor,
  surface: { material: SurfaceMaterial.Synthetic, color: SurfaceColor.Blue },
  activeState: true,
};

/** Open 09:00–13:00 every day; 60 GEL/h general. */
const schedule: FacilityScheduleDTO = {
  timezone: 'Asia/Tbilisi',
  weeklyHours: Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: '09:00', end: '13:00' }]]),
  ) as unknown as WeeklyHoursDTO,
  holidays: [],
  pricing: { currency: 'GEL', generalPriceTetri: 6000 },
};

/** A fixed future date keeps grid cells free (no `past` marking). */
const futureDate = shiftIso(todayIso(), 3);

const booking: Booking = {
  _id: 'b-1',
  court: 'court-1',
  type: 'booking',
  date: futureDate,
  start: '09:00',
  end: '10:30',
  status: 'confirmed',
  customerName: 'გიო',
  priceTetri: 5000,
  paymentStatus: 'pay_at_venue',
};

describe('ReservationsComponent', () => {
  let component: ReservationsComponent;
  let fixture: ComponentFixture<ReservationsComponent>;
  let bookingSpy: jasmine.SpyObj<BookingService>;
  let courtSpy: jasmine.SpyObj<CourtService>;
  let facilitySpy: jasmine.SpyObj<FacilityService>;
  let scheduleSpy: jasmine.SpyObj<ScheduleService>;
  let tenantSpy: jasmine.SpyObj<TenantService>;
  let dialogSpy: jasmine.SpyObj<SsDialogService>;

  async function setup(
    facilities: Facility[] = [facility],
    queryParams: Record<string, string> = {},
  ) {
    // Allow per-test re-setup (different facilities / query params).
    TestBed.resetTestingModule();
    bookingSpy = jasmine.createSpyObj<BookingService>('BookingService', [
      'getBookings',
      'createBooking',
      'createBlock',
      'cancelBooking',
      'markPaid',
    ]);
    courtSpy = jasmine.createSpyObj<CourtService>('CourtService', ['getCourts']);
    facilitySpy = jasmine.createSpyObj<FacilityService>('FacilityService', [
      'getFacilitiesByAcademy',
    ]);
    scheduleSpy = jasmine.createSpyObj<ScheduleService>('ScheduleService', ['getSchedule']);
    tenantSpy = jasmine.createSpyObj<TenantService>('TenantService', ['academyId', 'ensure']);
    dialogSpy = jasmine.createSpyObj<SsDialogService>('SsDialogService', ['open']);

    tenantSpy.academyId.and.returnValue('aca-1');
    // ngOnInit drives the load through ensure(); emit so loadFacilities() runs.
    tenantSpy.ensure.and.returnValue(of(null));
    facilitySpy.getFacilitiesByAcademy.and.returnValue(of(facilities));
    courtSpy.getCourts.and.returnValue(of([court]));
    scheduleSpy.getSchedule.and.returnValue(of(schedule));
    bookingSpy.getBookings.and.returnValue(of({ data: [booking] }));
    bookingSpy.cancelBooking.and.returnValue(of({ ...booking, status: 'cancelled' }));
    bookingSpy.markPaid.and.returnValue(of({ ...booking, paymentStatus: 'paid' }));
    dialogSpy.open.and.returnValue(of(true));

    const routerSpy = jasmine.createSpyObj<Router>('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [ReservationsComponent],
      providers: [
        { provide: BookingService, useValue: bookingSpy },
        { provide: CourtService, useValue: courtSpy },
        { provide: FacilityService, useValue: facilitySpy },
        { provide: ScheduleService, useValue: scheduleSpy },
        { provide: TenantService, useValue: tenantSpy },
        // Real AuthService pulls HttpClient; the component only reads the
        // isSuperAdmin signal (tip column gating).
        { provide: AuthService, useValue: { isSuperAdmin: signal(false) } },
        { provide: Router, useValue: routerSpy },
        { provide: ActivatedRoute, useValue: { queryParams: of(queryParams) } },
        { provide: SsToastService, useValue: { open: () => of(undefined) } },
        { provide: SsDialogService, useValue: dialogSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(ReservationsComponent, {
        // The override REPLACES imports — the template needs the `t` pipe.
        set: { imports: [TPipe], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ReservationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => setup());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads facilities, selects the FIRST one by default and loads courts + schedule', () => {
    expect(facilitySpy.getFacilitiesByAcademy).toHaveBeenCalledWith('aca-1');
    expect(component.selectedFacilityId()).toBe('fac-1');
    expect(courtSpy.getCourts).toHaveBeenCalledWith('fac-1');
    expect(scheduleSpy.getSchedule).toHaveBeenCalledWith('fac-1');
    expect(component.activeCourts().length).toBe(1);
    expect(component.selectedCourtId()).toBe('court-1');
  });

  it('with several facilities the first chip is selected by default', async () => {
    await setup([facility, facility2]);
    expect(component.selectedFacilityId()).toBe('fac-1');
  });

  it('a valid ?facilityId= overrides the default first-facility selection', async () => {
    await setup([facility, facility2], { facilityId: 'fac-2' });
    expect(component.selectedFacilityId()).toBe('fac-2');
  });

  it('builds the 30-min day grid from schedule + bookings (booking spans 3 rows)', () => {
    component.selectDate(futureDate);
    const grid = component.dayGrid();
    // 09:00–13:00 → 8 cell rows.
    expect(grid.rows.length).toBe(8);
    const first = grid.rows[0].cells[0];
    expect(first.kind).toBe('booking');
    expect(first.span).toBe(3);
    expect(grid.rows[1].cells[0].covered).toBeTrue();
    expect(grid.rows[3].cells[0].kind).toBe('free');
  });

  it('does not load facilities when there is no tenant academy', fakeAsync(() => {
    tenantSpy.academyId.and.returnValue(null);
    facilitySpy.getFacilitiesByAcademy.calls.reset();
    component.ngOnInit();
    tick();
    expect(facilitySpy.getFacilitiesByAcademy).not.toHaveBeenCalled();
    expect(component.facilities()).toEqual([]);
  }));

  // ── multi-cell selection ─────────────────────────────────────────────────────

  function freeCell(start: string, end: string): GridCell {
    return {
      kind: 'free',
      courtId: 'court-1',
      date: futureDate,
      start,
      end,
      span: 1,
      covered: false,
      priceTetri: 3000,
    };
  }

  it('free-cell clicks accumulate an adjacent selection and expose its summary', () => {
    component.selectDate(futureDate);
    component.onCellClick(freeCell('10:30', '11:00'));
    component.onCellClick(freeCell('11:00', '11:30'));

    expect(component.selection().length).toBe(2);
    const info = component.selectionInfo()!;
    expect(info.start).toBe('10:30');
    expect(info.end).toBe('11:30');
    expect(info.minutes).toBe(60);
    expect(info.canContinue).toBeTrue();
    expect(info.bookable).toBeTrue();
    // 2 × 30 GEL cells at the 60 GEL/h general rate.
    expect(info.priceGel).toBe(60);
  });

  it('a single selected cell (30 min) cannot continue yet', () => {
    component.selectDate(futureDate);
    component.onCellClick(freeCell('10:30', '11:00'));
    const info = component.selectionInfo()!;
    expect(info.minutes).toBe(30);
    expect(info.canContinue).toBeFalse();

    component.openSelectionDialog();
    expect(dialogSpy.open).not.toHaveBeenCalled();
  });

  it('openSelectionDialog passes the resolved range and refreshes + clears on save', () => {
    component.selectDate(futureDate);
    bookingSpy.getBookings.calls.reset();
    component.onCellClick(freeCell('10:30', '11:00'));
    component.onCellClick(freeCell('11:00', '11:30'));
    component.onCellClick(freeCell('11:30', '12:00'));

    component.openSelectionDialog();

    expect(dialogSpy.open).toHaveBeenCalled();
    const opts = dialogSpy.open.calls.mostRecent().args[1] as { data: BookingDialogData };
    expect(opts.data.start).toBe('10:30');
    expect(opts.data.end).toBe('12:00');
    expect(opts.data.durationMinutes).toBe(90);
    expect(opts.data.allowBooking).toBeTrue();
    expect(opts.data.date).toBe(futureDate);
    // Dialog resolved true → selection cleared and the day refetched.
    expect(component.selection().length).toBe(0);
    expect(bookingSpy.getBookings).toHaveBeenCalled();
  });

  it('spans outside 60/90/120 open the dialog as block-only', () => {
    component.selectDate(futureDate);
    for (const start of ['10:00', '10:30', '11:00', '11:30', '12:00']) {
      component.onCellClick(freeCell(start, start));
    }
    expect(component.selectionInfo()!.minutes).toBe(150);

    component.openSelectionDialog();
    const opts = dialogSpy.open.calls.mostRecent().args[1] as { data: BookingDialogData };
    expect(opts.data.allowBooking).toBeFalse();
  });

  it('switching tab / date / court clears the selection', () => {
    component.selectDate(futureDate);
    component.onCellClick(freeCell('10:30', '11:00'));
    expect(component.selection().length).toBe(1);

    component.setTab('week');
    expect(component.selection().length).toBe(0);

    component.setTab('day');
    component.onCellClick(freeCell('10:30', '11:00'));
    component.selectDate(shiftIso(futureDate, 1));
    expect(component.selection().length).toBe(0);
  });

  // ── occupied-cell actions ────────────────────────────────────────────────────

  it('booking-cell click routes to the cancel-confirm flow', () => {
    dialogSpy.open.calls.reset();
    dialogSpy.open.and.returnValue(of(true));
    bookingSpy.cancelBooking.calls.reset();

    const cell: GridCell = {
      kind: 'booking',
      courtId: 'court-1',
      date: futureDate,
      start: '09:00',
      end: '10:30',
      span: 3,
      covered: false,
      booking,
    };
    component.onCellClick(cell);

    expect(dialogSpy.open).toHaveBeenCalled();
    expect(bookingSpy.cancelBooking).toHaveBeenCalledWith('b-1');
  });

  it('cancel flow: a declined confirm does NOT cancel', () => {
    dialogSpy.open.and.returnValue(of(false));
    bookingSpy.cancelBooking.calls.reset();

    component.confirmCancel(booking, 'cancel?');

    expect(bookingSpy.cancelBooking).not.toHaveBeenCalled();
  });

  it('mark-paid: confirmed flow PATCHes payment then refreshes', () => {
    bookingSpy.getBookings.calls.reset();
    dialogSpy.open.and.returnValue(of(true));
    component.markPaid(booking);
    expect(bookingSpy.markPaid).toHaveBeenCalledWith('b-1');
    expect(bookingSpy.getBookings).toHaveBeenCalled();
  });

  it('mark-paid: a declined confirm does NOT touch the booking', () => {
    dialogSpy.open.and.returnValue(of(false));
    bookingSpy.markPaid.calls.reset();
    component.markPaid(booking);
    expect(bookingSpy.markPaid).not.toHaveBeenCalled();
  });

  // ── date rail ────────────────────────────────────────────────────────────────

  it('date rail starts today with დღეს/ხვალ labels and drives the selection', () => {
    expect(component.dateOptions[0].iso).toBe(todayIso());
    expect(component.dateOptions[0].label).toBe('დღეს');
    expect(component.dateOptions[1].label).toBe('ხვალ');

    bookingSpy.getBookings.calls.reset();
    component.selectDate(component.dateOptions[2].iso);
    expect(component.selectedDate()).toBe(component.dateOptions[2].iso);
    expect(bookingSpy.getBookings).toHaveBeenCalled();
    // The datepicker mirrors the rail selection.
    expect(component.dateControl.value).toBe(component.dateOptions[2].iso);
  });

  it('a datepicker date beyond the rail is off-rail (no chip active)', () => {
    const far = shiftIso(todayIso(), 30);
    component.selectDate(far);
    expect(component.isOffRailDate()).toBeTrue();
  });

  // ── week view ────────────────────────────────────────────────────────────────

  it('week tab loads the WHOLE week in ONE ranged request (no 7-call burst)', () => {
    // Anchor the calendar on futureDate so its Monday-anchored week contains it.
    component.selectDate(futureDate);
    bookingSpy.getBookings.calls.reset();
    bookingSpy.getBookings.and.returnValue(
      of({ data: [{ ...booking, date: futureDate }] }),
    );
    component.setTab('week');

    // A 7-request burst tripped the API rate limit — the week must be a single
    // from/to range query for the selected court.
    expect(bookingSpy.getBookings).toHaveBeenCalledTimes(1);
    const query = bookingSpy.getBookings.calls.mostRecent().args[1]!;
    expect(query.courtId).toBe('court-1');
    expect(query.from).toBeTruthy();
    expect(query.to).toBeTruthy();
    expect(query.date).toBeUndefined();
    expect(component.weekGrid().days.length).toBe(7);
    // The single response is grouped per day: the booking lands in its column.
    const dayData = component.weekData().find((d) => d.date === futureDate);
    expect(dayData?.bookings.length).toBe(1);
  });

  it('onCourtChipClick guards against re-selecting the already-active court', () => {
    component.setTab('week');
    bookingSpy.getBookings.calls.reset();
    component.onCourtChipClick('court-1');
    expect(bookingSpy.getBookings).not.toHaveBeenCalled();
  });

  // ── list view (its own module) ───────────────────────────────────────────────

  it('the list tab does NOT fetch from the parent — ReservationListComponent owns it', () => {
    bookingSpy.getBookings.calls.reset();
    component.setTab('list');
    expect(bookingSpy.getBookings).not.toHaveBeenCalled();
  });

  // ── display helpers ──────────────────────────────────────────────────────────

  it('cellClass maps kinds to their color groups', () => {
    const base = { courtId: 'court-1', date: futureDate, span: 1, covered: false };
    expect(
      component.cellClass({ ...base, kind: 'booking', start: '09:00', end: '10:00', byUser: true }),
    ).toContain('cell-user');
    expect(
      component.cellClass({ ...base, kind: 'booking', start: '09:00', end: '10:00', byUser: false }),
    ).toContain('cell-admin');
    expect(component.cellClass({ ...base, kind: 'block', start: '09:00', end: '10:00' })).toContain(
      'cell-block',
    );
    expect(component.cellClass({ ...base, kind: 'closed', start: '09:00', end: '09:30' })).toContain(
      'cell-closed',
    );
    expect(component.cellClass({ ...base, kind: 'free', start: '09:00', end: '09:30' })).toContain(
      'cell-free',
    );
  });

  it('cellLabel keeps notes OUT of the inline label (they live in the tooltip)', () => {
    const blockCell: GridCell = {
      kind: 'block',
      courtId: 'court-1',
      date: futureDate,
      start: '09:00',
      end: '10:00',
      span: 2,
      covered: false,
      booking: { ...booking, type: 'block', note: 'სარემონტო' },
    };
    expect(component.cellLabel(blockCell)).toBe('დაბლოკილია');
    expect(component.cellNote(blockCell)).toBe('სარემონტო');
  });

  it('surfaces an error state when the day fetch fails', () => {
    bookingSpy.getBookings.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 500 })),
    );
    component.nextDay();
    expect(component.hasError()).toBeTrue();
  });

  // ── player identity + customer-page linking (populated `user`) ─────────────
  describe('player linking', () => {
    const playerBooking: Booking = {
      ...booking,
      customerName: undefined,
      user: { _id: 'u-9', firstName: 'Anna', lastName: 'Kapanadze' },
    };

    it('bookingPlayer distinguishes populated refs from legacy id strings', () => {
      expect(component.bookingPlayer(playerBooking)?._id).toBe('u-9');
      expect(component.bookingPlayer({ ...booking, user: 'raw-id' })).toBeNull();
      expect(component.bookingPlayer(booking)).toBeNull();
    });

    it('displayName prefers the manual customerName, then the player name', () => {
      expect(component.displayName(booking)).toBe('გიო');
      expect(component.displayName(playerBooking)).toBe('Anna Kapanadze');
      expect(component.displayName({ ...booking, customerName: undefined })).toBeNull();
    });

    it('cellLabel shows the player name on player-made bookings', () => {
      const cell: GridCell = {
        kind: 'booking',
        courtId: 'court-1',
        date: futureDate,
        start: '09:00',
        end: '10:30',
        span: 3,
        covered: false,
        byUser: true,
        booking: playerBooking,
      };
      expect(component.cellLabel(cell)).toBe('Anna Kapanadze');
    });

    it('openPlayer navigates to the customer page for populated refs only', () => {
      const router = TestBed.inject(Router);
      component.openPlayer(playerBooking);
      expect(router.navigate).toHaveBeenCalledWith(['/customers', 'u-9']);

      (router.navigate as jasmine.Spy).calls.reset();
      component.openPlayer(booking);
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });
});
