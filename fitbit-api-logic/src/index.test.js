
import { fitbitWebhookHandler } from './index.js';
import { accessSecretVersion } from './secrets.js';
import { verifyFirebaseIdToken, getTokensFromFirestore } from './firebase.js';
import { exchangeCodeForTokens, refreshFitbitAccessToken, processAndLogFoods } from './fitbit.js';

// Mock all dependencies
jest.mock('./secrets.js', () => ({ accessSecretVersion: jest.fn() }));
jest.mock('./firebase.js', () => ({
  verifyFirebaseIdToken: jest.fn(),
  getTokensFromFirestore: jest.fn(),
  saveTokensToFirestore: jest.fn(), // Though not directly called in index.js, it's a dependency of fitbit.js
}));
jest.mock('./fitbit.js', () => ({
  exchangeCodeForTokens: jest.fn(),
  refreshFitbitAccessToken: jest.fn(),
  processAndLogFoods: jest.fn(),
}));

// Mock Express-like res object
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.redirect = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  return res;
};

describe('fitbitWebhookHandler (index.js)', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock secret manager to return dummy credentials by default
    accessSecretVersion.mockResolvedValue('dummy-secret');
  });

  describe('OPTIONS method', () => {
    it('should respond with 204 for OPTIONS request', async () => {
      const req = { method: 'OPTIONS' };
      const res = mockRes();
      await fitbitWebhookHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledWith('');
    });
  });

  describe('GET requests (OAuth Callback)', () => {
    it('should exchange code for tokens and redirect', async () => {
      const state = Buffer.from(JSON.stringify({ firebaseUid: 'test-uid', redirectUri: 'http://localhost/callback' })).toString('base64');
      const req = {
        method: 'GET',
        query: { code: 'auth-code', state: state },
      };
      const res = mockRes();

      await fitbitWebhookHandler(req, res);

      expect(accessSecretVersion).toHaveBeenCalledTimes(2);
      expect(exchangeCodeForTokens).toHaveBeenCalledWith('dummy-secret', 'dummy-secret', 'auth-code', 'test-uid');
      expect(res.redirect).toHaveBeenCalledWith(302, 'http://localhost/callback?uid=test-uid');
    });

    it('should return 400 if state is missing', async () => {
      const req = { method: 'GET', query: { code: 'auth-code' } };
      const res = mockRes();
      await fitbitWebhookHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid request: state parameter is missing.' });
    });

    it('should return 400 if state is invalid', async () => {
      const req = { method: 'GET', query: { code: 'auth-code', state: 'invalid-state' } };
      const res = mockRes();
      await fitbitWebhookHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('Invalid state: could not decode state parameter.') });
    });

    it('should return 400 if firebaseUid is missing from state', async () => {
      const state = Buffer.from(JSON.stringify({ redirectUri: 'http://localhost/callback' })).toString('base64');
      const req = { method: 'GET', query: { code: 'auth-code', state: state } };
      const res = mockRes();
      await fitbitWebhookHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid state: Firebase UID is missing.' });
    });
  });

  describe('POST requests (Food Logging)', () => {
    const validBody = { meal_type: 'Dinner', foods: [{ foodName: 'test' }] };
    const idToken = 'valid-id-token';
    const authHeader = `Bearer ${idToken}`;
    const decodedToken = { uid: 'test-uid' };

    it('should log food successfully with a valid token', async () => {
      const tokens = { accessToken: 'fitbit-token', expiresAt: Date.now() + 10000, fitbitUserId: 'fitbit-id' };
      verifyFirebaseIdToken.mockResolvedValue(decodedToken);
      getTokensFromFirestore.mockResolvedValue(tokens);
      processAndLogFoods.mockResolvedValue([{ success: true }]);

      const req = { method: 'POST', headers: { authorization: authHeader }, body: validBody };
      const res = mockRes();
      await fitbitWebhookHandler(req, res);

      expect(verifyFirebaseIdToken).toHaveBeenCalledWith(idToken);
      expect(getTokensFromFirestore).toHaveBeenCalledWith(decodedToken.uid);
      expect(refreshFitbitAccessToken).not.toHaveBeenCalled();
      expect(processAndLogFoods).toHaveBeenCalledWith(tokens.accessToken, validBody, tokens.fitbitUserId);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'All foods logged successfully to Fitbit.' }));
    });

    it('should refresh token if expired and then log food', async () => {
      const tokens = { accessToken: 'expired-token', expiresAt: Date.now() - 10000, fitbitUserId: 'fitbit-id' };
      const newAccessToken = 'new-fitbit-token';
      verifyFirebaseIdToken.mockResolvedValue(decodedToken);
      getTokensFromFirestore.mockResolvedValue(tokens);
      refreshFitbitAccessToken.mockResolvedValue(newAccessToken);
      processAndLogFoods.mockResolvedValue([{ success: true }]);

      const req = { method: 'POST', headers: { authorization: authHeader }, body: validBody };
      const res = mockRes();
      await fitbitWebhookHandler(req, res);

      expect(getTokensFromFirestore).toHaveBeenCalledWith(decodedToken.uid);
      expect(refreshFitbitAccessToken).toHaveBeenCalledWith(decodedToken.uid, 'dummy-secret', 'dummy-secret');
      expect(processAndLogFoods).toHaveBeenCalledWith(newAccessToken, validBody, tokens.fitbitUserId);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return 401 if auth header is missing', async () => {
      const req = { method: 'POST', headers: {}, body: validBody };
      const res = mockRes();
      await fitbitWebhookHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Authorization header is missing or invalid.' });
    });

    it('should return 401 if id token verification fails', async () => {
      verifyFirebaseIdToken.mockRejectedValue(new Error('Invalid ID token.'));
      const req = { method: 'POST', headers: { authorization: authHeader }, body: validBody };
      const res = mockRes();
      await fitbitWebhookHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid ID token.' });
    });

    it('should return 400 if body is invalid', async () => {
      verifyFirebaseIdToken.mockResolvedValue(decodedToken);
      const req = { method: 'POST', headers: { authorization: authHeader }, body: { wrong: 'body' } };
      const res = mockRes();
      await fitbitWebhookHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: expect.any(String) });
    });

    it('should return 401 if no tokens are found for user', async () => {
      verifyFirebaseIdToken.mockResolvedValue(decodedToken);
      getTokensFromFirestore.mockResolvedValue(null);
      const req = { method: 'POST', headers: { authorization: authHeader }, body: validBody };
      const res = mockRes();
      await fitbitWebhookHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: `No tokens found for user ${decodedToken.uid}. Please complete the OAuth flow.` });
    });

    it('should return 500 if fitbitUserId is missing from token data', async () => {
      const tokens = { accessToken: 'fitbit-token', expiresAt: Date.now() + 10000 /* fitbitUserId is missing */ };
      verifyFirebaseIdToken.mockResolvedValue(decodedToken);
      getTokensFromFirestore.mockResolvedValue(tokens);
      const req = { method: 'POST', headers: { authorization: authHeader }, body: validBody };
      const res = mockRes();
      await fitbitWebhookHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Fitbit user ID not found in the database.' });
    });
  });

  describe('Other Scenarios', () => {
    it('should return 405 for unallowed methods', async () => {
        const req = { method: 'PUT' };
        const res = mockRes();
        await fitbitWebhookHandler(req, res);
        expect(res.status).toHaveBeenCalledWith(405);
        expect(res.send).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({ error: 'Method Not Allowed' });
    });

    it('should return 500 for a generic error', async () => {
        const req = { method: 'GET', query: { code: 'auth-code' } }; // A request that would normally proceed
        const res = mockRes();
        accessSecretVersion.mockRejectedValue(new Error('Some random error')); // Simulate a generic failure
        await fitbitWebhookHandler(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'Some random error' });
    });
  });
});
