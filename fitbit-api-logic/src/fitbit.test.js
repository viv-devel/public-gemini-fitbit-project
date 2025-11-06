import fetch from 'node-fetch';
import { processAndLogFoods } from './fitbit.js';

// Mock the node-fetch module
jest.mock('node-fetch');

describe('processAndLogFoods', () => {
  // Restore mocks after each test
  afterEach(() => {
    jest.restoreAllMocks();
  });

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
    // Arrange: Set up the mock responses for the two fetch calls
    fetch
      .mockResolvedValueOnce({ // 1st call: create food API
        ok: true,
        json: jest.fn().mockResolvedValue({ food: { foodId: '12345' } }),
      })
      .mockResolvedValueOnce({ // 2nd call: log food API
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

    // Act: Call the function to be tested
    await processAndLogFoods(accessToken, nutritionData, fitbitUserId);

    // Assert: Check if fetch was called as expected
    expect(fetch).toHaveBeenCalledTimes(2);

    // Check the URL of the first API call (create food)
    expect(fetch.mock.calls[0][0]).toBe(`https://api.fitbit.com/1/user/${fitbitUserId}/foods.json`);

    // Check the URL and body of the second API call (log food)
    expect(fetch.mock.calls[1][0]).toBe(`https://api.fitbit.com/1/user/${fitbitUserId}/foods/log.json`);
    expect(fetch.mock.calls[1][1].body.toString()).toContain('foodId=12345');
  });
});