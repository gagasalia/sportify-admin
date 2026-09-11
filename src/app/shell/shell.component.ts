import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, take } from 'rxjs';
import { I18nService } from '../shared/i18n/i18n.service';
import { tr } from '../shared/i18n/lang';
import { TPipe } from '../shared/i18n/t.pipe';
import { AuthService } from '../shared/services/auth.service';
import { TenantService } from '../shared/services/tenant.service';
import { SsConfirmComponent, SsConfirmData } from '../shared/ui/confirm.component';
import { SsDialogService } from '../shared/ui/dialog.service';
import { SsThemeService } from '../shared/ui/theme.service';

/** Routes that own a mobile tab of their own; everything else sits in the sheet. */
const TAB_ROUTES = ['/reservations', '/statistics', '/customers'];

/**
 * Authenticated application chrome: header, sidebar, mobile tab bar and the
 * dark-mode toggle. Rendered only behind the route-level `authGuard`, so the
 * shell never paints (and never reads auth state) on the public `/login` page.
 * Feature pages render into the shell's own `<router-outlet>`.
 *
 * The chrome is plain kit markup (ss-* classes + `.ss-ic` mask icons); theming
 * runs through `SsThemeService`, which stamps `[tuiTheme]` on `<html>`.
 * Accordion groups auto-open when the current URL is inside their section. The
 * mobile bar carries only the three day-to-day destinations (reservations,
 * statistics, customers) plus a "Menu" tab: everything else lives in a bottom
 * sheet, so the bar never degrades into eight truncated labels.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [NgTemplateOutlet, RouterOutlet, RouterLink, RouterLinkActive, TPipe],
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

  /** Mobile "Menu" sheet (everything not on the tab bar). */
  protected menuOpen = signal(false);

  /** Current URL, so the Menu tab can light up for the routes it hides. */
  private readonly url = signal(this.router.url);

  /** True while the open page is one of the sheet's destinations. */
  protected readonly inMenuSection = computed(
    () => !TAB_ROUTES.some((route) => this.url().startsWith(route)),
  );

  constructor() {
    this.checkMobile();
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((e) => {
        this.url.set(e.urlAfterRedirects);
        // Back/forward also dismisses the sheet, not just taps on its tiles.
        this.menuOpen.set(false);
      });

    // The sheet is modal: freeze the page behind it so a stray drag scrolls the
    // menu rather than the list underneath.
    effect(() => {
      const open = this.menuOpen();
      if (typeof document !== 'undefined') {
        // Both elements: with `<html>` left scrollable the body rule alone does
        // not stop the page from moving under the sheet.
        document.documentElement.style.overflow = open ? 'hidden' : '';
        document.body.style.overflow = open ? 'hidden' : '';
      }
    });
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.closeMenu();
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
    if (!this.isMobile() && !this.expanded()) {
      this.expanded.set(true);
      this.configOpen.set(true);
      return;
    }
    this.configOpen.update((o) => !o);
  }

  protected toggleSuper(): void {
    if (!this.isMobile() && !this.expanded()) {
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

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }
}
