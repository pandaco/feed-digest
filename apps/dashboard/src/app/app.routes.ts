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
    path: 'saved',
    loadComponent: () =>
      import('./pages/saved/saved').then((m) => m.SavedComponent),
  },
  {
    path: 'triage',
    loadComponent: () =>
      import('./pages/triage/triage').then((m) => m.TriageComponent),
  },
  {
    path: 'snoozed',
    loadComponent: () =>
      import('./pages/snoozed/snoozed').then((m) => m.SnoozedComponent),
  },
  {
    path: 'reader/:articleId/:source',
    loadComponent: () =>
      import('./pages/reader/reader').then((m) => m.ReaderComponent),
  },
  {
    path: 'interests',
    loadComponent: () =>
      import('./pages/interests/interests').then((m) => m.InterestsComponent),
  },
  {
    path: 'preferences',
    loadComponent: () =>
      import('./pages/tag-preferences/tag-preferences').then(
        (m) => m.TagPreferencesComponent
      ),
  },
];
