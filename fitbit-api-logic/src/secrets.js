import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const FUNCTION_REGION = process.env.FUNCTION_REGION; // FUNCTION_REGION を取得

const secretManagerClient = new SecretManagerServiceClient(
  FUNCTION_REGION
    ? {
        apiEndpoint: `secretmanager.${FUNCTION_REGION}.rep.googleapis.com`,
      }
    : {}
);

/**
 * Google Secret Managerからシークレットにアクセスします。
 */
export async function accessSecretVersion(name) {
  try {
    const [version] = await secretManagerClient.accessSecretVersion({ name });
    return version.payload.data.toString("utf8");
  } catch (error) {
    console.error(`Failed to access secret ${name}:`, error);
    throw new Error(`Failed to access secret. Check IAM permissions.`);
  }
}
