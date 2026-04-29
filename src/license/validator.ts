import os from "os";
import jwt from "jsonwebtoken";
import {
  PRODUCT_SLUG,
  LICENSE_SERVER_URL,
  LICENSE_ISSUER,
  LICENSE_KEY_REGEX,
  getAppSecret,
} from "./constants";
import { LICENSE_PUBLIC_KEY_PEM } from "./publicKey";
import { getMachineId } from "./machineId";

export interface ServerSuccess {
  success: true;
  token: string;
  validUntil: string;
}

export interface ServerFailure {
  success: false;
  reason: string;
}

export type ServerResponse = ServerSuccess | ServerFailure;

export interface JwtPayload {
  licenseId: string;
  licenseKey: string;
  productSlug: string;
  customerId: string;
  validUntil: string;
  machineId: string;
  iss: string;
  iat: number;
  exp: number;
}

export class LicenseError extends Error {
  constructor(public readonly reason: string, public readonly category: "network" | "server" | "verify") {
    super(reason);
  }
}

export async function callServerValidate(licenseKey: string): Promise<ServerSuccess> {
  if (!LICENSE_KEY_REGEX.test(licenseKey)) {
    throw new LicenseError("invalid_format", "verify");
  }

  const body = {
    licenseKey,
    productSlug: PRODUCT_SLUG,
    appSecret: getAppSecret(),
    machineId: getMachineId(),
    hostname: os.hostname(),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(`${LICENSE_SERVER_URL}/api/v1/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new LicenseError(`network_error:${(err as Error).message}`, "network");
  } finally {
    clearTimeout(timeout);
  }

  let json: ServerResponse;
  try {
    json = (await res.json()) as ServerResponse;
  } catch {
    throw new LicenseError(`bad_response:status_${res.status}`, "server");
  }

  if (!res.ok || !json.success) {
    const reason = (json && (json as ServerFailure).reason) || `http_${res.status}`;
    throw new LicenseError(reason, "server");
  }

  return json;
}

export function verifyToken(token: string, opts: { ignoreExpiration?: boolean } = {}): JwtPayload {
  let decoded: JwtPayload;
  try {
    decoded = jwt.verify(token, LICENSE_PUBLIC_KEY_PEM, {
      algorithms: ["RS256"],
      issuer: LICENSE_ISSUER,
      ignoreExpiration: opts.ignoreExpiration ?? false,
    }) as JwtPayload;
  } catch (err) {
    throw new LicenseError(`jwt_invalid:${(err as Error).message}`, "verify");
  }

  if (decoded.productSlug !== PRODUCT_SLUG) {
    throw new LicenseError("wrong_product", "verify");
  }

  const ownMachineId = getMachineId();
  if (decoded.machineId !== ownMachineId) {
    throw new LicenseError("machine_mismatch", "verify");
  }

  return decoded;
}
