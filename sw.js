// サービスワーカー：電波がなくても開けるようにする
// ネットワーク優先（電波があるときはいつも最新を読む）。取れなかったときだけキャッシュを使う
// 同じ origin にほかのリポジトリのページもあるので、キャッシュの名前は wrp- で始める
// localStorage には触らない

const CACHE_PREFIX = 'wrp-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;
// ページを開く要求で、これだけ待ってもネットワークが返さなければキャッシュを返す
const NAVIGATE_TIMEOUT_MS = 4000;

// 先にキャッシュするファイル（ファイルを足したら、ここにも足す。tests/sw.test.mjs で確かめる）
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/base.css',
  './css/suggest.css',
  './js/app.js',
  './js/exercise-names.js',
  './js/history-screen.js',
  './js/home-screen.js',
  './js/record-screen.js',
  './js/records.js',
  './js/select-screen.js',
  './js/store.js',
  './js/timer.js',
  './js/ui.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // HTTP キャッシュを通さず、最新を入れる
    await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // wrp- で始まる古いキャッシュだけ消す（ほかの名前には触らない）
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// ページをキャッシュから返した画面の id。その画面のファイルもキャッシュから返し、版がまざらないようにする
// （サービスワーカーが止まると消える。そのときはネットワーク優先に戻るだけ）
const cachedClientIds = new Set();

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(respondPage(event));
    return;
  }
  if (event.clientId && cachedClientIds.has(event.clientId)) {
    event.respondWith(respondFileFromCache(event));
    return;
  }
  const network = fetch(request, { cache: 'no-cache' });
  event.waitUntil(storeResponse(request, network));
  event.respondWith(respondFile(request, network));
});

// 取れたらキャッシュを上書きする（キャッシュを返したあとに届いても入れる）
function storeResponse(key, network) {
  return network.then((response) => {
    if (!response.ok) return undefined;
    const copy = response.clone();
    return caches.open(CACHE_NAME).then((cache) => cache.put(key, copy));
  }).catch(() => {});
}

// ファイル：ネットワークが取れなければキャッシュ
async function respondFile(request, network) {
  try {
    const response = await network;
    if (response.ok) return response;
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(request)) || response;
  } catch (error) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

// キャッシュから開いた画面のファイル：ネットワークを待たずにキャッシュ。なければネットワーク
async function respondFileFromCache(event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const network = fetch(event.request, { cache: 'no-cache' });
  event.waitUntil(storeResponse(event.request, network));
  return network;
}

// ページ：ネットワークが取れないか、しばらく返さなければキャッシュ
async function respondPage(event) {
  const key = pageCacheKey(event.request.url);
  // navigate の要求に init を付けて作り直すと古いブラウザーで TypeError になるので、URL で取る
  const network = fetch(event.request.url, { cache: 'no-cache', credentials: 'same-origin' });
  event.waitUntil(storeResponse(key, network));

  const cached = await matchPage(key);
  if (!cached) return network;
  const fresh = network.then((response) => (response.ok ? response : null), () => null);
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAVIGATE_TIMEOUT_MS));
  const response = await Promise.race([fresh, timeout]);
  if (response) return response;
  event.waitUntil(rememberCachedClient(event.resultingClientId));
  return cached;
}

// 閉じた画面の id を消してから、新しい id を覚える
async function rememberCachedClient(id) {
  const ids = [...cachedClientIds];
  const found = await Promise.all(ids.map((old) => self.clients.get(old)));
  ids.forEach((old, i) => { if (!found[i]) cachedClientIds.delete(old); });
  if (id) cachedClientIds.add(id);
}

// ページをキャッシュに入れる URL：クエリとハッシュを外す（?hint= ごとに増えないように）
function pageCacheKey(url) {
  const key = new URL(url);
  key.search = '';
  key.hash = '';
  return key.href;
}

async function matchPage(key) {
  const cache = await caches.open(CACHE_NAME);
  return (await cache.match(key)) || (await cache.match('./'));
}
