import {
    verifyFirebaseIdToken,
    getTokensFromFirestore,
    saveTokensToFirestore
} from './firebase';
import {
    AuthenticationError
} from './errors';
import admin from 'firebase-admin';

// Firebase Admin SDKのモック
jest.mock('firebase-admin', () => {
    const mockAuth = {
        verifyIdToken: jest.fn(),
    };
    const mockDoc = {
        get: jest.fn(),
        set: jest.fn(),
    };
    const mockCollection = {
        doc: jest.fn(() => mockDoc),
    };
    const mockFirestore = {
        collection: jest.fn(() => mockCollection),
    };
    return {
        initializeApp: jest.fn(),
        apps: [],
        auth: jest.fn(() => mockAuth),
        firestore: jest.fn(() => mockFirestore),
    };
});

const mockAuth = admin.auth();
const mockFirestore = admin.firestore();
const mockCollection = mockFirestore.collection('fitbit_tokens');
const mockDoc = mockCollection.doc('testUid');

describe('Firebase Functions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        admin.apps = []; // 各テストの前にアプリの初期化状態をリセット
        jest.spyOn(console, 'log').mockImplementation(() => {}); // console.logをモック
        jest.spyOn(console, 'error').mockImplementation(() => {}); // console.errorもモック
    });

    afterEach(() => {
        jest.restoreAllMocks(); // すべてのモックを元に戻す
    });

    describe('verifyFirebaseIdToken', () => {
        test('should throw AuthenticationError if idToken is not provided', async () => {
            await expect(verifyFirebaseIdToken(null)).rejects.toThrow(AuthenticationError);
            await expect(verifyFirebaseIdToken('')).rejects.toThrow(AuthenticationError);
            expect(mockAuth.verifyIdToken).not.toHaveBeenCalled();
        });

        test('should throw AuthenticationError for an invalid ID token', async () => {
            mockAuth.verifyIdToken.mockRejectedValueOnce(new Error('Invalid token'));
            await expect(verifyFirebaseIdToken('invalidToken')).rejects.toThrow(AuthenticationError);
            expect(mockAuth.verifyIdToken).toHaveBeenCalledWith('invalidToken');
        });

        test('should return decoded token for a valid ID token', async () => {
            const mockDecodedToken = {
                uid: 'testUid',
                email: 'test@example.com'
            };
            mockAuth.verifyIdToken.mockResolvedValueOnce(mockDecodedToken);
            const decodedToken = await verifyFirebaseIdToken('validToken');
            expect(decodedToken).toEqual(mockDecodedToken);
            expect(mockAuth.verifyIdToken).toHaveBeenCalledWith('validToken');
        });
    });

    describe('getTokensFromFirestore', () => {
        test('should return null if no token is found for the user', async () => {
            mockDoc.get.mockResolvedValueOnce({
                exists: false
            });
            const tokens = await getTokensFromFirestore('testUid');
            expect(tokens).toBeNull();
            expect(mockCollection.doc).toHaveBeenCalledWith('testUid');
            expect(mockDoc.get).toHaveBeenCalled();
        });

        test('should return token data if found for the user', async () => {
            const mockTokenData = {
                accessToken: 'abc',
                refreshToken: 'xyz'
            };
            mockDoc.get.mockResolvedValueOnce({
                exists: true,
                data: () => mockTokenData
            });
            const tokens = await getTokensFromFirestore('testUid');
            expect(tokens).toEqual(mockTokenData);
            expect(mockCollection.doc).toHaveBeenCalledWith('testUid');
            expect(mockDoc.get).toHaveBeenCalled();
        });
    });

    describe('saveTokensToFirestore', () => {
        test('should save tokens to firestore with correct data', async () => {
            const firebaseUid = 'testUid';
            const fitbitUserId = 'fitbit123';
            const tokens = {
                access_token: 'newAccessToken',
                refresh_token: 'newRefreshToken',
                expires_in: 3600, // 1 hour
            };

            // DateコンストラクタをモックしてexpiresAtの計算を予測可能にする
            const mockDateNow = 1678886400000; // 2023-03-15T00:00:00.000Z
            const MOCK_DATE = new Date(mockDateNow);
            const RealDate = Date;

            global.Date = jest.fn(() => MOCK_DATE);
            global.Date.now = jest.fn(() => MOCK_DATE.getTime());
            global.Date.UTC = RealDate.UTC;
            global.Date.parse = RealDate.parse;
            global.Date.prototype = RealDate.prototype;

            await saveTokensToFirestore(firebaseUid, fitbitUserId, tokens);

            const expectedExpiresAt = mockDateNow + (tokens.expires_in * 1000);

            expect(mockCollection.doc).toHaveBeenCalledWith(firebaseUid);
            expect(mockDoc.set).toHaveBeenCalledWith({
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresAt: expectedExpiresAt,
                fitbitUserId: fitbitUserId,
                firebaseUid: firebaseUid,
            }, {
                merge: true
            });
            expect(console.log).toHaveBeenCalledWith(
                `Successfully saved tokens for Firebase user ${firebaseUid} (Fitbit user ${fitbitUserId})`
            );

            global.Date = RealDate; // モックを元に戻す
        });
    });
});