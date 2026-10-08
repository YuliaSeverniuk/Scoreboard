import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: 'board', loadComponent: () => import('./pages/board-page').then((m) => m.BoardPage) },
  { path: 'control', loadComponent: () => import('./pages/control-page').then((m) => m.ControlPage) },
  { path: 'console', loadComponent: () => import('./pages/console-page').then((m) => m.ConsolePage) },
  { path: '', pathMatch: 'full', redirectTo: 'console' },
];
