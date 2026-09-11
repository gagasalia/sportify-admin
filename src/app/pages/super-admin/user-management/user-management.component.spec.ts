import { ComponentFixture, TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { DatePipe, Location } from '@angular/common';
import { provideLocationMocks, SpyLocation } from '@angular/common/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError, Subject } from 'rxjs';
import { provideAnimations } from '@angular/platform-browser/animations';


import { UserManagementComponent } from './user-management.component';
import {
  UserManagementService,
  PaginatedUsers,
} from '../../../services/http-services/user-management.service';
import { User, UserType, FilterUsersDto } from '../../../shared/models/user.model';
import { TPipe } from '../../../shared/i18n/t.pipe';

import { SsToastService } from '../../../shared/ui/toast.service';
import { SsDialogService } from '../../../shared/ui/dialog.service';
// ─── Test data ───────────────────────────────────────────────────────────────

const mockUsers: User[] = [
  {
    _id: 'user-id-1',
    email: 'john@example.com',
    userType: [UserType.USER],
    firstName: 'John',
    lastName: 'Doe',
    phone: '5551234',
  },
  {
    _id: 'user-id-2',
    email: 'admin@example.com',
    userType: [UserType.ADMIN],
    firstName: 'Admin',
    lastName: 'User',
    phone: '5559999',
  },
];

function page(data: User[], total = data.length, pageNum = 1, size = 20): PaginatedUsers {
  return { data, page: { page: pageNum, size, total } };
}

// ─── Mock window width ───────────────────────────────────────────────────────

// The component reads the global `window.innerWidth`; a property spy (installed
// in beforeEach) redirects it here so individual tests can flip mobile mode.
let mockInnerWidth = 1024;

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('UserManagementComponent', () => {
  let component: UserManagementComponent;
  let fixture: ComponentFixture<UserManagementComponent>;
  let userServiceSpy: jasmine.SpyObj<UserManagementService>;
  let dialogServiceSpy: jasmine.SpyObj<SsDialogService>;
  let alertServiceSpy: jasmine.SpyObj<SsToastService>;
  let location: SpyLocation;

  // Flush queued Angular effects (the filter-change effect). detectChanges runs the
  // component's reactive effects synchronously without advancing fake time.
  const flushEffects = () => fixture.detectChanges();

  beforeEach(async () => {
    mockInnerWidth = 1024;
    spyOnProperty(window, 'innerWidth', 'get').and.callFake(() => mockInnerWidth);
    userServiceSpy = jasmine.createSpyObj('UserManagementService', [
      'findAllUsers',
      'createUser',
      'updateUser',
      'deleteUser',
    ]);
    dialogServiceSpy = jasmine.createSpyObj('SsDialogService', ['open']);
    alertServiceSpy = jasmine.createSpyObj('SsToastService', ['open']);

    // Default: findAllUsers returns the mock list wrapped with page metadata
    userServiceSpy.findAllUsers.and.returnValue(of(page(mockUsers)));
    // Default: dialog open returns empty subject (no completion)
    dialogServiceSpy.open.and.returnValue(new Subject<any>());
    // Default: alert open returns empty observable
    alertServiceSpy.open.and.returnValue(of(undefined) as any);

    await TestBed.configureTestingModule({
      imports: [UserManagementComponent],
      providers: [
        provideAnimations(),
        provideRouter([]),
        provideLocationMocks(),
        { provide: UserManagementService, useValue: userServiceSpy },
        { provide: SsDialogService, useValue: dialogServiceSpy },
        { provide: SsToastService, useValue: alertServiceSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      // Keep only DatePipe; strip Taiga UI and FormsModule so NO_ERRORS_SCHEMA
      // suppresses unknown-element/directive/control-accessor errors.
      .overrideComponent(UserManagementComponent, {
        set: { imports: [DatePipe, TPipe], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(UserManagementComponent);
    component = fixture.componentInstance;
    location = TestBed.inject(Location) as SpyLocation;
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  // ─── Initial state ─────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('should initialize filterName signal to empty string', () => {
      expect((component as any).filterName()).toBe('');
    });

    it('should initialize filterEmail signal to empty string', () => {
      expect((component as any).filterEmail()).toBe('');
    });

    it('should initialize filterPhone signal to empty string', () => {
      expect((component as any).filterPhone()).toBe('');
    });

    it('should initialize filterPid signal to empty string', () => {
      expect((component as any).filterPid()).toBe('');
    });

    it('should initialize filterRole signal to null', () => {
      expect((component as any).filterRole()).toBeNull();
    });

    it('should initialize the page signal to 1', () => {
      expect((component as any).page()).toBe(1);
    });

    it('should initialize the total signal to 0', () => {
      expect((component as any).total()).toBe(0);
    });

    it('should expose all UserType values as roleOptions', () => {
      expect((component as any).roleOptions).toEqual(Object.values(UserType));
    });
  });

  // ─── ngOnInit / loadUsers ──────────────────────────────────────────────────

  describe('ngOnInit', () => {
    it('should call findAllUsers on init with the default page and limit', fakeAsync(() => {
      fixture.detectChanges(); // triggers ngOnInit
      tick();

      const calledWith = userServiceSpy.findAllUsers.calls.mostRecent().args[0] as FilterUsersDto;
      expect(calledWith.page).toBe(1);
      expect(calledWith.limit).toBe(20);
      expect((component as any).users()).toEqual(mockUsers);
    }));

    it('should populate the total signal from the response page metadata', fakeAsync(() => {
      userServiceSpy.findAllUsers.and.returnValue(of(page(mockUsers, 57)));

      fixture.detectChanges();
      tick();

      expect((component as any).total()).toBe(57);
    }));

    it('should fall back to data length when no page metadata is returned', fakeAsync(() => {
      userServiceSpy.findAllUsers.and.returnValue(of({ data: mockUsers } as PaginatedUsers));

      fixture.detectChanges();
      tick();

      expect((component as any).total()).toBe(mockUsers.length);
    }));

    it('should set isLoading to false after successful load', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      expect((component as any).isLoading()).toBeFalse();
    }));

    it('should set isLoading to false even when findAllUsers errors', fakeAsync(() => {
      userServiceSpy.findAllUsers.and.returnValue(throwError(() => new Error('network error')));

      fixture.detectChanges();
      tick();

      expect((component as any).isLoading()).toBeFalse();
    }));
  });

  // ─── Debounced filter signals → reload ─────────────────────────────────────

  describe('debounced filtering', () => {
    beforeEach(fakeAsync(() => {
      // Initialise the component (ngOnInit reads query params and does the first load)
      fixture.detectChanges();
      tick();
      userServiceSpy.findAllUsers.calls.reset();
    }));

    it('should NOT reload immediately when a filter signal changes', fakeAsync(() => {
      (component as any).filterName.set('John');
      flushEffects(); // flush the effect (queues the debounced reload), no time elapses

      expect(userServiceSpy.findAllUsers).not.toHaveBeenCalled();
      flush();
    }));

    it('should reload after the 500ms debounce window elapses', fakeAsync(() => {
      (component as any).filterName.set('John');
      flushEffects(); // flush the effect → debounce timer is armed
      tick(499);
      expect(userServiceSpy.findAllUsers).not.toHaveBeenCalled();

      tick(1);
      expect(userServiceSpy.findAllUsers).toHaveBeenCalledTimes(1);
      flush();
    }));

    it('should include the trimmed filter value in the reload request', fakeAsync(() => {
      (component as any).filterName.set('  John  ');
      flushEffects();
      tick(500);

      const calledWith = userServiceSpy.findAllUsers.calls.mostRecent().args[0] as FilterUsersDto;
      expect(calledWith.name).toBe('John');
      flush();
    }));

    it('should debounce rapid successive changes into a single reload', fakeAsync(() => {
      (component as any).filterName.set('J');
      flushEffects();
      tick(200);
      (component as any).filterName.set('Jo');
      flushEffects();
      tick(200);
      (component as any).filterEmail.set('john@example.com');
      flushEffects();
      tick(500);

      expect(userServiceSpy.findAllUsers).toHaveBeenCalledTimes(1);
      const calledWith = userServiceSpy.findAllUsers.calls.mostRecent().args[0] as FilterUsersDto;
      expect(calledWith.name).toBe('Jo');
      expect(calledWith.email).toBe('john@example.com');
      flush();
    }));

    it('should build a combined filter (with page/limit) when multiple signals are set', fakeAsync(() => {
      (component as any).filterName.set('John');
      (component as any).filterEmail.set('john@example.com');
      (component as any).filterPhone.set('555');
      (component as any).filterPid.set('PID001');
      (component as any).filterRole.set(UserType.USER);
      flushEffects();
      tick(500);

      const calledWith = userServiceSpy.findAllUsers.calls.mostRecent().args[0] as FilterUsersDto;
      expect(calledWith).toEqual({
        page: 1,
        limit: 20,
        name: 'John',
        email: 'john@example.com',
        phone: '555',
        pid: 'PID001',
        userType: [UserType.USER],
      });
      flush();
    }));

    it('should reset the page signal back to 1 when a filter changes', fakeAsync(() => {
      (component as any).page.set(3);
      (component as any).filterName.set('John');
      flushEffects();
      tick(500);

      expect((component as any).page()).toBe(1);
      flush();
    }));

    it('should sync the active filters into the URL via Location', fakeAsync(() => {
      (component as any).filterName.set('John');
      flushEffects();
      tick(500);

      expect(location.urlChanges.some((u) => u.includes('name=John'))).toBeTrue();
      flush();
    }));
  });

  // ─── Pagination ────────────────────────────────────────────────────────────

  describe('pagination', () => {
    beforeEach(fakeAsync(() => {
      userServiceSpy.findAllUsers.and.returnValue(of(page(mockUsers, 100)));
      fixture.detectChanges();
      tick();
      userServiceSpy.findAllUsers.calls.reset();
    }));

    it('should compute totalPages from total and limit', () => {
      expect((component as any).totalPages()).toBe(5); // 100 / 20
    });

    it('should set the 1-based page from the 0-based pagination index on change', fakeAsync(() => {
      (component as any).onPageChange(2); // index 2 → page 3
      tick();

      expect((component as any).page()).toBe(3);
      flush();
    }));

    it('should request the selected page from the service', fakeAsync(() => {
      (component as any).onPageChange(2);
      tick();

      const calledWith = userServiceSpy.findAllUsers.calls.mostRecent().args[0] as FilterUsersDto;
      expect(calledWith.page).toBe(3);
      expect(calledWith.limit).toBe(20);
      flush();
    }));

    it('should put the page number in the URL when greater than 1', fakeAsync(() => {
      (component as any).onPageChange(1); // page 2
      tick();

      expect(location.urlChanges.some((u) => u.includes('page=2'))).toBeTrue();
      flush();
    }));
  });

  // ─── clearFilters ──────────────────────────────────────────────────────────

  describe('clearFilters', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
      userServiceSpy.findAllUsers.calls.reset();
    }));

    it('should reset every filter signal', fakeAsync(() => {
      (component as any).filterName.set('John');
      (component as any).filterEmail.set('john@example.com');
      (component as any).filterPhone.set('555');
      (component as any).filterPid.set('PID001');
      (component as any).filterRole.set(UserType.ADMIN);
      flush(); // let the debounced change settle

      (component as any).clearFilters();
      tick();

      expect((component as any).filterName()).toBe('');
      expect((component as any).filterEmail()).toBe('');
      expect((component as any).filterPhone()).toBe('');
      expect((component as any).filterPid()).toBe('');
      expect((component as any).filterRole()).toBeNull();
      flush();
    }));

    it('should reset the page back to 1', fakeAsync(() => {
      (component as any).page.set(4);

      (component as any).clearFilters();
      tick();

      expect((component as any).page()).toBe(1);
      flush();
    }));

    it('should reload users with only page/limit after clearing', fakeAsync(() => {
      (component as any).clearFilters();
      tick();

      const calledWith = userServiceSpy.findAllUsers.calls.mostRecent().args[0] as FilterUsersDto;
      expect(calledWith).toEqual({ page: 1, limit: 20 });
      expect((component as any).users()).toEqual(mockUsers);
      flush();
    }));

    it('should fire exactly ONE findAllUsers call per clear (no debounced double load)', fakeAsync(() => {
      // Seed some active filters and let their debounced reload settle.
      (component as any).filterName.set('John');
      (component as any).filterEmail.set('john@example.com');
      flush();
      userServiceSpy.findAllUsers.calls.reset();

      (component as any).clearFilters();
      // Drain the debounce window — the suppressed effect must NOT queue a second call.
      flush();

      expect(userServiceSpy.findAllUsers).toHaveBeenCalledTimes(1);
      const calledWith = userServiceSpy.findAllUsers.calls.mostRecent().args[0] as FilterUsersDto;
      expect(calledWith).toEqual({ page: 1, limit: 20 });
    }));
  });

  // ─── isMobile ─────────────────────────────────────────────────────────────

  describe('isMobile signal', () => {
    afterEach(() => {
      // Ensure innerWidth is restored after each test in this describe
      mockInnerWidth = 1024;
    });

    it('should be false when window.innerWidth is 1024', () => {
      mockInnerWidth = 1024;
      const desktopFixture = TestBed.createComponent(UserManagementComponent);
      expect((desktopFixture.componentInstance as any).isMobile()).toBeFalse();
    });

    it('should be true when window.innerWidth is 375 (mobile)', () => {
      mockInnerWidth = 375;
      const mobileFixture = TestBed.createComponent(UserManagementComponent);
      expect((mobileFixture.componentInstance as any).isMobile()).toBeTrue();
    });
  });

  // ─── Helper methods ────────────────────────────────────────────────────────

  describe('getFullName', () => {
    beforeEach(() => fixture.detectChanges());

    it('should return full name when both firstName and lastName exist', () => {
      const result = (component as any).getFullName(mockUsers[0]);
      expect(result).toBe('John Doe');
    });

    it('should return just firstName when lastName is missing', () => {
      const user: User = { ...mockUsers[0], lastName: undefined };
      expect((component as any).getFullName(user)).toBe('John');
    });

    it('should return em dash when neither firstName nor lastName is set', () => {
      const user: User = { ...mockUsers[0], firstName: undefined, lastName: undefined };
      expect((component as any).getFullName(user)).toBe('—');
    });
  });

  describe('getInitials', () => {
    beforeEach(() => fixture.detectChanges());

    it('should return initials from firstName and lastName', () => {
      expect((component as any).getInitials(mockUsers[0])).toBe('JD');
    });

    it('should fall back to first letter of email when no name exists', () => {
      const user: User = {
        ...mockUsers[0],
        firstName: undefined,
        lastName: undefined,
      };
      expect((component as any).getInitials(user)).toBe('J');
    });

    it('should use first letter of email uppercased as fallback', () => {
      const user: User = {
        _id: 'u3',
        email: 'alice@example.com',
        userType: [UserType.USER],
        phone: '5550000',
        firstName: undefined,
        lastName: undefined,
      };
      expect((component as any).getInitials(user)).toBe('A');
    });
  });

  describe('getUserTypeLabel', () => {
    beforeEach(() => fixture.detectChanges());

    it('should capitalise and join multiple user type values', () => {
      const result = (component as any).getUserTypeLabel([UserType.ADMIN, UserType.USER]);
      expect(result).toBe('Admin, User');
    });

    it('should return a single type capitalised', () => {
      expect((component as any).getUserTypeLabel([UserType.SUPERADMIN])).toBe('Superadmin');
    });

    it('should return em dash for null/undefined input', () => {
      expect((component as any).getUserTypeLabel(null as any)).toBe('—');
    });
  });

  // ─── deleteUser ───────────────────────────────────────────────────────────

  describe('deleteUser', () => {
    beforeEach(() => fixture.detectChanges());

    it('should do nothing when the user has no _id', () => {
      const userWithoutId: User = { ...mockUsers[0], _id: undefined };
      (component as any).deleteUser(userWithoutId);
      expect(dialogServiceSpy.open).not.toHaveBeenCalled();
    });

    it('should open a confirmation dialog when the user has an _id', () => {
      dialogServiceSpy.open.and.returnValue(of(false) as any);
      (component as any).deleteUser(mockUsers[0]);
      expect(dialogServiceSpy.open).toHaveBeenCalled();
    });

    it('should call deleteUser on the service and remove user from list when confirmed', fakeAsync(() => {
      userServiceSpy.deleteUser.and.returnValue(of(undefined));
      alertServiceSpy.open.and.returnValue(of(undefined) as any);

      // Populate users first
      (component as any).users.set([...mockUsers]);

      // Return true from the confirm dialog
      dialogServiceSpy.open.and.returnValue(of(true) as any);

      (component as any).deleteUser(mockUsers[0]);
      tick();

      expect(userServiceSpy.deleteUser).toHaveBeenCalledWith('user-id-1');
      const remainingUsers: User[] = (component as any).users();
      expect(remainingUsers.find((u: User) => u._id === 'user-id-1')).toBeUndefined();
    }));

    it('should not call deleteUser on the service when the dialog is dismissed (false)', fakeAsync(() => {
      dialogServiceSpy.open.and.returnValue(of(false) as any);

      (component as any).deleteUser(mockUsers[0]);
      tick();

      expect(userServiceSpy.deleteUser).not.toHaveBeenCalled();
    }));
  });

  // ─── addUser / editUser ───────────────────────────────────────────────────

  describe('addUser', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
      userServiceSpy.findAllUsers.calls.reset();
    }));

    it('should open a dialog', () => {
      dialogServiceSpy.open.and.returnValue(of(null) as any);
      (component as any).addUser();
      expect(dialogServiceSpy.open).toHaveBeenCalled();
    });

    it('should reload users WITH the active filters when the dialog returns a user', fakeAsync(() => {
      (component as any).filterName.set('John');
      flush(); // settle the debounced reload from the filter change
      userServiceSpy.findAllUsers.calls.reset();

      dialogServiceSpy.open.and.returnValue(of(mockUsers[0]) as any);

      (component as any).addUser();
      tick();

      expect(userServiceSpy.findAllUsers).toHaveBeenCalledTimes(1);
      const calledWith = userServiceSpy.findAllUsers.calls.mostRecent().args[0] as FilterUsersDto;
      expect(calledWith.name).toBe('John');
      expect(calledWith.page).toBe(1);
      expect(calledWith.limit).toBe(20);
    }));

    it('should not reload users when the dialog returns null', fakeAsync(() => {
      dialogServiceSpy.open.and.returnValue(of(null) as any);

      (component as any).addUser();
      tick();

      expect(userServiceSpy.findAllUsers).not.toHaveBeenCalled();
    }));
  });

  describe('editUser', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
      userServiceSpy.findAllUsers.calls.reset();
    }));

    it('should open a dialog with the user data', () => {
      dialogServiceSpy.open.and.returnValue(of(null) as any);
      (component as any).editUser(mockUsers[0]);
      expect(dialogServiceSpy.open).toHaveBeenCalled();
    });

    it('should reload users WITH the active filters when the dialog returns an updated user', fakeAsync(() => {
      (component as any).filterEmail.set('john@example.com');
      flush();
      userServiceSpy.findAllUsers.calls.reset();

      dialogServiceSpy.open.and.returnValue(of(mockUsers[0]) as any);

      (component as any).editUser(mockUsers[0]);
      tick();

      expect(userServiceSpy.findAllUsers).toHaveBeenCalledTimes(1);
      const calledWith = userServiceSpy.findAllUsers.calls.mostRecent().args[0] as FilterUsersDto;
      expect(calledWith.email).toBe('john@example.com');
    }));
  });
});

// ─── URL-seeded init (separate TestBed: custom ActivatedRoute with initial params) ─

describe('UserManagementComponent — URL-seeded filters', () => {
  let component: UserManagementComponent;
  let fixture: ComponentFixture<UserManagementComponent>;
  let userServiceSpy: jasmine.SpyObj<UserManagementService>;

  // Stub ActivatedRoute: queryParams seeded with name=foo, plus the snapshot shape
  // replaceUrl() reads (pathFromRoot → url segments).
  function buildRoute(params: Record<string, string>): Partial<ActivatedRoute> {
    return {
      queryParams: of(params),
      snapshot: {
        pathFromRoot: [{ url: [{ path: 'users' } as any] } as any],
      } as any,
    };
  }

  async function setup(params: Record<string, string>) {
    userServiceSpy = jasmine.createSpyObj('UserManagementService', [
      'findAllUsers',
      'createUser',
      'updateUser',
      'deleteUser',
    ]);
    const dialogServiceSpy = jasmine.createSpyObj('SsDialogService', ['open']);
    const alertServiceSpy = jasmine.createSpyObj('SsToastService', ['open']);

    userServiceSpy.findAllUsers.and.returnValue(of(page(mockUsers)));
    dialogServiceSpy.open.and.returnValue(new Subject<any>());
    alertServiceSpy.open.and.returnValue(of(undefined) as any);

    await TestBed.configureTestingModule({
      imports: [UserManagementComponent],
      providers: [
        provideAnimations(),
        provideLocationMocks(),
        { provide: ActivatedRoute, useValue: buildRoute(params) },
        { provide: UserManagementService, useValue: userServiceSpy },
        { provide: SsDialogService, useValue: dialogServiceSpy },
        { provide: SsToastService, useValue: alertServiceSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(UserManagementComponent, {
        set: { imports: [DatePipe, TPipe], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(UserManagementComponent);
    component = fixture.componentInstance;
  }

  it('should fire exactly ONE findAllUsers call when filters are seeded from the URL', fakeAsync(async () => {
    await setup({ name: 'foo' });

    fixture.detectChanges(); // ngOnInit: reads queryParams, seeds signals, single load
    tick();
    // Drain the debounce window — the suppressed effect must NOT queue a second call.
    flush();

    expect(userServiceSpy.findAllUsers).toHaveBeenCalledTimes(1);
    const calledWith = userServiceSpy.findAllUsers.calls.mostRecent().args[0] as FilterUsersDto;
    expect(calledWith.name).toBe('foo');
    expect(calledWith.page).toBe(1);
    expect(calledWith.limit).toBe(20);
    expect((component as any).filterName()).toBe('foo');
  }));
});
