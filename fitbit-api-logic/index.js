import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import admin from 'firebase-admin';
import fetch from 'node-fetch';
import { Buffer } from 'buffer';

// Firebase Admin SDKを初期化
admin.initializeApp({
    projectId: process.env.GCP_PROJECT,
});
const db = admin.firestore();

// GCP_PROJECT環境変数が設定されていることを確認
if (!process.env.GCP_PROJECT) {
    throw new Error('GCP_PROJECT environment variable is not set. This is required for Secret Manager access.');
}
// FITBIT_REDIRECT_URI環境変数が設定されていることを確認
if (!process.env.FITBIT_REDIRECT_URI) {
    throw new Error('FITBIT_REDIRECT_URI environment variable is not set.');
}

// Secret Managerクライアント
const PROJECT_ID = process.env.GCP_PROJECT;
const secretManagerClient = new SecretManagerServiceClient();

// --- 定数 ---
// トークンを保存するFirestoreコレクション
const FITBIT_TOKENS_COLLECTION = 'fitbit_tokens';

// アプリケーション認証情報用のSecret Managerシークレット名
const FITBIT_CLIENT_ID_NAME = `projects/${PROJECT_ID}/secrets/FITBIT_CLIENT_ID/versions/latest`;
const FITBIT_CLIENT_SECRET_NAME = `projects/${PROJECT_ID}/secrets/FITBIT_CLIENT_SECRET/versions/latest`;

// OAuthフローで使用されるリダイレクトURI
const REDIRECT_URI = process.env.FITBIT_REDIRECT_URI;

// --- ヘルパー関数 ---

/**
 * Google Secret Managerからシークレットにアクセスします。
 */
async function accessSecretVersion(name) {
    try {
        const [version] = await secretManagerClient.accessSecretVersion({ name });
        return version.payload.data.toString('utf8');
    } catch (error) {
        console.error(`Failed to access secret ${name}:`, error);
        throw new Error(`Failed to access secret. Check IAM permissions.`);
    }
}

/**
 * Firebase IDトークンを検証し、デコードされたトークンを返します。
 * @param {string} idToken フロントエンドから送信されたIDトークン。
 * @returns {Promise<admin.auth.DecodedIdToken>} デコードされたトークン。
 */
async function verifyFirebaseIdToken(idToken) {
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
 * Firestoreから指定されたFirebaseユーザーIDのトークンを取得します。
 * @param {string} firebaseUid ユーザーのFirebase UID。
 * @returns {Promise<object|null>} トークンオブジェクトを含むPromise。見つからない場合はnull。
 */
async function getTokensFromFirestore(firebaseUid) {
    const tokenDoc = await db.collection(FITBIT_TOKENS_COLLECTION).doc(firebaseUid).get();
    if (!tokenDoc.exists) {
        console.log(`No token found for user ${firebaseUid}`);
        return null;
    }
    return tokenDoc.data();
}

/**
 * Firestoreに指定されたユーザーのトークンを保存または更新します。
 * ドキュメントIDとしてFirebase UIDを使用し、FitbitユーザーIDもドキュメント内に保存します。
 * @param {string} firebaseUid ユーザーのFirebase UID。
 * @param {string} fitbitUserId ユーザーのFitbit ID。
 * @param {object} tokens Fitbit APIレスポンスのトークンオブジェクト。
 */
async function saveTokensToFirestore(firebaseUid, fitbitUserId, tokens) {
    const expiresAt = new Date().getTime() + (tokens.expires_in * 1000);
    const tokenData = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: expiresAt,
        fitbitUserId: fitbitUserId, // FitbitユーザーIDを保存
        firebaseUid: firebaseUid,   // Firebase UIDを保存
    };

    await db.collection(FITBIT_TOKENS_COLLECTION).doc(firebaseUid).set(tokenData, { merge: true });
    console.log(`Successfully saved tokens for Firebase user ${firebaseUid} (Fitbit user ${fitbitUserId})`);
}


/**
 * 認可コードをアクセストークンとリフレッシュトークンに交換します。
 * @param {string} clientId FitbitクライアントID。
 * @param {string} clientSecret Fitbitクライアントシークレット。
 * @param {string} code 認可コード。
 * @param {string} firebaseUid トークンを関連付けるFirebaseユーザーID。
 * @returns {Promise<object>} Fitbitからのトークンデータ。
 */
async function exchangeCodeForTokens(clientId, clientSecret, code, firebaseUid) {
    const response = await fetch('https://api.fitbit.com/oauth2/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
            client_id: clientId,
        }).toString(),
    });
    const data = await response.json();
    if (!response.ok) {
        console.error('Fitbit token exchange error:', data);
        throw new Error('Failed to exchange code for tokens.');
    }
    console.log('Code exchanged for tokens successfully.');
    // レスポンスのuser_idと渡されたfirebaseUidを使用してトークンをFirestoreに保存
    await saveTokensToFirestore(firebaseUid, data.user_id, data);
    return data;
}


/**
 * 特定のユーザーのFitbitアクセストークンをリフレッシュします。
 * @param {string} firebaseUid ユーザーのFirebase UID。
 * @param {string} clientId FitbitクライアントID。
 * @param {string} clientSecret Fitbitクライアントシークレット。
 * @returns {Promise<string>} 新しいアクセストークン。
 */
async function refreshFitbitAccessToken(firebaseUid, clientId, clientSecret) {
    const currentTokens = await getTokensFromFirestore(firebaseUid);
    if (!currentTokens || !currentTokens.refreshToken) {
        throw new Error(`No refresh token found for user ${firebaseUid}. Please re-authenticate.`);
    }

    const response = await fetch('https://api.fitbit.com/oauth2/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: currentTokens.refreshToken
        }).toString(),
    });

    const newTokens = await response.json();
    if (!response.ok) {
        console.error('Fitbit refresh token error:', newTokens);
        throw new Error(`Fitbit API Refresh Error: ${newTokens.errors ? newTokens.errors[0].message : 'Unknown'}`);
    }

    console.log(`Token refreshed for user ${firebaseUid}.`);
    // Firestoreに保存する際、既存のfitbitUserIdを渡す
    await saveTokensToFirestore(firebaseUid, currentTokens.fitbitUserId, newTokens);
    return newTokens.access_token;
}

/**
 * 特定のユーザーのために食事データを作成し、Fitbitに記録します。
 */
async function processAndLogFoods(accessToken, nutritionData, fitbitUserId) {
    const mealTypeMap = {
        "Breakfast": 1, "Morning Snack": 2, "Lunch": 3, "Afternoon Snack": 4,
        "Dinner": 5, "Anytime": 7
    };
    const mealTypeId = mealTypeMap[nutritionData.meal_type] || 7;

    const getUnitId = (unit) => {
        const unitMap = {
            'g': 1, 'gram': 1, 'grams': 1,
            'ml': 147, 'milliliter': 147, 'milliliters': 147,
            'oz': 13, 'fl oz': 19,
            'serving': 86, '個': 86,
        };
        const lowerCaseUnit = unit ? unit.toLowerCase() : '';
        if (unitMap[lowerCaseUnit]) return unitMap[lowerCaseUnit];
        console.warn(`Unknown unit "${unit}". Defaulting to 'serving'(86).`);
        return 86;
    };

    if (!nutritionData.foods || !Array.isArray(nutritionData.foods) || nutritionData.foods.length === 0) {
        throw new Error('Invalid input: "foods" array is missing or empty.');
    }

    const logPromises = nutritionData.foods.map(async (food) => {
        if (!food.foodName || !food.amount || !food.unit) {
            throw new Error(`Missing required field for food log: ${food.foodName || 'Unknown Food'}.`);
        }

        const unitId = getUnitId(food.unit);

        const createFoodParams = new URLSearchParams();
        createFoodParams.append('name', food.foodName);
        createFoodParams.append('defaultFoodMeasurementUnitId', unitId);
        createFoodParams.append('defaultServingSize', food.amount);
        createFoodParams.append('calories', Math.round(food.calories || 0));
        
        // Add required formType and description, with defaults from documentation
        createFoodParams.append('formType', food.formType || 'DRY');
        createFoodParams.append('description', food.description || `Logged via Gemini: ${food.foodName}`);

        // Map food object keys to Fitbit API parameter names based on documentation
        const nutritionMap = {
            caloriesFromFat: 'caloriesFromFat',
            totalFat_g: 'totalFat',
            transFat_g: 'transFat',
            saturatedFat_g: 'saturatedFat',
            cholesterol_mg: 'cholesterol',
            sodium_mg: 'sodium',
            potassium_mg: 'potassium',
            totalCarbohydrate_g: 'totalCarbohydrate',
            dietaryFiber_g: 'dietaryFiber',
            sugars_g: 'sugars',
            protein_g: 'protein',
            vitaminA_iu: 'vitaminA',
            vitaminB6: 'vitaminB6',
            vitaminB12: 'vitaminB12',
            vitaminC_mg: 'vitaminC',
            vitaminD_iu: 'vitaminD',
            vitaminE_iu: 'vitaminE',
            biotin_mg: 'biotin',
            folicAcid_mg: 'folicAcid',
            niacin_mg: 'niacin',
            pantothenicAcid_mg: 'pantothenicAcid',
            riboflavin_mg: 'riboflavin',
            thiamin_mg: 'thiamin',
            calcium_g: 'calcium',
            copper_g: 'copper',
            iron_mg: 'iron',
            magnesium_mg: 'magnesium',
            phosphorus_g: 'phosphorus',
            iodine_mcg: 'iodine',
            zinc_mg: 'zinc'
        };

        for (const [foodKey, apiParam] of Object.entries(nutritionMap)) {
            if (food[foodKey] !== undefined && food[foodKey] !== null) {
                createFoodParams.append(apiParam, food[foodKey]);
            }
        }

        const createFoodResponse = await fetch(`https://api.fitbit.com/1/user/${fitbitUserId}/foods.json`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: createFoodParams.toString(),
        });

        if (!createFoodResponse.ok) {
            const errorData = await createFoodResponse.json();
            console.error('Fitbit create food error response:', errorData);
            const errorMessage = errorData.errors && errorData.errors[0] ? errorData.errors[0].message : 'Unknown error';
            throw new Error(`Failed to create food "${food.foodName}": ${errorMessage}`);
        }
        const createdFoodData = await createFoodResponse.json();
        const foodId = createdFoodData.food.foodId;

        const logFoodParams = new URLSearchParams({
            foodId: foodId,
            mealTypeId: mealTypeId,
            unitId: unitId,
            amount: food.amount,
            date: nutritionData.log_date,
            time: nutritionData.log_time,
        }).toString();

        const logFoodResponse = await fetch(`https://api.fitbit.com/1/user/${fitbitUserId}/foods/log.json`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: logFoodParams,
        });

        if (!logFoodResponse.ok) {
            const errorData = await logFoodResponse.json();
            console.error('Fitbit log food error response:', errorData);
            const errorMessage = errorData.errors && errorData.errors[0] ? errorData.errors[0].message : 'Unknown error';
            throw new Error(`Failed to log food "${food.foodName}": ${errorMessage}`);
        }

        console.log(`Successfully logged food: ${food.foodName} for user ${fitbitUserId}`);
        return await logFoodResponse.json();
    });

    return Promise.all(logPromises);
}

/**
 * メインのCloud Function
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

        // OAuthコールバック: 認可コードをトークンに交換
        if (req.method === 'GET' && req.query.code) {
            const state = req.query.state;
            if (!state) {
                return res.status(400).send('Invalid request: state parameter is missing.');
            }
            
            let firebaseUid, redirectUri;
            try {
                // stateにはFirebase UIDとリダイレクト先URLが含まれていることを期待
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
                // クエリパラメータにFitbitユーザーIDではなくFirebase UIDを使用
                redirectUrl.searchParams.set('uid', firebaseUid);
                return res.redirect(302, redirectUrl.toString());
            }
            return res.status(200).send(`Authorization successful! User UID: ${firebaseUid}. You can close this page.`);
        }

        // メインロジック: 食事記録リクエストの処理 (認証必須)
        if (req.method === 'POST') {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'Unauthorized: Authorization header is missing or invalid.' });
            }
            const idToken = authHeader.split('Bearer ')[1];

            // IDトークンを検証してFirebase UIDを取得
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
            // トークンが期限切れか確認し、必要であればリフレッシュ
            if (new Date().getTime() >= tokens.expiresAt) {
                console.log(`Token for user ${firebaseUid} has expired. Refreshing...`);
                accessToken = await refreshFitbitAccessToken(firebaseUid, clientId, clientSecret);
            } else {
                accessToken = tokens.accessToken;
            }

            // Firestoreから取得したFitbitユーザーIDを使用
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
        // エラーが認証関連の場合、401または403を返す
        if (error.message.includes('ID token') || error.message.includes('Unauthorized')) {
            return res.status(401).json({ error: error.message });
        }
        return res.status(500).json({ error: error.message || 'An internal server error occurred.' });
    }
};