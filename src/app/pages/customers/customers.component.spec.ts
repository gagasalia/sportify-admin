import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ApplicationRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { of } from 'rxjs';

import { CustomersComponent } from './customers.component';
import { TPipe } from '../../shared/i18n/t.pipe';
import { CustomersService } from '../../services/http-services/customers.service';
import { AcademyService } from '../../services/http-services/academy.service';
import { AuthService } from '../../shared/services/auth.service';
import { CustomerRow } from '../../shared/models/customer.model';

const row: CustomerRow = {
  userId: 'u1',
  firstName: 'Anna',
  lastName: 'Kapanadze',
  email: 'anna@example.com',
  phone: '+995599000111',
  banned: false,
  flagged: false,
  bookings: 12,
  cancelled: 2,
  noShows: 1,
  spentTetri: 66000,
  lastBookingAt: '2026-07-30T10:00:00.000Z',
  lastActivityAt: '2026-07-30T10:00:00.000Z',
};

describe('CustomersComponent', () => {
  let component: CustomersComponent;
  let fixture: ComponentFixture<CustomersComponent>;
  let customersSpy: jasmine.SpyObj<CustomersService>;
  let academySpy: jasmine.SpyObj<AcademyService>;
  let routerSpy: jasmine.SpyObj<Router>;

  async function setup(superAdmin: boolean) {
    customersSpy = jasmine.createSpyObj<CustomersService>('CustomersService', [
      'list',
    ]);
    customersSpy.list.and.returnValue(
      of({ data: [row], page: { page: 1, size: 20, total: 41 } }),
    );
    academySpy = jasmine.createSpyObj<AcademyService>('AcademyService', [
      'getAllAcademies',
    ]);
    academySpy.getAllAcademies.and.returnValue(
      of([{ _id: 'aca-1', name: 'A1' } as never]),
    );
    routerSpy = jasmine.createSpyObj<Router>('Router', ['navigate']);
    routerSpy.navigate.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [CustomersComponent],
      providers: [
        { provide: AuthService, useValue: { isSuperAdmin: () => superAdmin } },
        { provide: CustomersService, useValue: customersSpy },
        { provide: AcademyService, useValue: academySpy },
        { provide: Router, useValue: routerSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(CustomersComponent, {
        // set:{imports} REPLACES the array — the desktop table renders `| date`
        // and every label goes through `| t`, so both pipes must ride along.
        set: { imports: [DatePipe, TPipe], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(CustomersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
  }

  describe('as an academy admin', () => {
    beforeEach(async () => setup(false));

    it('should create and load page 1 without an academy filter', () => {
      expect(component).toBeTruthy();
      expect(customersSpy.list).toHaveBeenCalledTimes(1);
      expect(customersSpy.list.calls.mostRecent().args[0]).toEqual({
        q: undefined,
        flag: undefined,
        academyId: undefined,
        page: 1,
        limit: 20,
      });
      expect(academySpy.getAllAcademies).not.toHaveBeenCalled();
      expect(component['rows']()).toEqual([row]);
      expect(component['total']()).toBe(41);
    });

    it('debounces the search box and resets to page 1', fakeAsync(() => {
      component['page'].set(3);
      component['onSearchChange']('anna');
      expect(customersSpy.list).toHaveBeenCalledTimes(1); // not yet

      tick(400);
      expect(customersSpy.list).toHaveBeenCalledTimes(2);
      const query = customersSpy.list.calls.mostRecent().args[0]!;
      expect(query.q).toBe('anna');
      expect(query.page).toBe(1);
    }));

    it('flag chips reload immediately with the filter', () => {
      component['setFlag']('banned');
      const query = customersSpy.list.calls.mostRecent().args[0]!;
      expect(query.flag).toBe('banned');
      expect(query.page).toBe(1);
    });

    it('paging keeps the current filters', () => {
      component['onPageChange'](2);
      expect(customersSpy.list.calls.mostRecent().args[0]!.page).toBe(2);
    });

    it('opens only rows that still have an account', () => {
      component['open'](row);
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/customers', 'u1']);

      routerSpy.navigate.calls.reset();
      // A missing phone marks a deleted account (phone is the identifier now).
      component['open']({ ...row, phone: undefined });
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    });
  });

  describe('as a superadmin', () => {
    beforeEach(async () => setup(true));

    it('loads the academies for the filter select', () => {
      expect(academySpy.getAllAcademies).toHaveBeenCalled();
      expect(component['academies']().length).toBe(1);
    });

    it('narrows the query by academy', () => {
      component['onAcademyChange']('aca-1');
      const query = customersSpy.list.calls.mostRecent().args[0]!;
      expect(query.academyId).toBe('aca-1');
      expect(query.page).toBe(1);
    });
  });

  describe('display helpers', () => {
    beforeEach(async () => setup(false));

    it('formats names, initials and money', () => {
      expect(component['fullName'](row)).toBe('Anna Kapanadze');
      expect(component['initials'](row)).toBe('AK');
      expect(component['fullName']({ ...row, firstName: undefined, lastName: undefined })).toBe(
        'anna@example.com',
      );
      expect(
        component['fullName']({
          ...row,
          firstName: undefined,
          lastName: undefined,
          email: undefined,
        }),
      ).toBe('წაშლილი ანგარიში');
      expect(component['gel'](66000)).toContain('660');
      expect(component['gel'](66000)).toContain('₾');
    });
  });
});
