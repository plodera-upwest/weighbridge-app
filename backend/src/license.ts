import crypto from "node:crypto";
import { Db, LicensePayload, LicenseRecord, LicenseStatus } from "./types";

const LICENSE_PREFIX = "NGW1";
const DEFAULT_LICENSE_SECRET = "north-gate-dev-license-secret-change-me";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function licenseSecret() {
  return process.env.LICENSE_SIGNING_SECRET || DEFAULT_LICENSE_SECRET;
}

function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

function decodeBase64Url(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signPayload(payloadBase64: string) {
  return crypto.createHmac("sha256", licenseSecret()).update(payloadBase64).digest("base64url");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizePayload(value: unknown): LicensePayload {
  if (!isObject(value)) throw new Error("License payload is invalid");
  const licenseId = String(value.licenseId || "").trim();
  const customerName = String(value.customerName || "").trim();
  const issuedAt = String(value.issuedAt || "").trim();
  const expiresAt = String(value.expiresAt || "").trim();
  const maxUsers = Number(value.maxUsers || 0);
  const maxWeighbridges = Number(value.maxWeighbridges || 0);
  const modules = Array.isArray(value.modules) ? value.modules.map(String).filter(Boolean) : ["core"];

  if (!licenseId || !customerName || !issuedAt || !expiresAt) throw new Error("License is missing required fields");
  if (!Number.isFinite(Date.parse(issuedAt)) || !Number.isFinite(Date.parse(expiresAt))) throw new Error("License dates are invalid");
  if (!Number.isFinite(maxUsers) || maxUsers < 1) throw new Error("License user limit is invalid");
  if (!Number.isFinite(maxWeighbridges) || maxWeighbridges < 1) throw new Error("License weighbridge limit is invalid");

  return {
    licenseId,
    customerName,
    issuedAt,
    expiresAt,
    maxUsers: Math.floor(maxUsers),
    maxWeighbridges: Math.floor(maxWeighbridges),
    modules
  };
}

export function createLicenseKey(payload: LicensePayload) {
  const normalized = normalizePayload(payload);
  const payloadBase64 = base64Url(JSON.stringify(normalized));
  return `${LICENSE_PREFIX}.${payloadBase64}.${signPayload(payloadBase64)}`;
}

export function verifyLicenseKey(key: string): LicensePayload {
  const [prefix, payloadBase64, signature] = String(key || "").trim().split(".");
  if (prefix !== LICENSE_PREFIX || !payloadBase64 || !signature) throw new Error("License key format is invalid");
  const expectedSignature = signPayload(payloadBase64);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error("License signature is invalid");
  }
  return normalizePayload(JSON.parse(decodeBase64Url(payloadBase64)));
}

export function createTrialLicense(settings: Db["settings"]): LicenseRecord {
  const now = new Date();
  return {
    key: "TRIAL",
    activatedAt: now.toISOString(),
    activatedBy: "system",
    payload: {
      licenseId: "TRIAL",
      customerName: settings.companyName || "Trial Customer",
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * MS_PER_DAY).toISOString(),
      maxUsers: 5,
      maxWeighbridges: 1,
      modules: ["core", "weighbridge", "reports"]
    }
  };
}

export function licenseStatus(db: Db): LicenseStatus {
  if (!db.license) {
    return { state: "MISSING", valid: false, message: "License activation is required" };
  }

  let payload: LicensePayload;
  try {
    payload = db.license.key === "TRIAL" ? normalizePayload(db.license.payload) : verifyLicenseKey(db.license.key);
  } catch (error) {
    return {
      state: "INVALID",
      valid: false,
      message: error instanceof Error ? error.message : "License is invalid"
    };
  }

  const expiresAtMs = Date.parse(payload.expiresAt);
  const daysRemaining = Math.ceil((expiresAtMs - Date.now()) / MS_PER_DAY);
  const common = {
    licenseId: payload.licenseId,
    customerName: payload.customerName,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    daysRemaining,
    maxUsers: payload.maxUsers,
    maxWeighbridges: payload.maxWeighbridges,
    modules: payload.modules
  };

  if (expiresAtMs < Date.now()) {
    return { ...common, state: "EXPIRED", valid: false, message: "License has expired" };
  }

  if (db.users.filter((user) => user.active).length > payload.maxUsers) {
    return { ...common, state: "INVALID", valid: false, message: `License allows ${payload.maxUsers} active users` };
  }

  if (db.settings.weighbridges.filter((weighbridge) => weighbridge.active).length > payload.maxWeighbridges) {
    return { ...common, state: "INVALID", valid: false, message: `License allows ${payload.maxWeighbridges} active weighbridge(s)` };
  }

  if (db.license.key === "TRIAL") {
    return { ...common, state: "TRIAL", valid: true, message: `Trial license active. ${daysRemaining} day(s) remaining` };
  }

  return { ...common, state: "ACTIVE", valid: true, message: `License active. ${daysRemaining} day(s) remaining` };
}

export function activateLicense(key: string, activatedBy: string): LicenseRecord {
  const payload = verifyLicenseKey(key);
  return {
    key: key.trim(),
    payload,
    activatedAt: new Date().toISOString(),
    activatedBy
  };
}
