// WordSprout service worker.
//
// This is intentionally a network-only pass-through with NO caching. WordSprout
// requires an internet connection to function (it talks to Supabase for every
// screen), and you redeploy index.html frequently by replacing the whole file
// on GitHub — a caching service worker would risk serving students a stale
// version of the app after you ship an update. The only reason this file
// exists at all is that Chrome/Android require a registered service worker
// with a fetch handler before they'll offer the "Install app" prompt.
//
// If you ever want offline support later, this is the file to extend — but
// that's a deliberately separate, bigger project, not something to bolt on
// here without careful testing against your deploy workflow.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
