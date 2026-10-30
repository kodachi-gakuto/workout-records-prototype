# 筋トレ記録（試作）

iPhone の筋トレ記録アプリの Web 版プロトタイプです。Safari で開いて「ホーム画面に追加」して使います。ベータの検証（5人・2週間）が終わったら捨てる前提のコードです。

- URL：https://kodachi-gakuto.github.io/workout-records-prototype/
- HTML・CSS・JavaScript だけ（ビルドなし・ライブラリなし）
- 記録は localStorage の `wrp:data` に1つの JSON で保存します
- 同じドメイン（kodachi-gakuto.github.io）のほかのページで `localStorage.clear()` を使わないこと（このアプリの記録も消えます）
- 同じドメインのほかのページで Cache Storage をまとめて消さないこと（電波がないときに、このアプリを開けなくなります）
- サービスワーカー（`sw.js`）で、電波がなくても開けます。ネットワーク優先で、電波があるときはいつも最新を読み、取れないときだけキャッシュを使います
- キャッシュの名前は `wrp-` で始めます（同じドメインのほかのページのキャッシュと分けるため）。js・css・icons にファイルを足したら、`sw.js` の `PRECACHE_URLS` にも足すこと（`node --test` で確かめます）

## ローカルで開く

```
python3 -m http.server
```

ブラウザーで http://localhost:8000/ を開きます（ES モジュールを使うので、ファイルを直接開くと動きません）。

## テスト

```
node --test
```
