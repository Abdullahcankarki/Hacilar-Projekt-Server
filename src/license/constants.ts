export const PRODUCT_SLUG = "hacilar-erp";
export const LICENSE_SERVER_URL = "https://license.abdullahcankarki.de";
export const LICENSE_ISSUER = "license-server";

export const REVALIDATE_INTERVAL_MS = 48 * 60 * 60 * 1000;
export const OFFLINE_GRACE_MS = 48 * 60 * 60 * 1000;

export const LICENSE_KEY_REGEX = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function getAppSecret(): string {
  const secret = process.env.LICENSE_APP_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("LICENSE_APP_SECRET environment variable is not set");
  }
  return secret;
}
