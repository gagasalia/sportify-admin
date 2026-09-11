import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { PromocodesComponent } from './promocodes.component';
import { TPipe } from '../../shared/i18n/t.pipe';
import { PromocodeService } from '../../services/http-services/promocode.service';
import { AcademyService } from '../../services/http-services/academy.service';
import { AuthService } from '../../shared/services/auth.service';
import { TenantService } from '../../shared/services/tenant.service';
import { Promocode } from '../../shared/models/promocode.model';

import { SsToastService } from '../../shared/ui/toast.service';
import { SsDialogService } from '../../shared/ui/dialog.service';

const promo: Promocode = {
  _id: 'p-1',
  academy: 'aca-1',
  academyName: 'Padel House',
  code: 'SUMMER-25',
  name: 'ზაფხულის აქცია',
  discountType: 'percent',
  percentOff: 25,
  maxDiscountTetri: 2000,
  eligibility: 'everyone',
  usedCount: 0,
  active: true,
};

describe('PromocodesComponent', () => {
  let component: PromocodesComponent;
  let fixture: ComponentFixture<PromocodesComponent>;
  let promoSpy: jasmine.SpyObj<PromocodeService>;
  let academySpy: jasmine.SpyObj<AcademyService>;
  let tenantSpy: jasmine.SpyObj<TenantService>;
  let dialogSpy: jasmine.SpyObj<SsDialogService>;
  let alertSpy: jasmine.SpyObj<SsToastService>;

  async function setup(superAdmin: boolean) {
    promoSpy = jasmine.createSpyObj<PromocodeService>('PromocodeService', [
      'getPromocodes',
      'createPromocode',
      'updatePromocode',
      'deletePromocode',
      'getRedemptions',
    ]);
    promoSpy.getPromocodes.and.returnValue(
      of({ data: [promo], page: { page: 1, size: 20, total: 41 } }),
    );
    promoSpy.updatePromocode.and.returnValue(of({ ...promo, active: false }));
    promoSpy.deletePromocode.and.returnValue(of(undefined));

    academySpy = jasmine.createSpyObj<AcademyService>('AcademyService', ['getAllAcademies']);
    academySpy.getAllAcademies.and.returnValue(of([{ _id: 'aca-1', name: 'A1' } as never]));

    tenantSpy = jasmine.createSpyObj<TenantService>('TenantService', ['ensure', 'academyId']);
    tenantSpy.ensure.and.returnValue(of(null));
    tenantSpy.academyId.and.returnValue('aca-1');

    dialogSpy = jasmine.createSpyObj<SsDialogService>('SsDialogService', ['open']);
    alertSpy = jasmine.createSpyObj<SsToastService>('SsToastService', ['open']);
    alertSpy.open.and.returnValue(of(undefined));

    const routerSpy = jasmine.createSpyObj<Router>('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [PromocodesComponent],
      providers: [
        { provide: PromocodeService, useValue: promoSpy },
        { provide: AcademyService, useValue: academySpy },
        { provide: TenantService, useValue: tenantSpy },
        { provide: AuthService, useValue: { isSuperAdmin: () => superAdmin } },
        { provide: SsDialogService, useValue: dialogSpy },
        { provide: SsToastService, useValue: alertSpy },
        { provide: Router, useValue: routerSpy },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(PromocodesComponent, {
        // The template translates through the impure `t` pipe — an override that
        // replaces `imports` must keep it or the view fails with NG0302.
        set: { imports: [TPipe], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(PromocodesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  describe('as an academy admin', () => {
    beforeEach(async () => setup(false));

    it('should create and load page 1 without filters after the tenant resolves', () => {
      expect(component).toBeTruthy();
      expect(tenantSpy.ensure).toHaveBeenCalled();
      expect(promoSpy.getPromocodes).toHaveBeenCalledTimes(1);
      expect(promoSpy.getPromocodes.calls.mostRecent().args[0]).toEqual({
        page: 1,
        limit: 20,
        q: undefined,
        active: undefined,
        academyId: undefined,
      });
      expect(academySpy.getAllAcademies).not.toHaveBeenCalled();
      expect(component['rows']()).toEqual([promo]);
      expect(component['total']()).toBe(41);
    });

    it('debounces the search box and reloads with q on page 1', fakeAsync(() => {
      component['page'].set(3);
      component['onSearchChange']('SUMMER');
      expect(promoSpy.getPromocodes).toHaveBeenCalledTimes(1); // not yet

      tick(400);
      expect(promoSpy.getPromocodes).toHaveBeenCalledTimes(2);
      const query = promoSpy.getPromocodes.calls.mostRecent().args[0];
      expect(query.q).toBe('SUMMER');
      expect(query.page).toBe(1);
    }));

    it('active pick-chips reload immediately with the filter', () => {
      component['setActiveFilter'](false);
      const query = promoSpy.getPromocodes.calls.mostRecent().args[0];
      expect(query.active).toBeFalse();
      expect(query.page).toBe(1);

      component['setActiveFilter'](null);
      expect(promoSpy.getPromocodes.calls.mostRecent().args[0].active).toBeUndefined();
    });

    it('paging keeps the current filters', () => {
      component['onPageChange'](2);
      expect(promoSpy.getPromocodes.calls.mostRecent().args[0].page).toBe(2);
    });

    it('delete flow: confirm dialog → service.delete → reload + toast', () => {
      dialogSpy.open.and.returnValue(of(true));
      promoSpy.getPromocodes.calls.reset();

      component['deletePromocode'](promo);

      expect(dialogSpy.open).toHaveBeenCalled();
      expect(promoSpy.deletePromocode).toHaveBeenCalledWith('p-1');
      expect(promoSpy.getPromocodes).toHaveBeenCalledTimes(1);
      expect(alertSpy.open).toHaveBeenCalledWith(
        'წაიშალა',
        jasmine.objectContaining({ appearance: 'success' }),
      );
    });

    it('delete flow does nothing when the confirm is declined', () => {
      dialogSpy.open.and.returnValue(of(false));
      component['deletePromocode'](promo);
      expect(promoSpy.deletePromocode).not.toHaveBeenCalled();
    });

    it('active switch PATCHes {active} optimistically and toasts on success', () => {
      component['onActiveToggle'](promo, false);

      expect(promoSpy.updatePromocode).toHaveBeenCalledWith('p-1', { active: false });
      expect(component['rows']()[0].active).toBeFalse();
      expect(alertSpy.open).toHaveBeenCalledWith(
        'შეინახა',
        jasmine.objectContaining({ appearance: 'success' }),
      );
    });

    it('active switch reverts the optimistic flip when the PATCH fails', () => {
      promoSpy.updatePromocode.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 409 })),
      );

      component['onActiveToggle'](promo, false);

      expect(component['rows']()[0].active).toBeTrue();
      expect(alertSpy.open).toHaveBeenCalledWith(
        'შენახვა ვერ მოხერხდა, სცადეთ თავიდან',
        jasmine.objectContaining({ appearance: 'error' }),
      );
    });

    it('surfaces the error state when the list fetch hard-fails', () => {
      promoSpy.getPromocodes.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 500 })),
      );
      component['retry']();
      expect(component['hasError']()).toBeTrue();
    });
  });

  describe('as a superadmin', () => {
    beforeEach(async () => setup(true));

    it('loads the academies for the filter select', () => {
      expect(academySpy.getAllAcademies).toHaveBeenCalled();
      expect(component['academies']().length).toBe(1);
    });

    it('narrows the query by academy on page 1', () => {
      component['onAcademyChange']('aca-1');
      const query = promoSpy.getPromocodes.calls.mostRecent().args[0];
      expect(query.academyId).toBe('aca-1');
      expect(query.page).toBe(1);
    });
  });

  describe('derived status', () => {
    beforeEach(async () => setup(false));

    it('inactive wins over everything', () => {
      expect(
        component['derivedStatus']({ ...promo, active: false, expiresAt: '2020-01-01' }),
      ).toBe('inactive');
    });

    it('a past expiry is expired', () => {
      expect(component['derivedStatus']({ ...promo, expiresAt: '2020-01-01' })).toBe('expired');
    });

    it('a date-only expiry counts to the end of that day (not expired same morning)', () => {
      const today = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const iso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
      expect(component['derivedStatus']({ ...promo, expiresAt: iso })).toBe('active');
    });

    it('a future start is scheduled', () => {
      expect(component['derivedStatus']({ ...promo, startsAt: '2999-01-01' })).toBe('scheduled');
    });

    it('a reached total usage limit is depleted', () => {
      expect(
        component['derivedStatus']({ ...promo, usageLimitTotal: 5, usedCount: 5 }),
      ).toBe('depleted');
    });

    it('otherwise the code is active', () => {
      expect(component['derivedStatus'](promo)).toBe('active');
      expect(component['statusClass']('active')).toBe('ss-badge ss-badge--positive');
      expect(component['statusLabel']('inactive')).toBe('გამორთული');
    });
  });

  describe('display helpers', () => {
    beforeEach(async () => setup(false));

    it('formats discount, eligibility, window and usage', () => {
      expect(component['discountLabel'](promo)).toBe('−25%');
      expect(component['maxDiscountHint'](promo)).toBe('მაქს. 20 ₾');
      expect(
        component['discountLabel']({ ...promo, discountType: 'fixed', amountTetri: 1000 }),
      ).toBe('−10 ₾');
      expect(component['eligibilityLabel'](promo)).toBe('ყველასთვის');
      expect(
        component['eligibilityLabel']({
          ...promo,
          eligibility: 'booking_count_range',
          minBookings: 2,
          maxBookings: 5,
        }),
      ).toBe('2–5 ჯავშანი');
      expect(
        component['eligibilityLabel']({
          ...promo,
          eligibility: 'booking_count_range',
          minBookings: 3,
        }),
      ).toBe('3+ ჯავშანი');
      expect(component['windowLabel'](promo)).toBe('უვადო');
      expect(
        component['windowLabel']({ ...promo, startsAt: '2026-06-01', expiresAt: '2026-08-31' }),
      ).toBe('01.06.26 – 31.08.26');
      expect(component['usageLabel'](promo)).toBe('0 / ∞');
      expect(component['usageLabel']({ ...promo, usedCount: 3, usageLimitTotal: 10 })).toBe(
        '3 / 10',
      );
    });
  });
});
