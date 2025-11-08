import fetch from 'node-fetch';
import { processAndLogFoods, exchangeCodeForTokens, refreshFitbitAccessToken } from './fitbit.js';
import { saveTokensToFirestore, getTokensFromFirestore } from './firebase.js';

// Mock dependencies
jest.mock('node-fetch');
jest.mock('./firebase.js', () => ({
  getTokensFromFirestore: jest.fn(),
  saveTokensToFirestore: jest.fn(),
}));

describe('fitbit.js', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processAndLogFoods', () => {
    it('should throw an error if foods array is missing or empty', async () => {
      const accessToken = 'dummy_token';
      const fitbitUserId = 'dummy_user';
      
      const missingFoodsData = { meal_type: 'Breakfast', log_date: '2025-11-06', log_time: '08:00' };
      await expect(processAndLogFoods(accessToken, missingFoodsData, fitbitUserId))
        .rejects.toThrow('Invalid input: "foods" array is missing or empty.');

      const emptyFoodsData = { ...missingFoodsData, foods: [] };
      await expect(processAndLogFoods(accessToken, emptyFoodsData, fitbitUserId))
        .rejects.toThrow('Invalid input: "foods" array is missing or empty.');
    });

    it('should call fetch to create and then log food on success', async () => {
      fetch
        .mockResolvedValueOnce({ 
          ok: true,
          json: jest.fn().mockResolvedValue({ food: { foodId: '12345' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ message: 'success' }),
        });

      const accessToken = 'dummy_token';
      const fitbitUserId = 'dummy_user';
      const nutritionData = {
          meal_type: 'Lunch',
          log_date: '2025-11-06',
          log_time: '13:00',
          foods: [{
              foodName: 'test food',
              amount: 1,
              unit: 'serving',
              calories: 100
          }]
      };

      await processAndLogFoods(accessToken, nutritionData, fitbitUserId);

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[0][0]).toBe(`https://api.fitbit.com/1/user/${fitbitUserId}/foods.json`);
      expect(fetch.mock.calls[1][0]).toBe(`https://api.fitbit.com/1/user/${fitbitUserId}/foods/log.json`);
      expect(fetch.mock.calls[1][1].body.toString()).toContain('foodId=12345');
    });

    it('should use default formType and description if not provided', async () => {
      fetch
        .mockResolvedValueOnce({ 
          ok: true,
          json: jest.fn().mockResolvedValue({ food: { foodId: '12345' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ message: 'success' }),
        });

      const accessToken = 'dummy_token';
      const fitbitUserId = 'dummy_user';
      const nutritionData = {
          meal_type: 'Lunch',
          log_date: '2025-11-06',
          log_time: '13:00',
          foods: [{
              foodName: 'test food without formType and description',
              amount: 1,
              unit: 'serving',
              calories: 100
          }]
      };

      await processAndLogFoods(accessToken, nutritionData, fitbitUserId);

      expect(fetch).toHaveBeenCalledTimes(2);
      const createFoodBody = fetch.mock.calls[0][1].body.toString();
      expect(createFoodBody).toContain('formType=DRY');
      expect(createFoodBody).toContain('description=Logged+via+Gemini%3A+test+food+without+formType+and+description');
    });

    it('should use provided formType and description', async () => {
      fetch
        .mockResolvedValueOnce({ 
          ok: true,
          json: jest.fn().mockResolvedValue({ food: { foodId: '12345' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ message: 'success' }),
        });

      const accessToken = 'dummy_token';
      const fitbitUserId = 'dummy_user';
      const nutritionData = {
          meal_type: 'Lunch',
          log_date: '2025-11-06',
          log_time: '13:00',
          foods: [{
              foodName: 'test food with formType and description',
              amount: 1,
              unit: 'serving',
              calories: 100,
              formType: 'LIQUID',
              description: 'Custom description'
          }]
      };

      await processAndLogFoods(accessToken, nutritionData, fitbitUserId);

      expect(fetch).toHaveBeenCalledTimes(2);
      const createFoodBody = fetch.mock.calls[0][1].body.toString();
      expect(createFoodBody).toContain('formType=LIQUID');
      expect(createFoodBody).toContain('description=Custom+description');
    });

    it('should use default formType if formType is null', async () => {
      fetch
        .mockResolvedValueOnce({ 
          ok: true,
          json: jest.fn().mockResolvedValue({ food: { foodId: '12345' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ message: 'success' }),
        });

      const accessToken = 'dummy_token';
      const fitbitUserId = 'dummy_user';
      const nutritionData = {
          meal_type: 'Lunch',
          log_date: '2025-11-06',
          log_time: '13:00',
          foods: [{
              foodName: 'test food with null formType',
              amount: 1,
              unit: 'serving',
              calories: 100,
              formType: null
          }]
      };

      await processAndLogFoods(accessToken, nutritionData, fitbitUserId);

      expect(fetch).toHaveBeenCalledTimes(2);
      const createFoodBody = fetch.mock.calls[0][1].body.toString();
      expect(createFoodBody).toContain('formType=DRY');
    });

    it('should use default description if description is null', async () => {
      fetch
        .mockResolvedValueOnce({ 
          ok: true,
          json: jest.fn().mockResolvedValue({ food: { foodId: '12345' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ message: 'success' }),
        });

      const accessToken = 'dummy_token';
      const fitbitUserId = 'dummy_user';
      const nutritionData = {
          meal_type: 'Lunch',
          log_date: '2025-11-06',
          log_time: '13:00',
          foods: [{
              foodName: 'test food with null description',
              amount: 1,
              unit: 'serving',
              calories: 100,
              description: null
          }]
      };

      await processAndLogFoods(accessToken, nutritionData, fitbitUserId);

      expect(fetch).toHaveBeenCalledTimes(2);
      const createFoodBody = fetch.mock.calls[0][1].body.toString();
      expect(createFoodBody).toContain('description=Logged+via+Gemini%3A+test+food+with+null+description');
    });

    it('should use default formType and description if both are null', async () => {
      fetch
        .mockResolvedValueOnce({ 
          ok: true,
          json: jest.fn().mockResolvedValue({ food: { foodId: '12345' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ message: 'success' }),
        });

      const accessToken = 'dummy_token';
      const fitbitUserId = 'dummy_user';
      const nutritionData = {
          meal_type: 'Lunch',
          log_date: '2025-11-06',
          log_time: '13:00',
          foods: [{
              foodName: 'test food with null formType and description',
              amount: 1,
              unit: 'serving',
              calories: 100,
              formType: null,
              description: null
          }]
      };

      await processAndLogFoods(accessToken, nutritionData, fitbitUserId);

      expect(fetch).toHaveBeenCalledTimes(2);
      const createFoodBody = fetch.mock.calls[0][1].body.toString();
      expect(createFoodBody).toContain('formType=DRY');
      expect(createFoodBody).toContain('description=Logged+via+Gemini%3A+test+food+with+null+formType+and+description');
    });

    it('should throw an error if a food item is missing required fields', async () => {
      const nutritionData = {
        meal_type: 'Lunch',
        log_date: '2025-11-06',
        foods: [{ foodName: 'test food', amount: 1 /* unit is missing */ }]
      };
      await expect(processAndLogFoods('token', nutritionData, 'user'))
        .rejects.toThrow('Missing required field for food log: test food');
    });

    it('should throw an error if creating food fails', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        json: jest.fn().mockResolvedValue({ errors: [{ message: 'Invalid food' }] }),
      });
      const nutritionData = {
        meal_type: 'Lunch',
        log_date: '2025-11-06',
        foods: [{ foodName: 'bad food', amount: 1, unit: 'g' }]
      };

      await expect(processAndLogFoods('token', nutritionData, 'user'))
        .rejects.toThrow('Failed to create food "bad food": Invalid food');
    });

    it('should throw an error if logging food fails', async () => {
      fetch
        .mockResolvedValueOnce({ // create food success
          ok: true,
          json: jest.fn().mockResolvedValue({ food: { foodId: '12345' } }),
        })
        .mockResolvedValueOnce({ // log food failure
          ok: false,
          json: jest.fn().mockResolvedValue({ errors: [{ message: 'Invalid log' }] }),
        });
      const nutritionData = {
        meal_type: 'Lunch',
        log_date: '2025-11-06',
        foods: [{ foodName: 'good food', amount: 1, unit: 'g' }]
      };

      await expect(processAndLogFoods('token', nutritionData, 'user'))
        .rejects.toThrow('Failed to log food "good food": Invalid log');
    });
  });

  describe('exchangeCodeForTokens', () => {
    it('should exchange code for tokens and save them', async () => {
      const clientId = 'test-client-id';
      const clientSecret = 'test-client-secret';
      const code = 'test-code';
      const firebaseUid = 'test-uid';
      const fitbitResponse = { access_token: 'fitbit-access-token', user_id: 'fitbit-user-id' };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(fitbitResponse),
      });

      await exchangeCodeForTokens(clientId, clientSecret, code, firebaseUid);

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith('https://api.fitbit.com/oauth2/token', expect.any(Object));
      expect(saveTokensToFirestore).toHaveBeenCalledTimes(1);
      expect(saveTokensToFirestore).toHaveBeenCalledWith(firebaseUid, fitbitResponse.user_id, fitbitResponse);
    });

    it('should throw an error if token exchange fails', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        json: jest.fn().mockResolvedValue({ errors: [{ message: 'Invalid code' }] }),
      });

      await expect(exchangeCodeForTokens('id', 'secret', 'code', 'uid'))
        .rejects.toThrow('Failed to exchange code for tokens.');
      
      expect(saveTokensToFirestore).not.toHaveBeenCalled();
    });
  });

  describe('refreshFitbitAccessToken', () => {
    const firebaseUid = 'test-uid';
    const clientId = 'test-client-id';
    const clientSecret = 'test-client-secret';

    it('should refresh the access token and save it', async () => {
      const currentTokens = { refreshToken: 'current-refresh-token', fitbitUserId: 'fitbit-user-id' };
      const newTokens = { access_token: 'new-access-token', refresh_token: 'new-refresh-token' };
      
      getTokensFromFirestore.mockResolvedValue(currentTokens);
      
      fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(newTokens),
      });

      const newAccessToken = await refreshFitbitAccessToken(firebaseUid, clientId, clientSecret);

      expect(newAccessToken).toBe(newTokens.access_token);
      expect(getTokensFromFirestore).toHaveBeenCalledWith(firebaseUid);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][1].body.toString()).toContain(`refresh_token=${currentTokens.refreshToken}`);
      expect(saveTokensToFirestore).toHaveBeenCalledWith(firebaseUid, currentTokens.fitbitUserId, newTokens);
    });

    it('should throw an error if token refresh fails', async () => {
      const currentTokens = { refreshToken: 'current-refresh-token' };
      getTokensFromFirestore.mockResolvedValue(currentTokens);
      
      fetch.mockResolvedValueOnce({
        ok: false,
        json: jest.fn().mockResolvedValue({ errors: [{ message: 'Invalid refresh token' }] }),
      });

      await expect(refreshFitbitAccessToken(firebaseUid, clientId, clientSecret))
        .rejects.toThrow(/Fitbit API Refresh Error: Invalid refresh token/);
      
      expect(saveTokensToFirestore).not.toHaveBeenCalled();
    });

    it('should throw an error if no refresh token is found in firestore', async () => {
      getTokensFromFirestore.mockResolvedValue(null);

      await expect(refreshFitbitAccessToken(firebaseUid, clientId, clientSecret))
        .rejects.toThrow(`No refresh token found for user ${firebaseUid}. Please re-authenticate.`);
      
      expect(fetch).not.toHaveBeenCalled();
      expect(saveTokensToFirestore).not.toHaveBeenCalled();
    });
  });
});