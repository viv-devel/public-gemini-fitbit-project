
// Define the mock function first.
const mockAccessSecretVersion = jest.fn();

// Then, mock the module that uses it.
// The factory function will close over the mock function.
jest.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: jest.fn().mockImplementation(() => ({
    accessSecretVersion: mockAccessSecretVersion,
  })),
}));

// Now that the mock is set up, we can import the module to be tested.
// We have to use require here because import statements are hoisted.
const { accessSecretVersion } = require('./secrets.js');

describe('accessSecretVersion', () => {
  beforeEach(() => {
    mockAccessSecretVersion.mockClear();
  });

  it('should access a secret version and return the payload', async () => {
    const secretName = 'projects/my-project/secrets/my-secret/versions/latest';
    const secretPayload = 'my-secret-value';
    const mockResponse = [{
      payload: {
        data: Buffer.from(secretPayload, 'utf8'),
      },
    }];

    mockAccessSecretVersion.mockResolvedValue(mockResponse);

    const result = await accessSecretVersion(secretName);

    expect(result).toBe(secretPayload);
    expect(mockAccessSecretVersion).toHaveBeenCalledWith({ name: secretName });
    expect(mockAccessSecretVersion).toHaveBeenCalledTimes(1);
  });

  it('should throw an error if accessing the secret fails', async () => {
    const secretName = 'projects/my-project/secrets/my-secret/versions/latest';
    const errorMessage = 'Permission denied';
    
    mockAccessSecretVersion.mockRejectedValue(new Error(errorMessage));

    await expect(accessSecretVersion(secretName))
      .rejects.toThrow('Failed to access secret. Check IAM permissions.');
      
    expect(mockAccessSecretVersion).toHaveBeenCalledWith({ name: secretName });
    expect(mockAccessSecretVersion).toHaveBeenCalledTimes(1);
  });
});
