import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// Register <lottie-player> custom element globally for empty-state animations.
import '@lottiefiles/lottie-player';

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
