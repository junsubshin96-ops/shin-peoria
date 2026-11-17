// 오프라인 캐시.
// - 페이지(HTML)는 네트워크 먼저: 인터넷이 되면 항상 최신, 안 되면 캐시로 연다.
// - 나머지 파일은 캐시 먼저 + 뒤에서 갱신.
// - 설치 때는 브라우저 HTTP 캐시를 건너뛰고 서버에서 새로 받는다(옛 파일이 끼어드는 것 방지).
// CACHE 값은 build.mjs 가 빌드 시각으로 바꿔 넣는다.
const CACHE = 'peoria-20261117090104';
const ASSETS = ['./', './index.html', './peoria.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !isFont) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('./index.html', copy));
        return res;
      })
      .catch(() => caches.match('./index.html')));
    return;
  }

  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
