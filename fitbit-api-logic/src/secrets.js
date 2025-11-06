import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const secretManagerClient = new SecretManagerServiceClient();

/**
 * Google Secret Managerからシークレットにアクセスします。
 */
export async function accessSecretVersion(name) {
    try {
        const [version] = await secretManagerClient.accessSecretVersion({ name });
        return version.payload.data.toString('utf8');
    } catch (error) {
        console.error(`Failed to access secret ${name}:`, error);
        throw new Error(`Failed to access secret. Check IAM permissions.`);
    }
}
