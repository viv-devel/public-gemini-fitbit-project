import admin from "firebase-admin";
import { AuthenticationError } from "./errors.js";

// Firebase Admin SDKを初期化
// このチェックにより、一度だけ初期化されることを保証します。
if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: process.env.GCP_PROJECT,
  });
}

const db = admin.firestore();

// トークン用のFirestoreコレクション
const FITBIT_TOKENS_COLLECTION = "fitbit_tokens";

/**
 * Firebase IDトークンを検証し、デコードされたトークンを返します。
 * @param {string} idToken フロントエンドから送信されたIDトークン。
 * @returns {Promise<admin.auth.DecodedIdToken>} デコードされたトークン。
 */
export async function verifyFirebaseIdToken(idToken) {
  if (!idToken) {
    throw new AuthenticationError("ID token is required.");
  }
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error("Error verifying Firebase ID token:", error);
    throw new AuthenticationError("Invalid ID token.");
  }
}

/**
 * 指定されたFirebaseユーザーIDのトークンをFirestoreから取得します。
 * @param {string} firebaseUid ユーザーのFirebase UID。
 * @returns {Promise<object|null>} トークンオブジェクトを含むPromise、見つからない場合はnull。
 */
export async function getTokensFromFirestore(firebaseUid) {
  const querySnapshot = await db
    .collection(FITBIT_TOKENS_COLLECTION)
    .where("firebaseUids", "array-contains", firebaseUid)
    .limit(1)
    .get();

  if (querySnapshot.empty) {
    console.log(`No token found for user ${firebaseUid}`);
    return null;
  }

  return querySnapshot.docs[0].data();
}

/**
 * ユーザーのトークンをFirestoreに保存または更新します。
 * ドキュメントIDとしてFitbit User IDを使用し、FirebaseユーザーIDは配列フィールドに保存します。
 * @param {string} firebaseUid ユーザーのFirebase UID。
 * @param {string} fitbitUserId ユーザーのFitbit ID。
 * @param {object} tokens Fitbit APIレスポンスからのトークンオブジェクト。
 */
export async function saveTokensToFirestore(firebaseUid, fitbitUserId, tokens) {
  const expiresAt = new Date().getTime() + tokens.expires_in * 1000;
  const tokenData = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: expiresAt,
    fitbitUserId: fitbitUserId,
    firebaseUids: admin.firestore.FieldValue.arrayUnion(firebaseUid),
  };

  await db
    .collection(FITBIT_TOKENS_COLLECTION)
    .doc(fitbitUserId)
    .set(tokenData, { merge: true });
  console.log(
    `Successfully saved tokens for Firebase user ${firebaseUid} (Fitbit user ${fitbitUserId})`
  );
}
