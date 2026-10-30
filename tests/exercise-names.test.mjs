import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISE_NAMES, normalizeName, suggestNames } from '../js/exercise-names.js';
import { PARTS } from '../js/store.js';

const names = (list) => list.map((s) => s.name);

test('候補の一覧：部位は PARTS の id、名前は重ならず25文字以内', () => {
  const ids = new Set(PARTS.map((p) => p.id));
  for (const { name, part } of EXERCISE_NAMES) {
    assert.ok(ids.has(part), `${name} の部位 ${part}`);
    assert.ok(name.length > 0 && Array.from(name).length <= 25, name);
  }
  assert.equal(new Set(EXERCISE_NAMES.map((e) => normalizeName(e.name))).size, EXERCISE_NAMES.length);
  for (const p of PARTS) assert.ok(EXERCISE_NAMES.some((e) => e.part === p.id), `${p.id} の候補がない`);
});

test('ひらがなはカタカナとして探す', () => {
  assert.deepEqual(names(suggestNames('すく')), ['スクワット', 'ブルガリアンスクワット']);
});

test('前から合うものを先に出す', () => {
  const r = names(suggestNames('ベン'));
  assert.deepEqual(r.slice(0, 2), ['ベンチプレス', 'ベントオーバーロウ']);
  assert.ok(r.includes('インクラインベンチプレス'));
});

test('名前と部位を返す', () => {
  assert.deepEqual(suggestNames('ラット'), [{ name: 'ラットプルダウン', part: 'back' }]);
});

test('前後の空白・全角半角・大文字小文字のちがいを吸収する', () => {
  const list = [{ name: 'Tバーロウ', part: 'back' }, { name: 'ＥＺバーカール', part: 'arms' }];
  assert.deepEqual(names(suggestNames('  ｔ ', [], 5, list)), ['Tバーロウ']);
  assert.deepEqual(names(suggestNames('ez', [], 5, list)), ['ＥＺバーカール']);
  assert.deepEqual(names(suggestNames('ｽｸﾜｯﾄ')), ['スクワット', 'ブルガリアンスクワット']);
});

test('登録ずみの名前（同じ正規化で同じもの）は出さない', () => {
  assert.deepEqual(names(suggestNames('すく', ['スクワット'])), ['ブルガリアンスクワット']);
  assert.deepEqual(names(suggestNames('すく', [' ｽｸﾜｯﾄ '])), ['ブルガリアンスクワット']);
});

test('空や空白だけなら出さない。合わなければ出さない', () => {
  assert.deepEqual(suggestNames(''), []);
  assert.deepEqual(suggestNames('   '), []);
  assert.deepEqual(suggestNames(undefined), []);
  assert.deepEqual(suggestNames('ほげほげ'), []);
});

test('最大5つ（limit で変えられる）', () => {
  assert.equal(suggestNames('レ').length, 5);
  assert.equal(suggestNames('レ', [], 2).length, 2);
});
