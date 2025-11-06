// Note: Environment variables are set by the 'npm test' script in package.json

import { processAndLogFoods } from './fitbit.js';

describe('processAndLogFoods', () => {
  it('should throw an error if foods array is missing or empty', async () => {
    const accessToken = 'dummy_token';
    const fitbitUserId = 'dummy_user';
    
    // Test with missing foods array
    const missingFoodsData = { meal_type: 'Breakfast', log_date: '2025-11-06', log_time: '08:00' };
    await expect(processAndLogFoods(accessToken, missingFoodsData, fitbitUserId))
      .rejects.toThrow('Invalid input: "foods" array is missing or empty.');

    // Test with empty foods array
    const emptyFoodsData = { ...missingFoodsData, foods: [] };
    await expect(processAndLogFoods(accessToken, emptyFoodsData, fitbitUserId))
      .rejects.toThrow('Invalid input: "foods" array is missing or empty.');
  });
});
