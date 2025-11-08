import {
    accessSecretVersion
} from './secrets';
import {
    SecretManagerServiceClient
} from '@google-cloud/secret-manager';

// SecretManagerServiceClientをモック
jest.mock('@google-cloud/secret-manager', () => {
    const mockAccessSecretVersion = jest.fn();
    return {
        SecretManagerServiceClient: jest.fn(() => ({
            accessSecretVersion: mockAccessSecretVersion,
        })),
    };
});

const mockSecretManagerClient = new SecretManagerServiceClient();

describe('accessSecretVersion', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {}); // console.errorをモック
    });

    afterEach(() => {
        jest.restoreAllMocks(); // すべてのモックを元に戻す
    });

    test('should return the secret payload data as a string on success', async () => {
        const mockSecretName = 'projects/project-id/secrets/secret-name/versions/1';
        const mockSecretPayload = 'secretValue';
        mockSecretManagerClient.accessSecretVersion.mockResolvedValueOnce([{
            payload: {
                data: Buffer.from(mockSecretPayload, 'utf8')
            }
        }]);

        const result = await accessSecretVersion(mockSecretName);

        expect(mockSecretManagerClient.accessSecretVersion).toHaveBeenCalledWith({
            name: mockSecretName
        });
        expect(result).toBe(mockSecretPayload);
    });

    test('should throw an error if accessing the secret fails', async () => {
        const mockSecretName = 'projects/project-id/secrets/non-existent-secret/versions/1';
        const mockError = new Error('Permission denied');
        mockSecretManagerClient.accessSecretVersion.mockRejectedValueOnce(mockError);

        await expect(accessSecretVersion(mockSecretName)).rejects.toThrow('Failed to access secret. Check IAM permissions.');
        expect(mockSecretManagerClient.accessSecretVersion).toHaveBeenCalledWith({
            name: mockSecretName
        });
    });

    test('should log the error when accessing the secret fails', async () => {
        const mockSecretName = 'projects/project-id/secrets/non-existent-secret/versions/1';
        const mockError = new Error('Permission denied');
        mockSecretManagerClient.accessSecretVersion.mockRejectedValueOnce(mockError);
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); // console.errorをモック

        await expect(accessSecretVersion(mockSecretName)).rejects.toThrow();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            `Failed to access secret ${mockSecretName}:`,
            mockError
        );
        consoleErrorSpy.mockRestore(); // モックを元に戻す
    });
});
