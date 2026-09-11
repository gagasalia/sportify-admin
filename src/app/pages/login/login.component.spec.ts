import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { LoginComponent } from './login.component';
import { TPipe } from '../../shared/i18n/t.pipe';
import { AuthService } from '../../shared/services/auth.service';
import { TenantService } from '../../shared/services/tenant.service';
import { NonAdminLoginError } from '../../shared/models/auth.model';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let authSpy: jasmine.SpyObj<AuthService>;
  let tenantSpy: jasmine.SpyObj<TenantService>;
  let routerSpy: jasmine.SpyObj<Router>;

  async function setup(returnUrl?: string) {
    authSpy = jasmine.createSpyObj<AuthService>('AuthService', ['login']);
    tenantSpy = jasmine.createSpyObj<TenantService>('TenantService', ['resolveAcademy']);
    routerSpy = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);

    tenantSpy.resolveAcademy.and.returnValue(of(null));

    const queryParamMap = {
      get: (key: string) => (key === 'returnUrl' ? (returnUrl ?? null) : null),
    };

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideAnimations(),
        { provide: AuthService, useValue: authSpy },
        { provide: TenantService, useValue: tenantSpy },
        { provide: Router, useValue: routerSpy },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap } } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(LoginComponent, {
        set: { imports: [ReactiveFormsModule, TPipe], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  // ─── Validation ──────────────────────────────────────────────────────────

  describe('validation', () => {
    beforeEach(async () => setup());

    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should start with an invalid form', () => {
      expect(component.loginForm.invalid).toBeTrue();
    });

    it('should require username and password', () => {
      expect(component.loginForm.get('username')?.hasError('required')).toBeTrue();
      expect(component.loginForm.get('password')?.hasError('required')).toBeTrue();
    });

    it('should be valid with a username and password', () => {
      component.loginForm.setValue({ username: 'super.admin', password: 'secret' });
      expect(component.loginForm.valid).toBeTrue();
    });

    it('should not call login when the form is invalid', () => {
      component.onSubmit();
      expect(authSpy.login).not.toHaveBeenCalled();
    });
  });

  // ─── Successful login ───────────────────────────────────────────────────

  describe('successful login', () => {
    beforeEach(async () => setup());

    it('should call AuthService.login with the credentials', fakeAsync(() => {
      authSpy.login.and.returnValue(of({ accessToken: 't', user: {} as any }));
      component.loginForm.setValue({ username: 'super.admin', password: 'secret' });

      component.onSubmit();
      tick();

      expect(authSpy.login).toHaveBeenCalledWith('super.admin', 'secret');
    }));

    it('should resolve the tenant before navigating', fakeAsync(() => {
      authSpy.login.and.returnValue(of({ accessToken: 't', user: {} as any }));
      component.loginForm.setValue({ username: 'super.admin', password: 'secret' });

      component.onSubmit();
      tick();

      expect(tenantSpy.resolveAcademy).toHaveBeenCalled();
    }));

    it('should navigate to "/" by default', fakeAsync(() => {
      authSpy.login.and.returnValue(of({ accessToken: 't', user: {} as any }));
      component.loginForm.setValue({ username: 'super.admin', password: 'secret' });

      component.onSubmit();
      tick();

      expect(routerSpy.navigateByUrl).toHaveBeenCalledWith('/');
    }));

    it('should clear isSubmitting after success', fakeAsync(() => {
      authSpy.login.and.returnValue(of({ accessToken: 't', user: {} as any }));
      component.loginForm.setValue({ username: 'super.admin', password: 'secret' });

      component.onSubmit();
      tick();

      expect(component.isSubmitting()).toBeFalse();
    }));
  });

  // ─── returnUrl ───────────────────────────────────────────────────────────

  describe('returnUrl handling', () => {
    it('should navigate to the returnUrl query param when present', fakeAsync(async () => {
      await setup('/configuration/courts');
      authSpy.login.and.returnValue(of({ accessToken: 't', user: {} as any }));
      component.loginForm.setValue({ username: 'super.admin', password: 'secret' });

      component.onSubmit();
      tick();

      expect(routerSpy.navigateByUrl).toHaveBeenCalledWith('/configuration/courts');
    }));

    it('should reject an absolute external returnUrl and fall back to "/"', fakeAsync(async () => {
      await setup('https://evil.com');
      authSpy.login.and.returnValue(of({ accessToken: 't', user: {} as any }));
      component.loginForm.setValue({ username: 'super.admin', password: 'secret' });

      component.onSubmit();
      tick();

      expect(routerSpy.navigateByUrl).toHaveBeenCalledWith('/');
    }));

    it('should reject a protocol-relative returnUrl ("//evil.com") and fall back to "/"', fakeAsync(async () => {
      await setup('//evil.com');
      authSpy.login.and.returnValue(of({ accessToken: 't', user: {} as any }));
      component.loginForm.setValue({ username: 'super.admin', password: 'secret' });

      component.onSubmit();
      tick();

      expect(routerSpy.navigateByUrl).toHaveBeenCalledWith('/');
    }));
  });

  // ─── 401 error ───────────────────────────────────────────────────────────

  describe('401 error', () => {
    beforeEach(async () => setup());

    it('should show the Georgian wrong-credentials message on 401', fakeAsync(() => {
      authSpy.login.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 401 })),
      );
      component.loginForm.setValue({ username: 'super.admin', password: 'wrong' });

      component.onSubmit();
      tick();

      expect(component.loginError()).toBe('მომხმარებლის სახელი ან პაროლი არასწორია');
    }));

    it('should not navigate on a 401', fakeAsync(() => {
      authSpy.login.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 401 })),
      );
      component.loginForm.setValue({ username: 'super.admin', password: 'wrong' });

      component.onSubmit();
      tick();

      expect(routerSpy.navigateByUrl).not.toHaveBeenCalled();
    }));

    it('should clear isSubmitting after a 401', fakeAsync(() => {
      authSpy.login.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 401 })),
      );
      component.loginForm.setValue({ username: 'super.admin', password: 'wrong' });

      component.onSubmit();
      tick();

      expect(component.isSubmitting()).toBeFalse();
    }));

    it('should show a generic message on a non-401 error', fakeAsync(() => {
      authSpy.login.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 500 })),
      );
      component.loginForm.setValue({ username: 'super.admin', password: 'x' });

      component.onSubmit();
      tick();

      expect(component.loginError()).toBe('მოხდა შეცდომა, გთხოვთ სცადოთ მოგვიანებით');
    }));
  });

  // ─── non-admin login ─────────────────────────────────────────────────────

  describe('non-admin login', () => {
    beforeEach(async () => setup());

    it('should show the admins-only message on NonAdminLoginError', fakeAsync(() => {
      authSpy.login.and.returnValue(throwError(() => new NonAdminLoginError()));
      component.loginForm.setValue({ username: 'player.phone', password: 'secret' });

      component.onSubmit();
      tick();

      expect(component.loginError()).toBe('შესვლა შესაძლებელია მხოლოდ ადმინისტრატორის ანგარიშით');
    }));

    it('should not navigate on NonAdminLoginError', fakeAsync(() => {
      authSpy.login.and.returnValue(throwError(() => new NonAdminLoginError()));
      component.loginForm.setValue({ username: 'player.phone', password: 'secret' });

      component.onSubmit();
      tick();

      expect(routerSpy.navigateByUrl).not.toHaveBeenCalled();
    }));
  });
});
