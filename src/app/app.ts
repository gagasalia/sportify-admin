import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TPipe } from './shared/i18n/t.pipe';
import { LoadingService } from './shared/services/loading.service';
import { SsThemeService } from './shared/ui/theme.service';
import { SsUiOutletComponent } from './shared/ui/ui-outlet.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SsUiOutletComponent, TPipe],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
})
export class App {
  private readonly loadingService = inject(LoadingService);
  /** Instantiated here so the theme attribute lands on <html> at startup. */
  protected readonly theme = inject(SsThemeService);
  protected readonly loading = this.loadingService.loading;
}
