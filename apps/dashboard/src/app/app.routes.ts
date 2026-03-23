import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
    redirectTo: 'preferences',
    pathMatch: 'full',
  },
  {
    path: 'preferences',
    loadComponent: () =>
      import('./pages/tag-preferences/tag-preferences').then(
        (m) => m.TagPreferencesComponent
      ),
  },
];
