import { Buffer } from 'buffer';
import { accessSecretVersion } from './secrets.js';
import {
    verifyFirebaseIdToken,
    getTokensFromFirestore,
} from './firebase.js';
import {
    exchangeCodeForTokens,
    refreshFitbitAccessToken,
    processAndLogFoods,
} from './fitbit.js';

// Check for required environment variables
if (!process.env.GCP_PROJECT) {
    throw new Error('GCP_PROJECT environment variable is not set. This is required for Secret Manager access.');
}
if (!process.env.FITBIT_REDIRECT_URI) {
    throw new Error('FITBIT_REDIRECT_URI environment variable is not set.');
}

// Secret Manager secret names for application credentials
const PROJECT_ID = process.env.GCP_PROJECT;
const FITBIT_CLIENT_ID_NAME = `projects/${PROJECT_ID}/secrets/FITBIT_CLIENT_ID/versions/latest`;
const FITBIT_CLIENT_SECRET_NAME = `projects/${PROJECT_ID}/secrets/FITBIT_CLIENT_SECRET/versions/latest`;

/**
 * Main Cloud Function
 */
export const fitbitWebhookHandler = async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(204).send('');
    }

    try {
        const [clientId, clientSecret] = await Promise.all([
            accessSecretVersion(FITBIT_CLIENT_ID_NAME),
            accessSecretVersion(FITBIT_CLIENT_SECRET_NAME),
        ]);

        // OAuth callback: Exchange authorization code for tokens
        if (req.method === 'GET' && req.query.code) {
            const state = req.query.state;
            if (!state) {
                return res.status(400).send('Invalid request: state parameter is missing.');
            }
            
            let firebaseUid, redirectUri;
            try {
                // Expect state to contain Firebase UID and redirect URL
                const decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
                firebaseUid = decodedState.firebaseUid;
                redirectUri = decodedState.redirectUri;
            } catch (e) {
                return res.status(400).send('Invalid state: could not decode state parameter.');
            }

            if (!firebaseUid) {
                return res.status(400).send('Invalid state: Firebase UID is missing.');
            }

            await exchangeCodeForTokens(clientId, clientSecret, req.query.code, firebaseUid);

            if (redirectUri) {
                const redirectUrl = new URL(redirectUri);
                // Use Firebase UID instead of Fitbit user ID in query params
                redirectUrl.searchParams.set('uid', firebaseUid);
                return res.redirect(302, redirectUrl.toString());
            }
            return res.status(200).send(`Authorization successful! User UID: ${firebaseUid}. You can close this page.`);
        }

        // Main logic: Process food logging requests (requires authentication)
        if (req.method === 'POST') {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'Unauthorized: Authorization header is missing or invalid.' });
            }
            const idToken = authHeader.split('Bearer ')[1];

            // Verify ID token to get Firebase UID
            const decodedToken = await verifyFirebaseIdToken(idToken);
            const firebaseUid = decodedToken.uid;

            const nutritionData = req.body;

            if (!nutritionData || !nutritionData.foods || !Array.isArray(nutritionData.foods)) {
                return res.status(400).json({ error: 'Invalid JSON body. Required: meal_type, log_date, log_time, and a non-empty "foods" array.' });
            }

            let tokens = await getTokensFromFirestore(firebaseUid);
            if (!tokens) {
                return res.status(401).json({ error: `No tokens found for user ${firebaseUid}. Please complete the OAuth flow.` });
            }

            let accessToken;
            // Check if token is expired and refresh if necessary
            if (new Date().getTime() >= tokens.expiresAt) {
                console.log(`Token for user ${firebaseUid} has expired. Refreshing...`);
                accessToken = await refreshFitbitAccessToken(firebaseUid, clientId, clientSecret);
            } else {
                accessToken = tokens.accessToken;
            }

            // Use Fitbit user ID from Firestore
            const fitbitUserId = tokens.fitbitUserId;
            if (!fitbitUserId) {
                 return res.status(500).json({ error: 'Fitbit user ID not found in the database.' });
            }

            const fitbitResponses = await processAndLogFoods(accessToken, nutritionData, fitbitUserId);

            return res.status(200).json({
                message: 'All foods logged successfully to Fitbit.',
                loggedData: nutritionData,
                fitbitResponses: fitbitResponses
            });
        }

        return res.status(405).send('Method Not Allowed');

    } catch (error) {
        console.error('Unhandled error in fitbitWebhookHandler:', error);
        // Return 401 or 403 for authentication-related errors
        if (error.message.includes('ID token') || error.message.includes('Unauthorized')) {
            return res.status(401).json({ error: error.message });
        }
        return res.status(500).json({ error: error.message || 'An internal server error occurred.' });
    }
};
