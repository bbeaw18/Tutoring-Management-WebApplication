import { bootstrapApplication } from '@angular/platform-browser';
import { registerLocaleData } from '@angular/common';
import localeTh from '@angular/common/locales/th';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// Register <lottie-player> custom element globally for empty-state animations.
import '@lottiefiles/lottie-player';

registerLocaleData(localeTh);
bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
