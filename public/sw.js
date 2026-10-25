// GD Arena's service worker. A GD needs the network (the AI participants and scoring run on
// the server), so nothing is cached: when the app is opened with no connection, it shows a
// friendly offline page instead of the browser's error.

const OFFLINE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GD Arena · Offline</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7f9; --ink: #12151a; --ink-2: #454c57; --accent: #4f46e5; --accent-2: #9333ea; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0c0e12; --ink: #eef1f6; --ink-2: #b4bcc8; --accent: #8b85ff; --accent-2: #c084fc; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--ink);
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; text-align: center; padding: 24px; box-sizing: border-box; }
  .mark { width: 64px; height: 64px; border-radius: 18px; margin: 0 auto 20px;
          background: linear-gradient(135deg, var(--accent), var(--accent-2)); }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { margin: 0 auto 20px; max-width: 22rem; color: var(--ink-2); }
  button { font: inherit; font-weight: 600; color: #fff; border: 0; border-radius: 12px; padding: 12px 20px; cursor: pointer;
           background: linear-gradient(135deg, var(--accent), var(--accent-2)); }
</style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true"></div>
    <h1>You're offline</h1>
    <p>GD Arena needs an internet connection for the AI participants and your scorecard. Reconnect and try again.</p>
    <button onclick="location.reload()">Try again</button>
  </main>
</body>
</html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
    ),
  );
});
