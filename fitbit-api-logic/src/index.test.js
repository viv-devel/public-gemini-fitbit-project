import { fitbitWebhookHandler } from "./index.js";
import {
  AuthenticationError,
  ValidationError,
  FitbitApiError,
  MethodNotAllowedError,
} from "./errors.js";
import { accessSecretVersion } from "./secrets.js";
import { verifyFirebaseIdToken, getTokensFromFirestore } from "./firebase.js";
import {
  exchangeCodeForTokens,
  refreshFitbitAccessToken,
  processAndLogFoods,
} from "./fitbit.js";
import { Buffer } from "buffer";

// 外部依存のモック化
jest.mock("./secrets.js", () => ({
  accessSecretVersion: jest.fn((secretName) => {
    if (secretName.includes("FITBIT_CLIENT_ID")) {
      return Promise.resolve("testClientId");
    }
    if (secretName.includes("FITBIT_CLIENT_SECRET")) {
      return Promise.resolve("testClientSecret");
    }
    return Promise.reject(new Error("Unknown secret"));
  }),
}));
jest.mock("./firebase.js", () => ({
  verifyFirebaseIdToken: jest.fn(),
  getTokensFromFirestore: jest.fn(),
  saveTokensToFirestore: jest.fn(),
}));
jest.mock("./fitbit.js");
jest.mock("buffer", () => {
  const originalBuffer = jest.requireActual("buffer").Buffer; // 元のBufferをロード
  return {
    Buffer: {
      from: jest.fn((str, encoding) => {
        if (str === "validStateBase64") {
          return {
            toString: jest.fn(() =>
              JSON.stringify({
                firebaseUid: "testFirebaseUid",
                redirectUri: "http://example.com/redirect",
              })
            ),
          };
        }
        if (str === "stateWithoutRedirectUriBase64") {
          return {
            toString: jest.fn(() =>
              JSON.stringify({ firebaseUid: "testFirebaseUid" })
            ),
          };
        }
        if (str === "stateWithoutFirebaseUidBase64") {
          return {
            toString: jest.fn(() =>
              JSON.stringify({ redirectUri: "http://example.com/redirect" })
            ),
          };
        }
        if (str === "invalidJsonStateBase64") {
          return { toString: jest.fn(() => "invalid json") };
        }
        if (str === "invalidBase64") {
          // このケースも追加
          throw new Error("Invalid base64");
        }
        // その他のケースでは元のBuffer.fromを使用
        return originalBuffer.from(str, encoding);
      }),
    },
  };
});

describe("fitbitWebhookHandler", () => {
  let mockReq;
  let mockRes;
  let originalEnv;

  beforeAll(() => {
    originalEnv = process.env;
  });

  beforeEach(() => {
    // 環境変数のモック

    process.env = {
      ...originalEnv,

      GCP_PROJECT: "test-project",

      FITBIT_REDIRECT_URI: "http://localhost:3000/fitbit-callback",
    };

    // モックのリセット

    jest.clearAllMocks();

    jest.spyOn(console, "error").mockImplementation(() => {}); // console.errorをモック

    jest.spyOn(console, "log").mockImplementation(() => {}); // console.logもモック

    // resオブジェクトのモック

    mockRes = {
      set: jest.fn().mockReturnThis(),

      status: jest.fn().mockReturnThis(),

      send: jest.fn(),

      json: jest.fn(),

      redirect: jest.fn(),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks(); // すべてのモックを元に戻す
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // --- 環境変数チェックのテスト ---
  test("should throw error if GCP_PROJECT is not set", async () => {
    delete process.env.GCP_PROJECT;
    await expect(fitbitWebhookHandler({}, mockRes)).rejects.toThrow(
      "GCP_PROJECT 環境変数が設定されていません。Secret Manager へのアクセスには必須です。"
    );
  });

  test("should throw error if FITBIT_REDIRECT_URI is not set", async () => {
    delete process.env.FITBIT_REDIRECT_URI;
    await expect(fitbitWebhookHandler({}, mockRes)).rejects.toThrow(
      "FITBIT_REDIRECT_URI 環境変数が設定されていません。"
    );
  });

  // --- OPTIONSリクエストのテスト ---
  test("should handle OPTIONS request", async () => {
    mockReq = { method: "OPTIONS" };
    await fitbitWebhookHandler(mockReq, mockRes);
    expect(mockRes.set).toHaveBeenCalledWith(
      "Access-Control-Allow-Origin",
      "*"
    );
    expect(mockRes.set).toHaveBeenCalledWith(
      "Access-Control-Allow-Methods",
      "GET, POST, OPTIONS"
    );
    expect(mockRes.set).toHaveBeenCalledWith(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
    expect(mockRes.status).toHaveBeenCalledWith(204);
    expect(mockRes.send).toHaveBeenCalledWith("");
  });

  // --- GETリクエスト (Health Check) のテスト ---
  describe("GET request (Health Check)", () => {
    test("should return 200 OK for health check without code parameter", async () => {
      mockReq = {
        method: "GET",
        query: {}, // codeパラメータなし
      };

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        status: "OK",
        message: "Health check passed",
      });
      expect(accessSecretVersion).not.toHaveBeenCalled(); // シークレット取得は行われない
    });
  });

  // --- GETリクエスト (OAuthコールバック) のテスト ---
  describe("GET request (OAuth callback)", () => {
    // 正常系
    test("should exchange code for tokens and redirect if state is valid and includes redirectUri", async () => {
      mockReq = {
        method: "GET",
        query: {
          code: "testCode",
          state: "validStateBase64", // firebaseUidとredirectUriを含む
        },
      };

      exchangeCodeForTokens.mockResolvedValueOnce();

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(accessSecretVersion).toHaveBeenCalledTimes(2);
      expect(exchangeCodeForTokens).toHaveBeenCalledWith(
        "testClientId",
        "testClientSecret",
        "testCode",
        "testFirebaseUid"
      );
      expect(mockRes.redirect).toHaveBeenCalledWith(
        302,
        "http://example.com/redirect?uid=testFirebaseUid"
      );
    });

    test("should exchange code for tokens and send success message if state is valid but no redirectUri", async () => {
      mockReq = {
        method: "GET",
        query: {
          code: "testCode",
          state: "stateWithoutRedirectUriBase64", // firebaseUidのみ
        },
      };

      exchangeCodeForTokens.mockResolvedValueOnce();

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(accessSecretVersion).toHaveBeenCalledTimes(2);
      expect(exchangeCodeForTokens).toHaveBeenCalledWith(
        "testClientId",
        "testClientSecret",
        "testCode",
        "testFirebaseUid"
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.send).toHaveBeenCalledWith(
        "Authorization successful! User UID: testFirebaseUid. You can close this page."
      );
    });

    // 異常系
    test("should return 400 if state parameter is missing", async () => {
      mockReq = {
        method: "GET",
        query: {
          code: "testCode",
        },
      };

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Invalid request: state parameter is missing.",
      });
    });

    test("should return 400 if state parameter cannot be decoded", async () => {
      mockReq = {
        method: "GET",
        query: {
          code: "testCode",
          state: "invalidBase64", // 無効なBase64
        },
      };
      Buffer.from.mockImplementationOnce(() => {
        throw new Error("Invalid base64");
      });

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: expect.stringContaining(
          "Invalid state: could not decode state parameter."
        ),
      });
    });

    test("should return 400 if decoded state is not valid JSON", async () => {
      mockReq = {
        method: "GET",
        query: {
          code: "testCode",
          state: "invalidJsonStateBase64", // 有効なBase64だがJSONではない
        },
      };
      // Buffer.from のモックは beforeEach で設定されているので、ここでは特定のケースを上書き
      Buffer.from.mockImplementationOnce((str, encoding) => ({
        toString: jest.fn((enc) => "this is not json"),
      }));

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: expect.stringContaining(
          "Invalid state: could not decode state parameter."
        ),
      });
    });

    test("should return 400 if firebaseUid is missing from decoded state", async () => {
      mockReq = {
        method: "GET",
        query: {
          code: "testCode",
          state: "stateWithoutFirebaseUidBase64", // firebaseUidがない
        },
      };

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Invalid state: Firebase UID is missing.",
      });
    });

    test("should handle error during exchangeCodeForTokens", async () => {
      mockReq = {
        method: "GET",
        query: {
          code: "testCode",
          state: "validStateBase64",
        },
      };
      exchangeCodeForTokens.mockRejectedValueOnce(
        new Error("Fitbit API error")
      );

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Fitbit API error" });
    });
  });

  // --- POSTリクエスト (食事ログ) のテスト ---
  describe("POST request (food logging)", () => {
    const mockIdToken = "mockIdToken";
    const mockFirebaseUid = "testFirebaseUid";
    const mockNutritionData = {
      meal_type: "breakfast",
      log_date: "2023-01-01",
      log_time: "08:00",
      foods: [{ foodName: "apple", calories: 95 }],
    };
    const mockTokens = {
      accessToken: "oldAccessToken",
      refreshToken: "testRefreshToken",
      expiresAt: new Date().getTime() + 3600 * 1000, // 1時間後
      fitbitUserId: "testFitbitUserId",
    };
    const mockExpiredTokens = {
      accessToken: "expiredAccessToken",
      refreshToken: "testRefreshToken",
      expiresAt: new Date().getTime() - 3600 * 1000, // 1時間前
      fitbitUserId: "testFitbitUserId",
    };

    beforeEach(() => {
      mockReq = {
        method: "POST",
        headers: {
          authorization: `Bearer ${mockIdToken}`,
        },
        body: mockNutritionData,
      };
      verifyFirebaseIdToken.mockResolvedValue({ uid: mockFirebaseUid });
      getTokensFromFirestore.mockResolvedValue(mockTokens);
      processAndLogFoods.mockResolvedValue([{ success: true }]);
    });

    // 正常系
    test("should log foods successfully with valid token", async () => {
      await fitbitWebhookHandler(mockReq, mockRes);

      expect(verifyFirebaseIdToken).toHaveBeenCalledWith(mockIdToken);
      expect(getTokensFromFirestore).toHaveBeenCalledWith(mockFirebaseUid);
      expect(refreshFitbitAccessToken).not.toHaveBeenCalled(); // トークンは期限内
      expect(processAndLogFoods).toHaveBeenCalledWith(
        mockTokens.accessToken,
        mockNutritionData,
        mockTokens.fitbitUserId
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: "All foods logged successfully to Fitbit.",
        loggedData: mockNutritionData,
        fitbitResponses: [{ success: true }],
      });
    });

    test("should refresh token and log foods successfully if token is expired", async () => {
      getTokensFromFirestore.mockResolvedValue(mockExpiredTokens);
      refreshFitbitAccessToken.mockResolvedValue("newAccessToken");

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(verifyFirebaseIdToken).toHaveBeenCalledWith(mockIdToken);
      expect(getTokensFromFirestore).toHaveBeenCalledWith(mockFirebaseUid);
      expect(refreshFitbitAccessToken).toHaveBeenCalledWith(
        mockFirebaseUid,
        "testClientId",
        "testClientSecret"
      );
      expect(processAndLogFoods).toHaveBeenCalledWith(
        "newAccessToken",
        mockNutritionData,
        mockExpiredTokens.fitbitUserId
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: "All foods logged successfully to Fitbit.",
        loggedData: mockNutritionData,
        fitbitResponses: [{ success: true }],
      });
    });

    // 異常系
    test("should return 401 if Authorization header is missing", async () => {
      mockReq.headers.authorization = undefined;

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Unauthorized: Authorization header is missing or invalid.",
      });
    });

    test("should return 401 if Authorization header is invalid", async () => {
      mockReq.headers.authorization = "InvalidToken";

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Unauthorized: Authorization header is missing or invalid.",
      });
    });

    test("should return 401 if verifyFirebaseIdToken fails", async () => {
      verifyFirebaseIdToken.mockRejectedValueOnce(
        new AuthenticationError("Firebase auth error")
      );

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Firebase auth error",
      });
    });

    test("should return 400 if nutritionData is missing", async () => {
      mockReq.body = undefined;

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error:
          'Invalid JSON body. Required: meal_type, log_date, log_time, and a non-empty "foods" array.',
      });
    });

    test("should return 400 if nutritionData.foods is missing", async () => {
      mockReq.body = { meal_type: "breakfast" };

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error:
          'Invalid JSON body. Required: meal_type, log_date, log_time, and a non-empty "foods" array.',
      });
    });

    test("should return 400 if nutritionData.foods is not an array", async () => {
      mockReq.body = { foods: "not an array" };

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error:
          'Invalid JSON body. Required: meal_type, log_date, log_time, and a non-empty "foods" array.',
      });
    });

    test("should return 401 if no tokens found for user", async () => {
      getTokensFromFirestore.mockResolvedValueOnce(null);

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: `No tokens found for user ${mockFirebaseUid}. Please complete the OAuth flow.`,
      });
    });

    test("should return 500 if refreshFitbitAccessToken fails", async () => {
      getTokensFromFirestore.mockResolvedValue(mockExpiredTokens);
      refreshFitbitAccessToken.mockRejectedValueOnce(
        new Error("Refresh failed")
      );

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Refresh failed" });
    });

    test("should return 500 if fitbitUserId is missing from tokens", async () => {
      getTokensFromFirestore.mockResolvedValueOnce({
        ...mockTokens,
        fitbitUserId: undefined,
      });

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Fitbit user ID not found in the database.",
      });
    });

    test("should return 500 if processAndLogFoods fails", async () => {
      processAndLogFoods.mockRejectedValueOnce(
        new Error("Fitbit logging error")
      );

      await fitbitWebhookHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Fitbit logging error",
      });
    });
  });

  // --- その他のリクエストメソッドのテスト ---
  test("should return 405 for unsupported methods", async () => {
    mockReq = { method: "PUT" }; // GET (codeなし) も同様
    await fitbitWebhookHandler(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(405);
    expect(mockRes.json).toHaveBeenCalledWith({ error: "Method Not Allowed" });
  });

  test("should return 500 for unhandled errors", async () => {
    mockReq = { method: "GET", query: { code: "testCode" } }; // stateがないためValidationErrorになるが、ここでは一般的なエラーハンドリングをテスト
    // accessSecretVersion が失敗するケースをシミュレート
    accessSecretVersion.mockRejectedValueOnce(
      new Error("Secret access failed")
    );

    await fitbitWebhookHandler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Secret access failed",
    });
  });
});
