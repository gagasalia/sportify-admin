import { HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { tr } from '../i18n/lang';
import { AuthService } from '../services/auth.service';
import { TenantService } from '../services/tenant.service';
import { SsToastService } from '../ui/toast.service';

/**
 * Per-request opt-out of the generic Georgian error toast. Set it on a request
 * whose caller surfaces its own error messaging (e.g. {@link MediaService}'s
 * presign 503 → its own clean alert) to avoid double-toasting. 401 handling is
 * unaffected — session teardown + redirect still run regardless of this flag.
 */
export const SKIP_ERROR_TOAST = new HttpContextToken<boolean>(() => false);

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const alerts = inject(SsToastService);
  const auth = inject(AuthService);
  const tenant = inject(TenantService);
  const router = inject(Router);

  const isLoginRequest = req.url === `${environment.apiUrl}/auth/login`;

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      // A 401 on a guarded request means the session is gone: clear it and bounce
      // to /login. The login call handles its own error inline — don't touch it.
      if (error.status === 401 && !isLoginRequest) {
        auth.logout();
        tenant.clear();
        router.navigate(['/login'], {
          queryParams: { returnUrl: router.url },
        });
        // Suppress the generic toast — the login page shows its own messaging.
        return throwError(() => error);
      }

      // Generic failure: surface a Georgian error alert (login errors excluded —
      // the login component renders an inline message instead of double-toasting;
      // SKIP_ERROR_TOAST opts a request out so its caller can show its own alert).
      if (!isLoginRequest && !req.context.get(SKIP_ERROR_TOAST)) {
        alerts
          .open(tr('მოხდა შეცდომა, გთხოვთ სცადოთ მოგვიანებით.'), {
            appearance: 'error',
          })
          .subscribe();
      }

      console.error('HTTP Error:', error);

      return throwError(() => error);
    }),
  );
};
