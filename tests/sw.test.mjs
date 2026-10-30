import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));

// sw.js の PRECACHE_URLS を取り出す
function precacheUrls() {
  const source = readFileSync(join(root, 'sw.js'), 'utf8');
  const block = source.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
  assert.ok(block, 'sw.js に PRECACHE_URLS がない');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('先にキャッシュする一覧のファイルがすべて実在する', () => {
  for (const url of precacheUrls()) {
    const path = url === './' ? 'index.html' : url.replace(/^\.\//, '');
    assert.ok(existsSync(join(root, path)), `${url} がない`);
  }
});

test('js・css・icons のファイルと、開くのに要るファイルがすべて一覧に入っている', () => {
  const urls = new Set(precacheUrls());
  const expected = ['./', './index.html', './manifest.webmanifest'];
  for (const dir of ['js', 'css', 'icons']) {
    for (const name of readdirSync(join(root, dir))) {
      if (!name.startsWith('.')) expected.push(`./${dir}/${name}`);
    }
  }
  for (const url of expected) assert.ok(urls.has(url), `${url} が sw.js の一覧にない`);
});

// sw.js を、self をまねた入れ物で読み込み、関数を取り出す
async function loadSw() {
  const { runInNewContext } = await import('node:vm');
  const context = {
    URL,
    self: { addEventListener() {}, location: { origin: 'https://example.com' } },
  };
  runInNewContext(readFileSync(join(root, 'sw.js'), 'utf8'), context);
  return context;
}

test('ページをキャッシュに入れる URL は、クエリとハッシュを外す', async () => {
  const { pageCacheKey } = await loadSw();
  assert.equal(pageCacheKey('https://example.com/app/?hint=1#top'), 'https://example.com/app/');
  assert.equal(pageCacheKey('https://example.com/app/index.html?a=1&b=2'), 'https://example.com/app/index.html');
  assert.equal(pageCacheKey('https://example.com/app/'), 'https://example.com/app/');
});
