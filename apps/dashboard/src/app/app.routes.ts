import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
    redirectTo: 'inbox',
    pathMatch: 'full',
  },
  {
    path: 'inbox',
    loadComponent: () =>
      import('./pages/inbox/inbox').then((m) => m.InboxComponent),
  },
  {
    path: 'preferences',
    loadComponent: () =>
      import('./pages/tag-preferences/tag-preferences').then(
        (m) => m.TagPreferencesComponent
      ),
  },
];
