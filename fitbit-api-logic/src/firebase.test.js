
// Define mock functions first
const mockVerifyIdToken = jest.fn();
const mockCollection = jest.fn();
const mockDoc = jest.fn();
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockInitializeApp = jest.fn(); // initializeApp のモックを追加

// Mock firebase-admin using the functions defined above
jest.mock('firebase-admin', () => ({
  apps: [], // Mock the apps array to allow initialization
  initializeApp: mockInitializeApp, // initializeApp をモック関数に置き換え
  auth: () => ({
    verifyIdToken: mockVerifyIdToken,
  }),
  firestore: () => ({
    collection: mockCollection,
  }),
}));

// Now that mocks are set up, require the module to be tested
const { verifyFirebaseIdToken, getTokensFromFirestore, saveTokensToFirestore } = require('./firebase.js');

// Mock chain for firestore
mockCollection.mockReturnValue({ doc: mockDoc });
mockDoc.mockReturnValue({ get: mockGet, set: mockSet });

describe('firebase.js', () => {

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize firebase admin once', () => {
    expect(mockInitializeApp).toHaveBeenCalledTimes(1);
    expect(mockInitializeApp).toHaveBeenCalledWith({
      projectId: process.env.GCP_PROJECT,
    });
  });

  describe('verifyFirebaseIdToken', () => {
    it('should return decoded token for a valid ID token', async () => {
      const idToken = 'valid-token';
      const decodedToken = { uid: 'test-uid', email: 'test@example.com' };
      mockVerifyIdToken.mockResolvedValue(decodedToken);

      const result = await verifyFirebaseIdToken(idToken);

      expect(result).toEqual(decodedToken);
      expect(mockVerifyIdToken).toHaveBeenCalledWith(idToken);
      expect(mockVerifyIdToken).toHaveBeenCalledTimes(1);
    });

    it('should throw an error for an invalid ID token', async () => {
      const idToken = 'invalid-token';
      mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));

      await expect(verifyFirebaseIdToken(idToken)).rejects.toThrow('Invalid ID token.');
    });

    it('should throw an error if no ID token is provided', async () => {
      await expect(verifyFirebaseIdToken(null)).rejects.toThrow('ID token is required.');
    });
  });

  describe('getTokensFromFirestore', () => {
    it('should return token data if document exists', async () => {
      const firebaseUid = 'test-uid';
      const tokenData = { accessToken: 'test-access-token' };
      mockGet.mockResolvedValue({ exists: true, data: () => tokenData });

      const result = await getTokensFromFirestore(firebaseUid);

      expect(result).toEqual(tokenData);
      expect(mockCollection).toHaveBeenCalledWith('fitbit_tokens');
      expect(mockDoc).toHaveBeenCalledWith(firebaseUid);
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('should return null if document does not exist', async () => {
      const firebaseUid = 'non-existent-uid';
      mockGet.mockResolvedValue({ exists: false });

      const result = await getTokensFromFirestore(firebaseUid);

      expect(result).toBeNull();
    });
  });

  describe('saveTokensToFirestore', () => {
    it('should call firestore.set with the correct token data', async () => {
      const firebaseUid = 'test-uid';
      const fitbitUserId = 'test-fitbit-id';
      const tokens = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600, // 1 hour
      };

      // Use fake timers to control Date
      jest.useFakeTimers();
      jest.setSystemTime(new Date(1678886400000)); // A fixed timestamp

      await saveTokensToFirestore(firebaseUid, fitbitUserId, tokens);

      const expectedExpiresAt = 1678886400000 + 3600 * 1000;

      expect(mockSet).toHaveBeenCalledWith({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: expectedExpiresAt,
        fitbitUserId: fitbitUserId,
        firebaseUid: firebaseUid,
      }, { merge: true });

      expect(mockCollection).toHaveBeenCalledWith('fitbit_tokens');
      expect(mockDoc).toHaveBeenCalledWith(firebaseUid);
      expect(mockSet).toHaveBeenCalledTimes(1);

      // Restore real timers
      jest.useRealTimers();
    });
  });

});
