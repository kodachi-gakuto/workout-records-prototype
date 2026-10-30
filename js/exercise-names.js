// 種目の登録で出す、名前の入力候補
// 名前はジムでよく使う呼び方（カタカナ中心）。part は store.js の PARTS の id

export const EXERCISE_NAMES = [
  // 胸
  { name: 'ベンチプレス', part: 'chest' },
  { name: 'インクラインベンチプレス', part: 'chest' },
  { name: 'ダンベルプレス', part: 'chest' },
  { name: 'ダンベルフライ', part: 'chest' },
  { name: 'チェストプレス', part: 'chest' },
  { name: 'ペックフライ', part: 'chest' },
  { name: 'ディップス', part: 'chest' },
  { name: 'プッシュアップ', part: 'chest' },
  // 背中
  { name: 'デッドリフト', part: 'back' },
  { name: 'ラットプルダウン', part: 'back' },
  { name: 'チンニング', part: 'back' },
  { name: 'ベントオーバーロウ', part: 'back' },
  { name: 'ワンハンドロウ', part: 'back' },
  { name: 'シーテッドロウ', part: 'back' },
  { name: 'バックエクステンション', part: 'back' },
  // 肩
  { name: 'ショルダープレス', part: 'shoulders' },
  { name: 'サイドレイズ', part: 'shoulders' },
  { name: 'フロントレイズ', part: 'shoulders' },
  { name: 'リアレイズ', part: 'shoulders' },
  { name: 'アップライトロウ', part: 'shoulders' },
  { name: 'フェイスプル', part: 'shoulders' },
  // 腕
  { name: 'バーベルカール', part: 'arms' },
  { name: 'ダンベルカール', part: 'arms' },
  { name: 'ハンマーカール', part: 'arms' },
  { name: 'トライセプスプレスダウン', part: 'arms' },
  { name: 'フレンチプレス', part: 'arms' },
  { name: 'ナローベンチプレス', part: 'arms' },
  // 腹筋
  { name: 'クランチ', part: 'abs' },
  { name: 'レッグレイズ', part: 'abs' },
  { name: 'プランク', part: 'abs' },
  { name: 'アブローラー', part: 'abs' },
  { name: 'ケーブルクランチ', part: 'abs' },
  // 脚
  { name: 'スクワット', part: 'legs' },
  { name: 'ブルガリアンスクワット', part: 'legs' },
  { name: 'レッグプレス', part: 'legs' },
  { name: 'レッグエクステンション', part: 'legs' },
  { name: 'レッグカール', part: 'legs' },
  { name: 'ルーマニアンデッドリフト', part: 'legs' },
  { name: 'ランジ', part: 'legs' },
  { name: 'カーフレイズ', part: 'legs' },
];

// くらべるための形：前後の空白を外し、全角・半角をそろえ（NFKC）、英字は小文字、ひらがなはカタカナ
export function normalizeName(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

// 打った文字を含む候補（前から合うものを先に）。登録ずみの名前は出さない。空なら出さない
export function suggestNames(text, registeredNames = [], limit = 5, names = EXERCISE_NAMES) {
  const q = normalizeName(text);
  if (!q) return [];
  const taken = new Set(registeredNames.map(normalizeName));
  const head = [];
  const rest = [];
  for (const item of names) {
    const n = normalizeName(item.name);
    if (taken.has(n)) continue;
    const at = n.indexOf(q);
    if (at === 0) head.push(item);
    else if (at > 0) rest.push(item);
  }
  return [...head, ...rest].slice(0, limit);
}
