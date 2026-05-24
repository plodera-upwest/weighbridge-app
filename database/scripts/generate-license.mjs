import crypto from "node:crypto";

const secret = process.env.LICENSE_SIGNING_SECRET || "north-gate-dev-license-secret-change-me";
const args = Object.fromEntries(process.argv.slice(2).map((item) => {
  const [key, ...value] = item.replace(/^--/, "").split("=");
  return [key, value.join("=")];
}));

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payloadBase64) {
  return crypto.createHmac("sha256", secret).update(payloadBase64).digest("base64url");
}

function futureDate(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

const payload = {
  licenseId: args.licenseId || `LIC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
  customerName: args.customer || "North Gate Customer",
  issuedAt: new Date().toISOString(),
  expiresAt: args.expiresAt || futureDate(Number(args.days || 365)),
  maxUsers: Number(args.maxUsers || 10),
  maxWeighbridges: Number(args.maxWeighbridges || 1),
  modules: String(args.modules || "core,weighbridge,reports").split(",").map((item) => item.trim()).filter(Boolean)
};

const payloadBase64 = base64Url(JSON.stringify(payload));
const key = `NGW1.${payloadBase64}.${sign(payloadBase64)}`;

console.log(JSON.stringify({ payload, licenseKey: key }, null, 2));
