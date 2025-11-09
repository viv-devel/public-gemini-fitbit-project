import fetch from 'node-fetch';
import { Buffer } from 'buffer';
import {
    exchangeCodeForTokens,
    refreshFitbitAccessToken,
    processAndLogFoods
} from './fitbit';
import {
    AuthenticationError,
    ValidationError,
    FitbitApiError
} from './errors';
import {
    getTokensFromFirestore,
    saveTokensToFirestore
} from './firebase';

// node-fetchをモック
jest.mock('node-fetch');
// firebase.jsからインポートされる関数をモック
jest.mock('./firebase', () => ({
    getTokensFromFirestore: jest.fn(),
    saveTokensToFirestore: jest.fn(),
}));

const mockClientId = 'testClientId';
const mockClientSecret = 'testClientSecret';
const mockRedirectUri = 'http://localhost:3000/callback';
const mockFirebaseUid = 'testFirebaseUid';

// 環境変数をモック
process.env.FITBIT_REDIRECT_URI = mockRedirectUri;

describe('Fitbit API Functions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});

        fetch.mockImplementation((url, options) => {
            if (url.includes('/oauth2/token')) {
                // exchangeCodeForTokens and refreshFitbitAccessToken
                if (options.body.includes('grant_type=authorization_code')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            access_token: 'newAccessToken',
                            refresh_token: 'newRefreshToken',
                            expires_in: 3600,
                            user_id: 'fitbitUser123',
                        }),
                    });
                } else if (options.body.includes('grant_type=refresh_token')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            access_token: 'refreshedAccessToken',
                            refresh_token: 'newRefreshToken',
                            expires_in: 3600,
                            user_id: 'fitbitUser123',
                        }),
                    });
                }
            } else if (url.includes('/foods.json')) {
                // Create food API
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        food: {
                            foodId: 'mockFoodId'
                        }
                    }),
                });
            } else if (url.includes('/foods/log.json')) {
                // Log food API
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        log: {
                            logId: 'mockLogId'
                        }
                    }),
                });
            }
            return Promise.reject(new Error('Unknown Fitbit API call'));
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('exchangeCodeForTokens', () => {
        test('should successfully exchange code for tokens and save to firestore', async () => {
            const mockCode = 'testCode';
            const mockFitbitResponse = {
                access_token: 'newAccessToken',
                refresh_token: 'newRefreshToken',
                expires_in: 3600,
                user_id: 'fitbitUser123',
            };

            fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockFitbitResponse),
            });

            const result = await exchangeCodeForTokens(mockClientId, mockClientSecret, mockCode, mockFirebaseUid);

            expect(fetch).toHaveBeenCalledWith('https://api.fitbit.com/oauth2/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + Buffer.from(`${mockClientId}:${mockClientSecret}`).toString('base64'),
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: mockCode,
                    redirect_uri: 'http://localhost:3000/oauth',
                    client_id: mockClientId,
                }).toString(),
            });
            expect(saveTokensToFirestore).toHaveBeenCalledWith(
                mockFirebaseUid,
                mockFitbitResponse.user_id,
                mockFitbitResponse
            );
            expect(result).toEqual(mockFitbitResponse);
        });

        test('should throw FitbitApiError if token exchange fails', async () => {
            const mockCode = 'testCode';
            const mockErrorResponse = {
                errors: [{
                    message: 'Invalid code'
                }]
            };

            fetch.mockResolvedValueOnce({
                ok: false,
                json: () => Promise.resolve(mockErrorResponse),
            });

            await expect(exchangeCodeForTokens(mockClientId, mockClientSecret, mockCode, mockFirebaseUid))
                .rejects.toThrow(FitbitApiError);
            expect(saveTokensToFirestore).not.toHaveBeenCalled();
        });
    });

    describe('refreshFitbitAccessToken', () => {
        test('should successfully refresh token and save to firestore', async () => {
            const mockCurrentTokens = {
                refreshToken: 'oldRefreshToken',
                fitbitUserId: 'fitbitUser123',
            };
            const mockNewTokensResponse = {
                access_token: 'refreshedAccessToken',
                refresh_token: 'newRefreshToken',
                expires_in: 3600,
                user_id: 'fitbitUser123', // Fitbit APIはuser_idを返すことがある
            };

            getTokensFromFirestore.mockResolvedValueOnce(mockCurrentTokens);
            fetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockNewTokensResponse),
            });

            const newAccessToken = await refreshFitbitAccessToken(mockFirebaseUid, mockClientId, mockClientSecret);

            expect(getTokensFromFirestore).toHaveBeenCalledWith(mockFirebaseUid);
            expect(fetch).toHaveBeenCalledWith('https://api.fitbit.com/oauth2/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + Buffer.from(`${mockClientId}:${mockClientSecret}`).toString('base64'),
                },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: mockCurrentTokens.refreshToken,
                }).toString(),
            });
            expect(saveTokensToFirestore).toHaveBeenCalledWith(
                mockFirebaseUid,
                mockCurrentTokens.fitbitUserId,
                mockNewTokensResponse
            );
            expect(newAccessToken).toBe(mockNewTokensResponse.access_token);
        });

        test('should throw AuthenticationError if no refresh token is found', async () => {
            getTokensFromFirestore.mockResolvedValueOnce(null);

            await expect(refreshFitbitAccessToken(mockFirebaseUid, mockClientId, mockClientSecret))
                .rejects.toThrow(AuthenticationError);
            expect(fetch).not.toHaveBeenCalled();
            expect(saveTokensToFirestore).not.toHaveBeenCalled();
        });

        test('should throw FitbitApiError if refresh token fails', async () => {
            const mockCurrentTokens = {
                refreshToken: 'oldRefreshToken',
                fitbitUserId: 'fitbitUser123',
            };
            const mockErrorResponse = {
                errors: [{
                    message: 'Invalid refresh token'
                }]
            };

            getTokensFromFirestore.mockResolvedValueOnce(mockCurrentTokens);
            fetch.mockResolvedValueOnce({
                ok: false,
                json: () => Promise.resolve(mockErrorResponse),
            });

            await expect(refreshFitbitAccessToken(mockFirebaseUid, mockClientId, mockClientSecret))
                .rejects.toThrow(FitbitApiError);
            expect(saveTokensToFirestore).not.toHaveBeenCalled();
        });
    });

    describe('processAndLogFoods', () => {
        const mockAccessToken = 'mockAccessToken';
        const mockFitbitUserId = 'mockFitbitUser';
        const mockNutritionData = {
            meal_type: 'Breakfast',
            log_date: '2023-01-01',
            log_time: '08:00',
            foods: [{
                foodName: 'Apple',
                amount: 1,
                unit: 'serving',
                calories: 95,
            }, {
                foodName: 'Orange Juice',
                amount: 200,
                unit: 'ml',
                calories: 90,
            }, ],
        };

        test('should successfully log multiple foods to Fitbit', async () => {

            // fetchのモックをテストケース内で再定義して、呼び出し順を制御
            fetch
                .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ food: { foodId: 'mockFoodId_Apple' } }) }) // Create Apple
                .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ food: { foodId: 'mockFoodId_Juice' } }) }) // Create Orange Juice
                .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ log: { logId: 'mockLogId_Apple' } }) })   // Log Apple
                .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ log: { logId: 'mockLogId_Juice' } }) });  // Log Orange Juice
            
            const results = await processAndLogFoods(mockAccessToken, mockNutritionData, mockFitbitUserId);

            expect(fetch).toHaveBeenCalledTimes(4); // 2 foods * (create + log)
            expect(results.length).toBe(2);
            expect(results[0]).toEqual({
                log: {
                    logId: 'mockLogId_Apple'
                }
            });
            expect(results[1]).toEqual({
                log: {
                    logId: 'mockLogId_Juice'
                }
            });

            // Verify calls for the first food (Apple)
            const createFoodParams1 = new URLSearchParams();
            createFoodParams1.append('name', 'Apple');
            createFoodParams1.append('defaultFoodMeasurementUnitId', '86');
            createFoodParams1.append('defaultServingSize', '1');
            createFoodParams1.append('calories', '95');
            createFoodParams1.append('formType', 'DRY');
            createFoodParams1.append('description', 'Logged via Gemini: Apple');

            expect(fetch).toHaveBeenCalledWith(`https://api.fitbit.com/1/user/${mockFitbitUserId}/foods.json`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${mockAccessToken}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: createFoodParams1.toString(),
            });

            const logFoodParams1 = new URLSearchParams({
                foodId: 'mockFoodId_Apple',
                mealTypeId: '1', // Breakfast
                unitId: '86',
                amount: '1',
                date: '2023-01-01',
                time: '08:00',
            }).toString();

            expect(fetch).toHaveBeenCalledWith(`https://api.fitbit.com/1/user/${mockFitbitUserId}/foods/log.json`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${mockAccessToken}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: logFoodParams1,
            });

            // Verify calls for the second food (Orange Juice)
            const createFoodParams2 = new URLSearchParams();
            createFoodParams2.append('name', 'Orange Juice');
            createFoodParams2.append('defaultFoodMeasurementUnitId', '147'); // ml
            createFoodParams2.append('defaultServingSize', '200');
            createFoodParams2.append('calories', '90');
            createFoodParams2.append('formType', 'DRY');
            createFoodParams2.append('description', 'Logged via Gemini: Orange Juice');

            expect(fetch).toHaveBeenCalledWith(`https://api.fitbit.com/1/user/${mockFitbitUserId}/foods.json`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${mockAccessToken}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: createFoodParams2.toString(),
            });

            const logFoodParams2 = new URLSearchParams({
                foodId: 'mockFoodId_Juice',
                mealTypeId: '1', // Breakfast
                unitId: '147',
                amount: '200',
                date: '2023-01-01',
                time: '08:00',
            }).toString();

            expect(fetch).toHaveBeenCalledWith(`https://api.fitbit.com/1/user/${mockFitbitUserId}/foods/log.json`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${mockAccessToken}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: logFoodParams2,
            });
        });

        test('should throw ValidationError if "foods" array is missing or empty', async () => {
            await expect(processAndLogFoods(mockAccessToken, {
                meal_type: 'Breakfast',
                log_date: '2023-01-01',
                log_time: '08:00',
                foods: []
            }, mockFitbitUserId)).rejects.toThrow(ValidationError);
            await expect(processAndLogFoods(mockAccessToken, {
                meal_type: 'Breakfast',
                log_date: '2023-01-01',
                log_time: '08:00',
            }, mockFitbitUserId)).rejects.toThrow(ValidationError);
            expect(fetch).not.toHaveBeenCalled();
        });

        test('should throw ValidationError if food item is missing required fields', async () => {
            const invalidNutritionData = {
                meal_type: 'Breakfast',
                log_date: '2023-01-01',
                log_time: '08:00',
                foods: [{
                    foodName: 'Apple',
                    amount: 1,
                    // unit is missing
                }, ],
            };
            await expect(processAndLogFoods(mockAccessToken, invalidNutritionData, mockFitbitUserId))
                .rejects.toThrow(ValidationError);
            expect(fetch).not.toHaveBeenCalled();
        });

        test('should throw FitbitApiError if create food API fails', async () => {
            const singleFoodNutritionData = { // 1つの食品のみ
                meal_type: 'Breakfast',
                log_date: '2023-01-01',
                log_time: '08:00',
                foods: [{
                    foodName: 'Apple',
                    amount: 1,
                    unit: 'serving',
                    calories: 95,
                }, ],
            };

            // foods.json (create food) の呼び出しで失敗するように設定
            fetch.mockResolvedValueOnce({
                ok: false,
                json: () => Promise.resolve({
                    errors: [{
                        message: 'Failed to create food on Fitbit'
                    }]
                }),
            });
            
            await expect(processAndLogFoods(mockAccessToken, singleFoodNutritionData, mockFitbitUserId))
                .rejects.toThrow(FitbitApiError);
            expect(fetch).toHaveBeenCalledTimes(1); // Only create food API called
        });

        test('should throw FitbitApiError if log food API fails', async () => {
            const singleFoodNutritionData = { // 1つの食品のみ
                meal_type: 'Breakfast',
                log_date: '2023-01-01',
                log_time: '08:00',
                foods: [{
                    foodName: 'Apple',
                    amount: 1,
                    unit: 'serving',
                    calories: 95,
                }, ],
            };

            // Mock for creating food (success)
            fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ food: { foodId: 'foodId1' } }) });
            // Mock for logging food (failure)
            fetch.mockResolvedValueOnce({
                ok: false,
                json: () => Promise.resolve({
                    errors: [{
                        message: 'Failed to log food on Fitbit'
                    }]
                }),
            });

            await expect(processAndLogFoods(mockAccessToken, singleFoodNutritionData, mockFitbitUserId))
                .rejects.toThrow(FitbitApiError);
            expect(fetch).toHaveBeenCalledTimes(2); // Create food and log food APIs called
        });

        test('should stop processing if a subsequent food creation fails', async () => {
            // 1件目の作成は成功、2件目の作成は失敗するようにfetchをモック
            fetch
                .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ food: { foodId: 'mockFoodId_Apple' } }) }) // 1. Create Apple (Success)
                .mockResolvedValueOnce({ // 2. Create Orange Juice (Failure)
                    ok: false,
                    json: () => Promise.resolve({ errors: [{ message: 'Failed on second item' }] }),
                });

            // 2つの食品を含むデータで関数を実行
            await expect(processAndLogFoods(mockAccessToken, mockNutritionData, mockFitbitUserId))
                .rejects.toThrow('Failed to create food "Orange Juice": Failed on second item');

            // 1回目の作成(成功)と2回目の作成(失敗)で、APIは2回呼ばれる
            expect(fetch).toHaveBeenCalledTimes(2);
            // log food APIは一度も呼ばれないことを確認
            expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/foods/log.json'), expect.any(Object));
        });

        test('should use default unitId if unit is unknown', async () => {
            const nutritionDataWithUnknownUnit = {
                meal_type: 'Breakfast',
                log_date: '2023-01-01',
                log_time: '08:00',
                foods: [{
                    foodName: 'Unknown Food',
                    amount: 1,
                    unit: 'unknown',
                    calories: 100,
                }, ],
            };

            fetch
                .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ food: { foodId: 'mockFoodId_Unknown' } }) })
                .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ log: { logId: 'mockLogId_Unknown' } }) });


            await processAndLogFoods(mockAccessToken, nutritionDataWithUnknownUnit, mockFitbitUserId);

            const createFoodParams = new URLSearchParams();
            createFoodParams.append('name', 'Unknown Food');
            createFoodParams.append('defaultFoodMeasurementUnitId', '86'); // Default unitId
            createFoodParams.append('defaultServingSize', '1');
            createFoodParams.append('calories', '100');
            createFoodParams.append('formType', 'DRY');
            createFoodParams.append('description', 'Logged via Gemini: Unknown Food');

            expect(fetch).toHaveBeenCalledWith(`https://api.fitbit.com/1/user/${mockFitbitUserId}/foods.json`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${mockAccessToken}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: createFoodParams.toString(),
            });

            const logFoodParams = new URLSearchParams({
                foodId: 'mockFoodId_Unknown',
                mealTypeId: '1',
                unitId: '86', // Default unitId
                amount: '1',
                date: '2023-01-01',
                time: '08:00',
            }).toString();

            expect(fetch).toHaveBeenCalledWith(`https://api.fitbit.com/1/user/${mockFitbitUserId}/foods/log.json`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${mockAccessToken}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: logFoodParams,
            });
        });
    });
});
