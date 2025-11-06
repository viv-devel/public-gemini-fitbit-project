import admin from 'firebase-admin';

// Initialize Firebase Admin SDK
// This check ensures that it's initialized only once.
if (admin.apps.length === 0) {
    admin.initializeApp({
        projectId: process.env.GCP_PROJECT,
    });
}

const db = admin.firestore();

// Firestore collection for tokens
const FITBIT_TOKENS_COLLECTION = 'fitbit_tokens';

/**
 * Verifies the Firebase ID token and returns the decoded token.
 * @param {string} idToken The ID token sent from the frontend.
 * @returns {Promise<admin.auth.DecodedIdToken>} The decoded token.
 */
export async function verifyFirebaseIdToken(idToken) {
    if (!idToken) {
        throw new Error('ID token is required.');
    }
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        return decodedToken;
    } catch (error) {
        console.error('Error verifying Firebase ID token:', error);
        throw new Error('Invalid ID token.');
    }
}

/**
 * Retrieves tokens for a given Firebase user ID from Firestore.
 * @param {string} firebaseUid The Firebase UID of the user.
 * @returns {Promise<object|null>} A promise containing the token object, or null if not found.
 */
export async function getTokensFromFirestore(firebaseUid) {
    const tokenDoc = await db.collection(FITBIT_TOKENS_COLLECTION).doc(firebaseUid).get();
    if (!tokenDoc.exists) {
        console.log(`No token found for user ${firebaseUid}`);
        return null;
    }
    return tokenDoc.data();
}

/**
 * Saves or updates a user's tokens in Firestore.
 * Uses Firebase UID as the document ID and also stores the Fitbit user ID within the document.
 * @param {string} firebaseUid The Firebase UID of the user.
 * @param {string} fitbitUserId The Fitbit ID of the user.
 * @param {object} tokens The token object from the Fitbit API response.
 */
export async function saveTokensToFirestore(firebaseUid, fitbitUserId, tokens) {
    const expiresAt = new Date().getTime() + (tokens.expires_in * 1000);
    const tokenData = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: expiresAt,
        fitbitUserId: fitbitUserId, // Save Fitbit user ID
        firebaseUid: firebaseUid,   // Save Firebase UID
    };

    await db.collection(FITBIT_TOKENS_COLLECTION).doc(firebaseUid).set(tokenData, { merge: true });
    console.log(`Successfully saved tokens for Firebase user ${firebaseUid} (Fitbit user ${fitbitUserId})`);
}
