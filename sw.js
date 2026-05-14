/* eslint-disable no-undef */
// 另外的价钱 · Service Worker
// 策略：核心壳层走 stale-while-revalidate，新版本自动接管

const CACHE_VERSION = 'v1.3.0';
const CACHE_NAME = `another-price-${CACHE_VERSION}`;

// 离线壳层（注意 index.html 必须 precache，否则首屏白屏）
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/vendor/qrcode.min.js',
  '/manifest.webmanifest',
  '/assets/logo.svg',
  '/assets/logo-192.png',
  '/assets/logo-512.png',
  '/assets/favicon-32.png',
  '/assets/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // 单个失败不阻塞整体安装
      Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url))),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('another-price-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 同源才走 SW；第三方资源直连
  if (url.origin !== self.location.origin) return;

  // hash 路由参数不应进入缓存键 —— fetch 不带 hash，无需特殊处理
  // 对 HTML 导航请求：network-first + 缓存兜底（保证离线可开页）
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    );
    return;
  }

  // 其它静态资源：stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    }),
  );
});
