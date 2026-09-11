import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, finalize, of, switchMap, take } from 'rxjs';
import { I18nService } from '../../shared/i18n/i18n.service';
import { TPipe } from '../../shared/i18n/t.pipe';
import { AuthService } from '../../shared/services/auth.service';
import { TenantService } from '../../shared/services/tenant.service';
import { NonAdminLoginError } from '../../shared/models/auth.model';

/**
 * First fully Taiga-free page (Phase 1 of the Taiga exit): native elements +
 * the global ss-* kit classes from sport-spot-theme.css. Serves as the
 * migration pattern for the remaining pages.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule, TPipe],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18nService);

  readonly isSubmitting = signal(false);
  /** Raw-GEORGIAN message on failure (translated at render); cleared on a fresh submit. */
  readonly loginError = signal<string | null>(null);
  readonly isEnglish = this.i18n.isEnglish;

  toggleLang(): void {
    this.i18n.toggle();
  }

  readonly loginForm = this.fb.nonNullable.group({
    username: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });

  onSubmit(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.loginError.set(null);
    this.isSubmitting.set(true);

    const { username, password } = this.loginForm.getRawValue();

    this.auth
      .login(username.trim(), password)
      .pipe(
        // Resolve the operator's tenant before entering the app; superadmins
        // resolve to null and proceed. A tenant-resolution failure must not
        // block login, so swallow it here.
        switchMap(() => this.tenant.resolveAcademy().pipe(catchError(() => of(null)))),
        take(1),
        finalize(() => this.isSubmitting.set(false)),
      )
      .subscribe({
        next: () => {
          const returnUrl = this.sanitizeReturnUrl(
            this.route.snapshot.queryParamMap.get('returnUrl'),
          );
          this.router.navigateByUrl(returnUrl);
        },
        error: (err: unknown) => {
          if (err instanceof NonAdminLoginError) {
            this.loginError.set('შესვლა შესაძლებელია მხოლოდ ადმინისტრატორის ანგარიშით');
          } else if (err instanceof HttpErrorResponse && err.status === 401) {
            this.loginError.set('მომხმარებლის სახელი ან პაროლი არასწორია');
          } else {
            this.loginError.set('მოხდა შეცდომა, გთხოვთ სცადოთ მოგვიანებით');
          }
        },
      });
  }

  /**
   * Guards against open-redirect: only same-origin, absolute-path returnUrls are
   * honoured. A value must start with a single '/' (not '//', which the browser
   * treats as a protocol-relative external URL) — anything else falls back to '/'.
   */
  private sanitizeReturnUrl(returnUrl: string | null): string {
    if (returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//')) {
      return returnUrl;
    }
    return '/';
  }
}
