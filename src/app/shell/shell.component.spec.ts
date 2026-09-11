import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { ShellComponent } from './shell.component';
import { TPipe } from '../shared/i18n/t.pipe';
import { AuthService } from '../shared/services/auth.service';
import { TenantService } from '../shared/services/tenant.service';
import { SsDialogService } from '../shared/ui/dialog.service';

describe('ShellComponent', () => {
  // `isSuperAdmin` is a Signal; a plain stub exposing a callable signal models it
  // without dragging the real AuthService (and its HttpClient) into the test.
  let authStub: { isSuperAdmin: ReturnType<typeof signal<boolean>>; logout: jasmine.Spy };
  let tenantStub: { clear: jasmine.Spy };
  let dialogStub: { open: jasmine.Spy };

  beforeEach(async () => {
    authStub = { isSuperAdmin: signal(false), logout: jasmine.createSpy('logout') };
    tenantStub = { clear: jasmine.createSpy('clear') };
    dialogStub = { open: jasmine.createSpy('open').and.returnValue(of(true)) };

    await TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        provideRouter([]),
        provideAnimations(),
        { provide: AuthService, useValue: authStub },
        { provide: TenantService, useValue: tenantStub },
        { provide: SsDialogService, useValue: dialogStub },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      // set:{imports} REPLACES the array — TPipe must ride along or `| t` is NG0302
      .overrideComponent(ShellComponent, { set: { imports: [TPipe], schemas: [NO_ERRORS_SCHEMA] } })
      .compileComponents();
  });

  function signOut(): void {
    const fixture = TestBed.createComponent(ShellComponent);
    (fixture.componentInstance as unknown as { signOut(): void }).signOut();
  }

  it('should create the shell', () => {
    const fixture = TestBed.createComponent(ShellComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('confirmed signOut clears the session AND the cached tenant, then navigates to login', () => {
    const router = TestBed.inject(Router);
    const navigateSpy = spyOn(router, 'navigate');

    signOut();

    expect(dialogStub.open).toHaveBeenCalled();
    expect(authStub.logout).toHaveBeenCalled();
    // Regression guard: a cached tenant surviving sign-out makes the next
    // operator's modules render empty (stale `null` academy for superadmins).
    expect(tenantStub.clear).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });

  it('declined signOut leaves the session untouched', () => {
    dialogStub.open.and.returnValue(of(false));
    const router = TestBed.inject(Router);
    const navigateSpy = spyOn(router, 'navigate');

    signOut();

    expect(authStub.logout).not.toHaveBeenCalled();
    expect(tenantStub.clear).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
