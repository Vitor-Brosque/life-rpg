/// <reference lib="webworker" />
// Service worker (vite-plugin-pwa, injectManifest). Type-checked with tsconfig.sw.json (WebWorker
// lib), not with the app's DOM tsconfig.
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

// registerType 'autoUpdate': a new worker takes over right away; the page reloads via registerSW.
void self.skipWaiting();
clientsClaim();

// App shell: every built asset (JS, CSS, HTML, icons, fonts) is precached, so the app opens offline.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Client-side routes (/planejar, /jornadas/…) open index.html offline. /api/* is never intercepted:
// sync, SSE and push always go to the network.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api(\/|$)/] }));

interface PushPayload { title?: string; body?: string; tag?: string }

function readPayload(event: PushEvent): PushPayload {
  if (!event.data) return {};
  try {
    return event.data.json() as PushPayload;
  } catch {
    return { body: event.data.text() };
  }
}

// Server push (§14): {title, body, tag} scheduled by the app (timer end, commitment reminders).
self.addEventListener('push', (event) => {
  const { title, body, tag } = readPayload(event);
  event.waitUntil(self.registration.showNotification(title || 'LIFE RPG', {
    body: body ?? '',
    ...(tag ? { tag } : {}),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  }));
});

// Tapping a notification focuses the open app, or opens it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      return;
    }
    await self.clients.openWindow('/');
  })());
});
