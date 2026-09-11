import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { WorkingHoursAndPricesComponent } from './working-hours-and-prices.component';
import { ScheduleService } from '../../../services/http-services/schedule.service';
import { FacilityService } from '../../../services/http-services/facility.service';
import { TenantService } from '../../../shared/services/tenant.service';
import { Facility } from '../../../shared/models/facility.model';
import { FacilityScheduleDTO, HolidayDTO } from '../../../shared/models/schedule.model';
import { Day } from '../../../shared/enums/day.enum';

import { SsToastService } from '../../../shared/ui/toast.service';
import { TPipe } from '../../../shared/i18n/t.pipe';
const facility: Facility = {
  _id: 'fac-1',
  name: 'Padel House',
  country: 'Georgia',
  city: 'Tbilisi',
  description: 'desc',
  amenities: [],
};

const schedule: FacilityScheduleDTO = {
  _id: 'sched-1',
  facility: 'fac-1',
  timezone: 'Asia/Tbilisi',
  weeklyHours: {
    0: [{ start: '09:00', end: '22:00' }],
    1: [{ start: '09:00', end: '22:00' }],
    2: [{ start: '09:00', end: '22:00' }],
    3: [{ start: '09:00', end: '22:00' }],
    4: [{ start: '09:00', end: '22:00' }],
    5: [{ start: '09:00', end: '22:00' }],
    6: [],
  },
  holidays: [],
  pricing: { currency: 'GEL', generalPriceTetri: 2500 },
};

describe('WorkingHoursAndPricesComponent', () => {
  let component: WorkingHoursAndPricesComponent;
  let fixture: ComponentFixture<WorkingHoursAndPricesComponent>;
  let scheduleSpy: jasmine.SpyObj<ScheduleService>;
  let facilitySpy: jasmine.SpyObj<FacilityService>;
  let tenantSpy: jasmine.SpyObj<TenantService>;
  let alertsSpy: jasmine.SpyObj<SsToastService>;

  async function setup() {
    scheduleSpy = jasmine.createSpyObj<ScheduleService>('ScheduleService', [
      'getSchedule',
      'updateWeeklyHours',
      'updatePricing',
      'addHoliday',
      'deleteHoliday',
    ]);
    facilitySpy = jasmine.createSpyObj<FacilityService>('FacilityService', [
      'getFacilitiesByAcademy',
    ]);
    tenantSpy = jasmine.createSpyObj<TenantService>('TenantService', ['academyId', 'ensure']);

    tenantSpy.academyId.and.returnValue('aca-1');
    // ngOnInit drives the load through ensure(); emit so loadFacilities() runs.
    tenantSpy.ensure.and.returnValue(of(null));
    facilitySpy.getFacilitiesByAcademy.and.returnValue(of([facility]));
    scheduleSpy.getSchedule.and.returnValue(of(schedule));
    scheduleSpy.updateWeeklyHours.and.returnValue(of(schedule));
    scheduleSpy.updatePricing.and.returnValue(of(schedule));
    scheduleSpy.addHoliday.and.returnValue(of(schedule));
    scheduleSpy.deleteHoliday.and.returnValue(of(schedule));

    alertsSpy = jasmine.createSpyObj<SsToastService>('SsToastService', ['open']);
    alertsSpy.open.and.returnValue(of(undefined) as never);

    const routerSpy = jasmine.createSpyObj<Router>('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [WorkingHoursAndPricesComponent],
      providers: [
        { provide: ScheduleService, useValue: scheduleSpy },
        { provide: FacilityService, useValue: facilitySpy },
        { provide: TenantService, useValue: tenantSpy },
        { provide: Router, useValue: routerSpy },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: SsToastService, useValue: alertsSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      // set:{imports} REPLACES the array — TPipe must ride along or `| t` is NG0302
      .overrideComponent(WorkingHoursAndPricesComponent, {
        set: { imports: [TPipe], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(WorkingHoursAndPricesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => setup());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads the schedule for the auto-selected facility', () => {
    expect(component.selectedFacilityId()).toBe('fac-1');
    expect(scheduleSpy.getSchedule).toHaveBeenCalledWith('fac-1');
  });

  it('derives working-day flags from weeklyHours (Sunday has no ranges → off)', () => {
    expect(component.workingDays[Day.Monday]).toBeTrue();
    expect(component.workingDays[Day.Sunday]).toBeFalse();
  });

  it('hydrates the general price from tetri into GEL', () => {
    expect(component.pricesForm.get('generalPrice')?.value).toBe(25);
  });

  it('labels the pricing fields as per-hour (საათში, contract v2)', () => {
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('ზოგადი ფასი (საათში)');
    expect(text).toContain('არაპიკური ფასი (საათში)');
    // Helper copy explaining that booking totals scale with duration.
    expect(text).toContain('ფასები მითითებულია ერთ საათზე');
  });

  it('onSave saves weekly hours for the SELECTED facility', () => {
    component.onSave();

    expect(scheduleSpy.updateWeeklyHours).toHaveBeenCalled();
    const [facilityId, weeklyHours] = scheduleSpy.updateWeeklyHours.calls.mostRecent().args;
    expect(facilityId).toBe('fac-1');
    // Sunday is off → no ranges; Monday is on → has a range.
    expect(weeklyHours[6]).toEqual([]);
    expect(weeklyHours[0].length).toBe(1);
  });

  it('onSave reflects a toggled-off day as empty ranges', () => {
    component.toggleWorkingDay(Day.Monday);
    component.onSave();

    const [, weeklyHours] = scheduleSpy.updateWeeklyHours.calls.mostRecent().args;
    expect(weeklyHours[0]).toEqual([]);
  });

  it('onSavePrices converts GEL back to integer tetri at the service edge', () => {
    component.pricesForm.patchValue({ generalPrice: 30.5 });
    component.onSavePrices();

    expect(scheduleSpy.updatePricing).toHaveBeenCalled();
    const [facilityId, pricing] = scheduleSpy.updatePricing.calls.mostRecent().args;
    expect(facilityId).toBe('fac-1');
    expect(pricing.generalPriceTetri).toBe(3050);
    expect(pricing.currency).toBe('GEL');
  });

  it('does not save hours when no facility is selected', () => {
    component.selectedFacilityId.set(null);
    scheduleSpy.updateWeeklyHours.calls.reset();

    component.onSave();

    expect(scheduleSpy.updateWeeklyHours).not.toHaveBeenCalled();
  });

  describe('onSaveHolidays', () => {
    const SUCCESS_ALERT = 'დასვენების დღეები წარმატებით შეინახა!';
    const ERROR_ALERT = 'შეცდომა დასვენების დღეების შენახვისას';
    const WARN_ALERT =
      'ზოგიერთი დასვენების დღის წაშლა ვერ მოხერხდა — გვერდი შესაძლოა არ ემთხვეოდეს სერვერს.';

    /** Seeds the private server-holiday list and the picked ISO strings directly. */
    function seedHolidays(server: HolidayDTO[], picked: string[]): void {
      (component as unknown as { serverHolidays: HolidayDTO[] }).serverHolidays = server;
      component.holidays = picked;
    }

    beforeEach(() => {
      // The auto-selected facility is fac-1; reset any incidental alert calls.
      alertsSpy.open.calls.reset();
    });

    it('(a) removing an existing server holiday deletes it by _id', () => {
      seedHolidays([{ _id: 'hol-1', date: '2026-01-01', isClosed: true }], []);

      component.onSaveHolidays();

      expect(scheduleSpy.deleteHoliday).toHaveBeenCalledWith('fac-1', 'hol-1');
      expect(scheduleSpy.addHoliday).not.toHaveBeenCalled();
    });

    it('(b) adding a new date posts that holiday payload', () => {
      seedHolidays([], ['2026-03-08']);

      component.onSaveHolidays();

      expect(scheduleSpy.addHoliday).toHaveBeenCalledWith('fac-1', {
        date: '2026-03-08',
        isClosed: true,
      });
      expect(scheduleSpy.deleteHoliday).not.toHaveBeenCalled();
    });

    it('(c) no changes calls neither add nor delete (but still confirms success)', () => {
      seedHolidays([{ _id: 'hol-1', date: '2026-01-01', isClosed: true }], ['2026-01-01']);

      component.onSaveHolidays();

      expect(scheduleSpy.addHoliday).not.toHaveBeenCalled();
      expect(scheduleSpy.deleteHoliday).not.toHaveBeenCalled();
      expect(alertsSpy.open).toHaveBeenCalledWith(SUCCESS_ALERT, { appearance: 'success' });
    });

    it('partial failure: first op errors → error alert, no success alert', () => {
      // Two ops: delete hol-1 (fails) + add 2026-03-08. The error short-circuits.
      seedHolidays([{ _id: 'hol-1', date: '2026-01-01', isClosed: true }], ['2026-03-08']);
      scheduleSpy.deleteHoliday.and.returnValue(throwError(() => new Error('boom')));

      component.onSaveHolidays();

      expect(alertsSpy.open).toHaveBeenCalledWith(ERROR_ALERT, { appearance: 'error' });
      expect(alertsSpy.open).not.toHaveBeenCalledWith(SUCCESS_ALERT, { appearance: 'success' });
    });

    it('warns (console + alert) and skips deletion when a removed server holiday lacks _id', () => {
      const warnSpy = spyOn(console, 'warn');
      const orphan: HolidayDTO = { date: '2026-01-01', isClosed: true };
      seedHolidays([orphan], []);

      component.onSaveHolidays();

      expect(warnSpy).toHaveBeenCalledWith('Holiday missing _id, cannot delete', orphan);
      expect(alertsSpy.open).toHaveBeenCalledWith(WARN_ALERT, { appearance: 'warning' });
      expect(scheduleSpy.deleteHoliday).not.toHaveBeenCalled();
    });
  });
});
