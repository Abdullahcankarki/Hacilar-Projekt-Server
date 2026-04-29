import { OFFLINE_GRACE_MS, REVALIDATE_INTERVAL_MS } from "./constants";
import { logLicenseEvent } from "./errorLogger";
import { readState, writeState, LicenseState } from "./state";
import { callServerValidate, LicenseError, verifyToken } from "./validator";

export type Status = "valid" | "invalid" | "uninitialized";

interface InternalState {
  status: Status;
  validUntil?: string;
  hasKey: boolean;
}

let current: InternalState = { status: "uninitialized", hasKey: false };
let timer: NodeJS.Timeout | null = null;

export function getStatus(): InternalState {
  return current;
}

function setStatus(next: InternalState): void {
  current = next;
}

function isFresh(lastValidatedAt: string): boolean {
  const ts = Date.parse(lastValidatedAt);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < OFFLINE_GRACE_MS;
}

function isUntilFuture(validUntil: string): boolean {
  const ts = Date.parse(validUntil);
  if (Number.isNaN(ts)) return false;
  return ts > Date.now();
}

function localCheck(state: LicenseState): boolean {
  try {
    verifyToken(state.token, { ignoreExpiration: true });
  } catch (err) {
    logLicenseEvent("local_verify_failed", {
      licenseKey: state.licenseKey,
      reason: (err as LicenseError).reason ?? (err as Error).message,
    });
    return false;
  }
  if (!isUntilFuture(state.validUntil)) {
    logLicenseEvent("local_verify_failed", {
      licenseKey: state.licenseKey,
      reason: "validUntil_in_past",
    });
    return false;
  }
  if (!isFresh(state.lastValidatedAt)) {
    return false;
  }
  return true;
}

async function runValidate(licenseKey: string): Promise<LicenseState> {
  const success = await callServerValidate(licenseKey);
  verifyToken(success.token, { ignoreExpiration: false });
  const state: LicenseState = {
    licenseKey,
    token: success.token,
    validUntil: success.validUntil,
    lastValidatedAt: new Date().toISOString(),
  };
  writeState(state);
  return state;
}

export async function activate(licenseKey: string): Promise<void> {
  try {
    const state = await runValidate(licenseKey);
    setStatus({ status: "valid", validUntil: state.validUntil, hasKey: true });
    logLicenseEvent("activation_success", { licenseKey });
    scheduleRevalidation();
  } catch (err) {
    const reason = err instanceof LicenseError ? err.reason : (err as Error).message;
    logLicenseEvent("activation_failed", { licenseKey, reason });
    const existing = readState();
    setStatus({
      status: "invalid",
      validUntil: existing?.validUntil,
      hasKey: !!existing,
    });
    throw err;
  }
}

export async function startupCheck(): Promise<void> {
  const state = readState();
  if (!state) {
    setStatus({ status: "uninitialized", hasKey: false });
    logLicenseEvent("startup_no_key");
    return;
  }

  if (localCheck(state)) {
    setStatus({ status: "valid", validUntil: state.validUntil, hasKey: true });
    logLicenseEvent("startup_local_ok", { licenseKey: state.licenseKey });
    scheduleRevalidation();
    return;
  }

  try {
    const refreshed = await runValidate(state.licenseKey);
    setStatus({ status: "valid", validUntil: refreshed.validUntil, hasKey: true });
    logLicenseEvent("startup_revalidate_success", { licenseKey: state.licenseKey });
  } catch (err) {
    const isNetwork = err instanceof LicenseError && err.category === "network";
    if (isNetwork && isFresh(state.lastValidatedAt)) {
      setStatus({ status: "valid", validUntil: state.validUntil, hasKey: true });
      logLicenseEvent("startup_offline_grace", {
        licenseKey: state.licenseKey,
        reason: (err as LicenseError).reason,
      });
    } else {
      setStatus({ status: "invalid", validUntil: state.validUntil, hasKey: true });
      logLicenseEvent("startup_revalidate_failed", {
        licenseKey: state.licenseKey,
        reason: err instanceof LicenseError ? err.reason : (err as Error).message,
      });
    }
  }
  scheduleRevalidation();
}

async function periodicRevalidate(): Promise<void> {
  const state = readState();
  if (!state) {
    setStatus({ status: "uninitialized", hasKey: false });
    return;
  }
  try {
    const refreshed = await runValidate(state.licenseKey);
    setStatus({ status: "valid", validUntil: refreshed.validUntil, hasKey: true });
    logLicenseEvent("periodic_revalidate_success", { licenseKey: state.licenseKey });
  } catch (err) {
    const isNetwork = err instanceof LicenseError && err.category === "network";
    if (isNetwork && isFresh(state.lastValidatedAt)) {
      logLicenseEvent("periodic_offline_grace", {
        licenseKey: state.licenseKey,
        reason: (err as LicenseError).reason,
      });
      return;
    }
    setStatus({ status: "invalid", validUntil: state.validUntil, hasKey: true });
    logLicenseEvent("periodic_revalidate_failed", {
      licenseKey: state.licenseKey,
      reason: err instanceof LicenseError ? err.reason : (err as Error).message,
    });
  }
}

export function scheduleRevalidation(): void {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void periodicRevalidate();
  }, REVALIDATE_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopRevalidation(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
