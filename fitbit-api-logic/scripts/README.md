# トークンデータ移行スクリプト

## 概要

このスクリプトは、Firestore の `fitbit_tokens` コレクション内の既存トークンデータを、旧形式（Firebase UID をドキュメントキーとする）から新形式（Fitbit User ID をドキュメントキーとする）に移行します。

## 移行の仕組み

### 旧形式

```
fitbit_tokens/
  └── {firebaseUid}/
        ├── accessToken
        ├── refreshToken
        ├── expiresAt
        ├── fitbitUserId
        └── firebaseUid
```

### 新形式

```
fitbit_tokens/
  └── {fitbitUserId}/
        ├── accessToken
        ├── refreshToken
        ├── expiresAt
        ├── fitbitUserId
        └── firebaseUids: [firebaseUid1, firebaseUid2, ...]
```

## 実行方法

### 1. DRY RUN（確認のみ）

実際のデータを変更せず、移行内容を確認します。

```bash
cd fitbit-api-logic
GCP_PROJECT=your-project-id DRY_RUN=true node scripts/migrate-tokens.js
```

または npm script を使用:

```bash
npm run migrate:dry-run
```

### 2. 本番実行

実際にデータを移行します。**必ずステージング環境で先に実行してください。**

```bash
cd fitbit-api-logic
GCP_PROJECT=your-project-id node scripts/migrate-tokens.js
```

または npm script を使用:

```bash
npm run migrate:prod
```

## 環境変数

| 変数名        | 必須 | 説明                            |
| ------------- | ---- | ------------------------------- |
| `GCP_PROJECT` | ✓    | Google Cloud プロジェクト ID    |
| `DRY_RUN`     | -    | `true` に設定すると確認のみ行う |

## 実行前の確認事項

1. **バックアップの取得**

   - Firestore のバックアップを取得してください
   - [Firestore バックアップガイド](https://cloud.google.com/firestore/docs/backups)

2. **ステージング環境でのテスト**

   - 本番環境で実行する前に、必ずステージング環境で動作を確認してください

3. **権限の確認**
   - スクリプトを実行するアカウントに Firestore への読み取り・書き込み権限があることを確認してください

## スクリプトの動作

1. `fitbit_tokens` コレクションの全ドキュメントを取得
2. 各ドキュメントについて:

   - 既に新形式（`firebaseUids` 配列が存在）の場合 → スキップ
   - 必要なフィールド（`firebaseUid`, `fitbitUserId`）が不足している場合 → スキップ
   - 旧形式の場合 → 新形式のドキュメントを作成（INSERT のみ、DELETE なし）

3. 結果サマリーを表示:
   - 移行済み件数
   - スキップ件数
   - エラー件数

## 注意事項

### データの安全性

- このスクリプトは **INSERT のみ** を行い、既存データを削除しません
- `merge: true` オプションにより、既存の新形式ドキュメントがあっても上書きせず、`firebaseUids` 配列に追加します
- 旧形式のドキュメントは残り続けます（手動で削除する必要があります）

### 複数回実行

- 同じデータに対して複数回実行しても安全です
- `arrayUnion` により、同じ Firebase UID が重複して追加されることはありません

### 移行後の確認

移行後は、以下を確認してください:

1. 新形式のドキュメントが正しく作成されているか
2. `firebaseUids` 配列に正しい値が含まれているか
3. アプリケーションが正常に動作するか

## トラブルシューティング

### エラー: "Permission denied"

- 実行アカウントに Firestore への適切な権限があるか確認してください
- サービスアカウントキーを使用している場合は、`GOOGLE_APPLICATION_CREDENTIALS` 環境変数が正しく設定されているか確認してください

### エラー: "GCP_PROJECT is not set"

- 環境変数 `GCP_PROJECT` が設定されているか確認してください

### 移行がスキップされる

- ドキュメントに `firebaseUid` と `fitbitUserId` の両方が存在するか確認してください
- DRY RUN モードで実行し、詳細なログを確認してください

## 移行後のクリーンアップ（オプション）

移行が成功し、アプリケーションが正常に動作することを確認した後、旧形式のドキュメントを削除できます。

**警告**: この操作は元に戻せません。必ずバックアップを取得してから実行してください。

```javascript
// 旧形式のドキュメントを削除するスクリプト（例）
// 実行前に必ず内容を確認してください
const snapshot = await db.collection("fitbit_tokens").get();
for (const doc of snapshot.docs) {
  const data = doc.data();
  // 旧形式（firebaseUids 配列がない）かつ fitbitUserId が存在する場合
  if (!data.firebaseUids && data.fitbitUserId) {
    await doc.ref.delete();
    console.log(`Deleted old document: ${doc.id}`);
  }
}
```
