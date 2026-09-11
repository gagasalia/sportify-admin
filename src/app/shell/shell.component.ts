import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { take } from 'rxjs';
import { I18nService } from '../shared/i18n/i18n.service';
import { tr } from '../shared/i18n/lang';
import { TPipe } from '../shared/i18n/t.pipe';
import { AuthService } from '../shared/services/auth.service';
import { TenantService } from '../shared/services/tenant.service';
import { SsConfirmComponent, SsConfirmData } from '../shared/ui/confirm.component';
import { SsDialogService } from '../shared/ui/dialog.service';
import { SsThemeService } from '../shared/ui/theme.service';

/**
 * Authenticated application chrome: header, sidebar, mobile tab bar and the
 * dark-mode toggle. Rendered only behind the route-level `authGuard`, so the
 * shell never paints (and never reads auth state) on the public `/login` page.
 * Feature pages render into the shell's own `<router-outlet>`.
 *
 * The chrome is plain kit markup (ss-* classes + `.ss-ic` mask icons); theming
 * runs through `SsThemeService`, which stamps `[tuiTheme]` on `<html>`.
 * Accordion groups auto-open when the current URL is inside their section; on
 * mobile the config / super-admin groups become bottom sheets over the tab bar.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.css',
})
export class ShellComponent {
  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantService);
  private readonly router = inject(Router);
  private readonly theme = inject(SsThemeService);
  private readonly dialogs = inject(SsDialogService);
  private readonly i18n = inject(I18nService);

  protected readonly darkMode = this.theme.dark;
  protected readonly isEnglish = this.i18n.isEnglish;
  protected readonly isSuperAdmin = this.auth.isSuperAdmin;
  protected expanded = signal(true);
  protected isMobile = signal(false);

  /**
   * Desktop aside accordions. Configuration starts open regardless of route so
   * its sub-items are always one click away; super-admin opens only when the
   * route is already inside it.
   */
  protected configOpen = signal(true);
  protected superOpen = signal(this.router.url.startsWith('/super-admin'));

  /** Mobile bottom sheets (config / super-admin). */
  protected configDropdownOpen = signal(false);
  protected superAdminDropdownOpen = signal(false);

  constructor() {
    this.checkMobile();
  }

  @HostListener('window:resize')
  protected onResize(): void {
    this.checkMobile();
  }

  private checkMobile(): void {
    this.isMobile.set(typeof window !== 'undefined' && window.innerWidth <= 768);
  }

  protected handleToggle(): void {
    this.expanded.update((e) => !e);
  }

  /** Collapsed rail: clicking an accordion first re-expands the rail. */
  protected toggleConfig(): void {
    if (!this.expanded()) {
      this.expanded.set(true);
      this.configOpen.set(true);
      return;
    }
    this.configOpen.update((o) => !o);
  }

  protected toggleSuper(): void {
    if (!this.expanded()) {
      this.expanded.set(true);
      this.superOpen.set(true);
      return;
    }
    this.superOpen.update((o) => !o);
  }

  protected toggleDarkMode(): void {
    this.theme.toggle();
  }

  protected toggleLang(): void {
    this.i18n.toggle();
  }

  protected signOut(): void {
    const data: SsConfirmData = {
      content: tr('ნამდვილად გსურთ სისტემიდან გასვლა?'),
      yes: tr('გასვლა'),
      no: tr('გაუქმება'),
    };
    this.dialogs
      .open<boolean>(SsConfirmComponent, { label: tr('გასვლა'), size: 's', data })
      .pipe(take(1))
      .subscribe((confirmed) => {
        if (!confirmed) {
          return;
        }
        this.auth.logout();
        // The cached tenant must go with the session — otherwise the next login
        // (possibly a different operator) reads the previous academy, and a
        // cached `null` (superadmin) makes every module render empty.
        this.tenant.clear();
        this.router.navigate(['/login']);
      });
  }

  protected toggleConfigDropdown(): void {
    this.superAdminDropdownOpen.set(false);
    this.configDropdownOpen.update((open) => !open);
  }

  protected toggleSuperDropdown(): void {
    this.configDropdownOpen.set(false);
    this.superAdminDropdownOpen.update((open) => !open);
  }

  protected closeSheets(): void {
    this.configDropdownOpen.set(false);
    this.superAdminDropdownOpen.set(false);
  }
}
