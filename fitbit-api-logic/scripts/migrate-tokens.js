/**
 * Firestore トークンデータ移行スクリプト
 *
 * 目的: 既存のトークンデータ（Firebase UID をキーとするもの）を
 *       新しい形式（Fitbit User ID をキーとするもの）に移行する
 *
 * 実行方法:
 *   node migrate-tokens.js
 *
 * 環境変数:
 *   GCP_PROJECT: Google Cloud プロジェクトID
 *   DRY_RUN: "true" に設定すると、実際の書き込みを行わずに確認のみ行う
 *
 * 注意:
 *   - このスクリプトは既存データを削除せず、新しい形式でデータを追加（INSERT）します
 *   - まずステージング環境で実行し、動作を確認してください
 *   - 実行前に必ずバックアップを取得してください
 */

import admin from "firebase-admin";

// 環境変数の検証
if (!process.env.GCP_PROJECT) {
  console.error("エラー: 実行には環境変数 GCP_PROJECT が必要です。");
  console.error(
    "使用方法: GCP_PROJECT=your-project-id node scripts/migrate-tokens.js"
  );
  process.exit(1);
}

// Firebase Admin SDKを初期化
if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: process.env.GCP_PROJECT,
  });
}

const db = admin.firestore();
const FITBIT_TOKENS_COLLECTION = "fitbit_tokens";

// DRY_RUN モード（環境変数で制御）
const DRY_RUN = process.env.DRY_RUN === "true";

/**
 * 移行処理のメイン関数
 */
async function migrateTokens() {
  console.log("=== Firestore トークンデータ移行スクリプト ===");
  console.log(`モード: ${DRY_RUN ? "DRY RUN（確認のみ）" : "本番実行"}`);
  console.log(`プロジェクト: ${process.env.GCP_PROJECT}`);
  console.log("");

  try {
    // 既存の全トークンドキュメントを取得
    const snapshot = await db.collection(FITBIT_TOKENS_COLLECTION).get();

    if (snapshot.empty) {
      console.log("移行対象のトークンが見つかりませんでした。");
      return;
    }

    console.log(`取得したドキュメント数: ${snapshot.size}`);
    console.log("");

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // 各ドキュメントを処理
    for (const doc of snapshot.docs) {
      const docId = doc.id;
      const data = doc.data();

      console.log(`処理中: ドキュメントID = ${docId}`);

      // 既に新形式のドキュメントかチェック
      // 新形式: firebaseUids 配列フィールドが存在する
      if (data.firebaseUids && Array.isArray(data.firebaseUids)) {
        console.log(`  → スキップ: 既に新形式です`);
        skippedCount++;
        continue;
      }

      // 旧形式: firebaseUid（単一）フィールドが存在し、fitbitUserId も存在する
      if (!data.firebaseUid || !data.fitbitUserId) {
        console.log(`  → スキップ: 必要なフィールドが不足しています`);
        console.log(`    firebaseUid: ${data.firebaseUid || "(なし)"}`);
        console.log(`    fitbitUserId: ${data.fitbitUserId || "(なし)"}`);
        skippedCount++;
        continue;
      }

      try {
        // 新しい形式のドキュメントデータを作成
        const newDocId = data.fitbitUserId;
        const newData = {
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresAt: data.expiresAt,
          fitbitUserId: data.fitbitUserId,
          firebaseUids: admin.firestore.FieldValue.arrayUnion(data.firebaseUid),
        };

        console.log(`  → 移行先: ドキュメントID = ${newDocId}`);
        console.log(`    Firebase UID: ${data.firebaseUid}`);
        console.log(`    Fitbit User ID: ${data.fitbitUserId}`);

        if (!DRY_RUN) {
          // 新しいドキュメントを作成（merge: true で既存データを保持）
          await db
            .collection(FITBIT_TOKENS_COLLECTION)
            .doc(newDocId)
            .set(newData, { merge: true });
          console.log(`  ✓ 移行完了`);
        } else {
          console.log(`  ✓ 移行予定（DRY RUN）`);
        }

        migratedCount++;
      } catch (error) {
        console.error(`  ✗ エラー: ${error.message}`);
        errorCount++;
      }

      console.log("");
    }

    // 結果サマリー
    console.log("=== 移行結果 ===");
    console.log(`移行済み: ${migratedCount} 件`);
    console.log(`スキップ: ${skippedCount} 件`);
    console.log(`エラー: ${errorCount} 件`);
    console.log(`合計: ${snapshot.size} 件`);

    if (DRY_RUN) {
      console.log("");
      console.log("※ これは DRY RUN です。実際のデータは変更されていません。");
      console.log(
        "本番実行するには、環境変数 DRY_RUN を設定せずに実行してください。"
      );
    }
  } catch (error) {
    console.error("移行処理中にエラーが発生しました:", error);
    process.exit(1);
  }
}

// スクリプト実行
migrateTokens()
  .then(() => {
    console.log("");
    console.log("移行スクリプトが正常に完了しました。");
    process.exit(0);
  })
  .catch((error) => {
    console.error("予期しないエラー:", error);
    process.exit(1);
  });
