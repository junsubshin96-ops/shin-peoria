// 오프라인 캐시.
// - 페이지(HTML)와 스크립트(peoria.js·sync.js)는 네트워크 먼저: 인터넷이 되면 항상 최신이고 둘이 같은 버전으로 맞는다.
//   안 되면 캐시로 연다.
// - 나머지 파일(아이콘·글꼴·manifest)은 캐시 먼저 + 뒤에서 갱신.
// - 설치 때는 브라우저 HTTP 캐시를 건너뛰고 서버에서 새로 받는다(옛 파일이 끼어드는 것 방지).
// - 정상 응답(200, 같은 출처 또는 CORS)만 캐시에 넣는다. 오류 페이지나 불투명 응답이 저장되지 않게.
// CACHE 값은 build.mjs 가 빌드 시각으로 바꿔 넣는다.
const CACHE = 'peoria-20261117105116';
const ASSETS = ['./', './index.html', './peoria.js', './manifest.webmanifest',
  './sync.js', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

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

const cacheable = (res) => res && res.ok && (res.type === 'basic' || res.type === 'cors');

function networkFirst(e, req, key) {
  e.respondWith(fetch(req, { cache: 'no-cache' })
    .then((res) => {
      if (cacheable(res)) {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE).then((c) => c.put(key, copy)));
      }
      return res;
    })
    .catch(() => caches.match(key, { ignoreSearch: true }).then((hit) => hit || Response.error())));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !isFont) return;

  if (req.mode === 'navigate') return networkFirst(e, req, './index.html');
  if (sameOrigin && url.pathname.endsWith('/peoria.js')) return networkFirst(e, req, './peoria.js');
  if (sameOrigin && url.pathname.endsWith('/sync.js')) return networkFirst(e, req, './sync.js');

  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => {
      if (cacheable(res)) cache.put(req, res.clone());
      return res;
    }).catch(() => hit || Response.error());
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});
