import cookieParser from "cookie-parser";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import path from "node:path";
import { captureCameras, renderCameraSvg } from "./camera";
import { readLiveWeight } from "./device-client";
import { activateLicense, licenseStatus } from "./license";
import { assertStrongPassword, audit, hashPassword, isRole, needsPasswordRehash, nextTransactionNo, readDb, uid, verifyPassword, writeDb } from "./repository";
import { hasPermission, publicUser } from "./rbac";
import { Driver, Party, Permission, Product, ProductEntry, Settings, User, Vehicle } from "./types";

const PORT = Number(process.env.PORT || 4175);
const HOST = process.env.HOST || "0.0.0.0";
const app = express();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || `http://127.0.0.1:${PORT},http://localhost:${PORT}`)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin not allowed"));
  },
  credentials: true
}));
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));

type AuthedRequest = Request & { user?: User };
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function assertLoginAllowed(req: Request) {
  const key = `${clientIp(req)}:${text(req.body.username).toLowerCase()}`;
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (current && current.resetAt > now && current.count >= 8) {
    throw new Error("Too many failed login attempts. Try again later.");
  }
}

function recordLoginFailure(req: Request) {
  const key = `${clientIp(req)}:${text(req.body.username).toLowerCase()}`;
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return;
  }
  current.count += 1;
}

function clearLoginFailures(req: Request) {
  loginAttempts.delete(`${clientIp(req)}:${text(req.body.username).toLowerCase()}`);
}

function cookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    ...(maxAge ? { maxAge } : {})
  };
}

function settingsFor(user: User, settings: Settings): Settings {
  if (hasPermission(user, "CHANGE_SETTINGS")) return settings;
  return {
    ...settings,
    cameras: settings.cameras.map((camera) => ({ ...camera, password: "" }))
  };
}

function getUser(req: Request) {
  const db = readDb();
  const sessionId = req.cookies.wb_session;
  if (!sessionId || !db.sessions[sessionId]) return null;
  const session = db.sessions[sessionId];
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    delete db.sessions[sessionId];
    writeDb(db);
    return null;
  }
  return db.users.find((user) => user.id === session.userId && user.active) || null;
}

function auth(req: AuthedRequest, res: Response, next: () => void) {
  const db = readDb();
  const sessionId = req.cookies.wb_session;
  if (sessionId && db.sessions[sessionId] && new Date(db.sessions[sessionId].expiresAt).getTime() < Date.now()) {
    delete db.sessions[sessionId];
    writeDb(db);
  }
  const user = sessionId && db.sessions[sessionId]
    ? db.users.find((item) => item.id === db.sessions[sessionId].userId && item.active) || null
    : null;
  if (!user) {
    res.status(401).json({ error: "Authentication required", code: "AUTHENTICATION_REQUIRED", status: 401 });
    return;
  }
  req.user = user;
  const bypassLicense = req.path === "/api/me" || req.path === "/api/auth/logout" || req.path.startsWith("/api/license");
  const status = licenseStatus(db);
  if (!bypassLicense && !status.valid) {
    res.status(402).json({ error: status.message, code: "LICENSE_REQUIRED", status: 402, license: status });
    return;
  }
  next();
}

function permit(permission: Permission) {
  return (req: AuthedRequest, res: Response, next: () => void) => {
    if (!req.user || !hasPermission(req.user, permission)) {
      res.status(403).json({ error: "Permission denied", code: "PERMISSION_DENIED", status: 403 });
      return;
    }
    next();
  };
}

function text(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function duplicateKey(value: unknown) {
  return text(value).replace(/\s+/g, " ").toLowerCase();
}

function weight(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Valid weight is required");
  return Math.round(parsed);
}

function bool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "1", "on", "yes"].includes(value.toLowerCase());
  return fallback;
}

function cameraPosition(value: unknown): "FRONT" | "REAR" | "SIDE" {
  return value === "REAR" || value === "SIDE" ? value : "FRONT";
}

function captureTiming(value: unknown): "FIRST" | "FINAL" | "BOTH" {
  return value === "FIRST" || value === "FINAL" ? value : "BOTH";
}

function connectionType(value: unknown): "serial" | "tcp" | "simulator" {
  return value === "serial" || value === "tcp" ? value : "simulator";
}

function normalizeWeighbridges(input: unknown, existing: Settings["weighbridges"], fallbackDevice: Settings["device"]) {
  if (!Array.isArray(input)) return existing;
  return input.map((item, index) => {
    const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      id: text(value.id) || uid("wb"),
      name: text(value.name, `Weighbridge ${index + 1}`),
      location: text(value.location, "Main Yard"),
      active: bool(value.active, index === 0),
      displayOrder: Number(value.displayOrder || index + 1),
      connectionType: connectionType(value.connectionType ?? fallbackDevice.connectionType),
      comPort: text(value.comPort, fallbackDevice.comPort),
      baudRate: Number(value.baudRate || fallbackDevice.baudRate),
      dataBits: Number(value.dataBits || fallbackDevice.dataBits),
      stopBits: Number(value.stopBits || fallbackDevice.stopBits),
      parity: text(value.parity, fallbackDevice.parity),
      tcpHost: text(value.tcpHost, fallbackDevice.tcpHost),
      tcpPort: Number(value.tcpPort || fallbackDevice.tcpPort),
      weightFormat: text(value.weightFormat, fallbackDevice.weightFormat),
      stableDetection: bool(value.stableDetection, fallbackDevice.stableDetection)
    };
  }).sort((left, right) => left.displayOrder - right.displayOrder).map((weighbridge, index) => ({
    ...weighbridge,
    displayOrder: index + 1
  }));
}

function normalizeCameras(input: unknown, existing: Settings["cameras"]) {
  if (!Array.isArray(input)) return existing;
  return input.map((item, index) => {
    const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const id = text(value.id) || uid("cam");
    return {
      id,
      name: text(value.name, `Camera ${index + 1}`),
      classification: text(value.classification, "Weighbridge slip"),
      position: cameraPosition(value.position),
      rtspUrl: text(value.rtspUrl),
      username: text(value.username),
      password: String(value.password ?? ""),
      captureTiming: captureTiming(value.captureTiming),
      displayOnSlip: bool(value.displayOnSlip, true),
      displayOrder: Number(value.displayOrder || index + 1),
      active: bool(value.active, true)
    };
  }).sort((left, right) => left.displayOrder - right.displayOrder).map((camera, index) => ({
    ...camera,
    displayOrder: index + 1
  }));
}

function csvCell(value: unknown) {
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function queryText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function queryNumber(value: unknown, fallback: number, max = 500) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function wantsPagedResponse(req: Request) {
  return [
    "page",
    "limit",
    "status",
    "partyId",
    "customerId",
    "productId",
    "vehicleId",
    "driverId",
    "operatorId",
    "dateFrom",
    "dateTo",
    "search"
  ].some((key) => req.query[key] !== undefined);
}

function paginate<T>(items: T[], req: Request, defaultLimit = 100) {
  const page = queryNumber(req.query.page, 1, 1_000_000);
  const limit = queryNumber(req.query.limit, defaultLimit);
  const offset = (page - 1) * limit;
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    page,
    limit,
    hasMore: offset + limit < items.length
  };
}

function filteredTransactions(db: ReturnType<typeof readDb>, req: Request) {
  const status = queryText(req.query.status);
  const partyId = queryText(req.query.partyId || req.query.customerId);
  const productId = queryText(req.query.productId);
  const vehicleId = queryText(req.query.vehicleId);
  const driverId = queryText(req.query.driverId);
  const operatorId = queryText(req.query.operatorId);
  const search = queryText(req.query.search).toLowerCase();
  const from = queryText(req.query.dateFrom);
  const to = queryText(req.query.dateTo);
  const fromTime = from ? new Date(from).getTime() : Number.NEGATIVE_INFINITY;
  const toTime = to ? new Date(to).getTime() : Number.POSITIVE_INFINITY;

  return db.transactions
    .filter((transaction) => !status || transaction.status === status)
    .filter((transaction) => !partyId || transaction.partyId === partyId)
    .filter((transaction) => !vehicleId || transaction.vehicleId === vehicleId)
    .filter((transaction) => !driverId || transaction.driverId === driverId)
    .filter((transaction) => !operatorId || transaction.operatorId === operatorId)
    .filter((transaction) => !productId || transaction.productEntries.some((entry) => entry.productId === productId))
    .filter((transaction) => {
      const created = new Date(transaction.createdAt).getTime();
      return created >= fromTime && created <= toTime;
    })
    .filter((transaction) => {
      if (!search) return true;
      return [
        transaction.transactionNo,
        transaction.vehicleNo,
        transaction.driverName,
        transaction.partyName,
        transaction.transporter,
        transaction.destination,
        transaction.operatorName
      ].some((value) => String(value || "").toLowerCase().includes(search));
    });
}

function denyHistoricalMutation(_req: Request, res: Response) {
  res.status(405).json({
    error: "Saved transaction history cannot be edited or deleted. Use a supervised correction workflow.",
    code: "HISTORICAL_RECORD_IMMUTABLE",
    status: 405
  });
}

app.post("/api/auth/login", (req, res, next) => {
  const db = readDb();
  try {
    assertLoginAllowed(req);
    const password = String(req.body.password || "");
    const user = db.users.find((item) => item.username === text(req.body.username) && verifyPassword(password, item.passwordHash) && item.active);
    if (!user) {
      recordLoginFailure(req);
      res.status(401).json({ error: "Invalid username or password", code: "INVALID_CREDENTIALS", status: 401 });
      return;
    }
    clearLoginFailures(req);
    if (needsPasswordRehash(user.passwordHash)) {
      user.passwordHash = hashPassword(password);
    }
    const sessionId = uid("ses");
    db.sessions[sessionId] = {
      userId: user.id,
      expiresAt: new Date(Date.now() + db.settings.sessionTimeoutMinutes * 60 * 1000).toISOString()
    };
    audit(db, { userId: user.id, userName: user.name, action: "LOGIN", entityType: "USER", entityId: user.id, details: "User signed in" });
    writeDb(db);
    res.cookie("wb_session", sessionId, cookieOptions(db.settings.sessionTimeoutMinutes * 60 * 1000));
    res.json({ user: publicUser(user), settings: settingsFor(user, db.settings), license: licenseStatus(db) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", auth, (req: AuthedRequest, res) => {
  const db = readDb();
  const sessionId = req.cookies.wb_session;
  if (sessionId) delete db.sessions[sessionId];
  audit(db, { userId: req.user!.id, userName: req.user!.name, action: "LOGOUT", entityType: "USER", entityId: req.user!.id, details: "User signed out" });
  writeDb(db);
  res.clearCookie("wb_session", cookieOptions());
  res.json({ ok: true });
});

app.get("/api/me", auth, (req: AuthedRequest, res) => {
  const db = readDb();
  res.json({ user: publicUser(req.user!), settings: settingsFor(req.user!, db.settings), license: licenseStatus(db) });
});

app.get("/api/license/status", auth, (_req, res) => {
  const db = readDb();
  res.json(licenseStatus(db));
});

app.post("/api/license/activate", auth, permit("CHANGE_SETTINGS"), (req: AuthedRequest, res, next) => {
  const db = readDb();
  try {
    const nextLicense = activateLicense(text(req.body.licenseKey), req.user!.id);
    const previousLicense = db.license;
    db.license = nextLicense;
    const status = licenseStatus(db);
    if (!status.valid) {
      db.license = previousLicense;
      throw new Error(status.message);
    }
    audit(db, { userId: req.user!.id, userName: req.user!.name, action: "ACTIVATE_LICENSE", entityType: "LICENSE", entityId: status.licenseId || "license", details: status.customerName || "" });
    writeDb(db);
    res.json(status);
  } catch (error) {
    next(error);
  }
});

app.get("/api/master-data", auth, (_req, res) => {
  const db = readDb();
  res.json({ vehicles: db.vehicles, drivers: db.drivers, parties: db.parties, products: db.products });
});

app.get("/api/dashboard", auth, (_req, res) => {
  const db = readDb();
  const completed = db.transactions.filter((item) => item.status === "COMPLETED");
  res.json({
    open: db.transactions.filter((item) => item.status === "OPEN").length,
    inProgress: db.transactions.filter((item) => item.status === "IN_PROGRESS").length,
    completed: completed.length,
    totalNet: completed.reduce((sum, item) => sum + (item.netWeight || 0), 0)
  });
});

app.get("/api/device/live-weight", auth, async (_req, res) => {
  const db = readDb();
  res.json(await readLiveWeight(db.settings));
});

app.get("/api/cameras", auth, (_req, res) => {
  const db = readDb();
  res.json(db.settings.cameras.map((camera) => ({
    id: camera.id,
    name: camera.name,
    classification: camera.classification,
    position: camera.position,
    captureTiming: camera.captureTiming,
    displayOnSlip: camera.displayOnSlip,
    displayOrder: camera.displayOrder,
    active: camera.active,
    previewUrl: `/api/cameras/${camera.id}/preview.svg`
  })));
});

app.get("/api/cameras/:id/preview.svg", auth, (req, res) => {
  const db = readDb();
  const camera = db.settings.cameras.find((item) => item.id === req.params.id);
  if (!camera) {
    res.status(404).send("Camera not found");
    return;
  }
  res.header("Content-Type", "image/svg+xml");
  res.header("Cache-Control", "no-store");
  res.send(renderCameraSvg({
    cameraId: camera.id,
    cameraName: camera.name,
    position: camera.position,
    weighmentType: "LIVE",
    capturedAt: new Date().toISOString(),
    mode: "preview"
  }));
});

app.get("/api/camera-snapshots/:cameraId/:weighmentType/:capturedAt.svg", auth, (req, res) => {
  const db = readDb();
  const camera = db.settings.cameras.find((item) => item.id === req.params.cameraId);
  if (!camera) {
    res.status(404).send("Camera not found");
    return;
  }
  res.header("Content-Type", "image/svg+xml");
  res.header("Cache-Control", "private, max-age=31536000");
  res.send(renderCameraSvg({
    cameraId: camera.id,
    cameraName: camera.name,
    position: camera.position,
    weighmentType: req.params.weighmentType,
    capturedAt: decodeURIComponent(req.params.capturedAt.replace(/\.svg$/, "")),
    mode: "snapshot"
  }));
});

app.get("/api/transactions", auth, (req, res) => {
  const db = readDb();
  const transactions = filteredTransactions(db, req);
  res.json(wantsPagedResponse(req) ? paginate(transactions, req, 100) : transactions);
});

app.get("/api/transactions/next-slip-no", auth, (_req, res) => {
  const db = readDb();
  res.json({ slipNo: `SN-${String(db.meta.transactionSequence + 1).padStart(7, "0")}` });
});

app.post("/api/transactions", auth, permit("CREATE_TRANSACTION"), async (req: AuthedRequest, res, next) => {
  try {
    const db = readDb();
    const vehicle = db.vehicles.find((item) => item.id === text(req.body.vehicleId));
    const driver = db.drivers.find((item) => item.id === text(req.body.driverId));
    const party = db.parties.find((item) => item.id === text(req.body.partyId));
    if (!vehicle || !driver || !party) throw new Error("Vehicle, driver, and customer/supplier are required");
    if (!bool(req.body.captureInitialWeight, false)) throw new Error("Capture weight before saving the slip");
    const weighbridge = db.settings.weighbridges.find((item) => item.id === text(req.body.weighbridgeId)) || db.settings.weighbridges.find((item) => item.active) || db.settings.weighbridges[0];
    const capturedAt = new Date().toISOString();
    const firstWeight = weight(req.body.initialWeight);

    const transaction = {
      id: uid("txn"),
      transactionNo: nextTransactionNo(db),
      mode: req.body.mode === "MULTIPLE" ? "MULTIPLE" as const : "SINGLE" as const,
      movementType: req.body.movementType === "OUTBOUND" ? "OUTBOUND" as const : "INBOUND" as const,
      status: "IN_PROGRESS" as const,
      vehicleId: vehicle.id,
      vehicleNo: vehicle.vehicleNo,
      driverId: driver.id,
      driverName: driver.name,
      partyId: party.id,
      partyName: party.name,
      transporter: text(req.body.transporter, vehicle.transporter),
      destination: text(req.body.destination),
      driverIdentity: text(req.body.driverIdentity),
      shift: text(req.body.shift, "Day"),
      weighbridgeId: weighbridge?.id || "",
      weighbridgeName: weighbridge?.name || "Weighbridge",
      firstWeight,
      finalWeight: null,
      netWeight: null,
      firstWeighedAt: capturedAt,
      finalWeighedAt: null,
      productEntries: [],
      cameraImages: await captureCameras(db.settings, "FIRST"),
      operatorId: req.user!.id,
      operatorName: req.user!.name,
      remarks: text(req.body.remarks),
      createdAt: capturedAt,
      updatedAt: capturedAt
    };
    db.transactions.unshift(transaction);
    audit(db, { userId: req.user!.id, userName: req.user!.name, action: "CREATE_TRANSACTION", entityType: "TRANSACTION", entityId: transaction.id, details: `${transaction.transactionNo} | First weight: ${firstWeight}` });
    writeDb(db);
    res.status(201).json(transaction);
  } catch (error) {
    next(error);
  }
});

app.post("/api/transactions/:id/first-weigh", auth, permit("CAPTURE_FIRST_WEIGHT"), async (req: AuthedRequest, res, next: NextFunction) => {
  try {
    const db = readDb();
    const transaction = db.transactions.find((item) => item.id === req.params.id);
    if (!transaction) throw new Error("Transaction not found");
    if (transaction.firstWeight != null) throw new Error("First weight already captured");
    if (transaction.productEntries.length > 0 || transaction.finalWeight != null || transaction.status === "COMPLETED") {
      throw new Error("Saved transaction history cannot be edited");
    }
    transaction.firstWeight = weight(req.body.weight);
    transaction.firstWeighedAt = new Date().toISOString();
    transaction.status = "IN_PROGRESS";
    if (!bool(req.body.skipCameraCapture, false)) {
      transaction.cameraImages.push(...await captureCameras(db.settings, "FIRST"));
    }
    transaction.updatedAt = new Date().toISOString();
    audit(db, { userId: req.user!.id, userName: req.user!.name, action: "FIRST_WEIGH", entityType: "TRANSACTION", entityId: transaction.id, details: String(transaction.firstWeight) });
    writeDb(db);
    res.json(transaction);
  } catch (error) {
    next(error);
  }
});

app.post("/api/transactions/:id/product-weigh", auth, permit("CAPTURE_PRODUCT_WEIGHT"), (req: AuthedRequest, res) => {
  const db = readDb();
  const transaction = db.transactions.find((item) => item.id === req.params.id);
  const product = db.products.find((item) => item.id === text(req.body.productId));
  if (!transaction || !product) throw new Error("Transaction and product are required");
  if (transaction.firstWeight == null) throw new Error("Capture first weigh before product weighing");
  if (transaction.status !== "IN_PROGRESS" || transaction.finalWeight != null) throw new Error("Saved transaction history cannot be edited");

  const grossWeight = weight(req.body.weight);
  const previousWeight = transaction.productEntries.at(-1)?.grossWeight ?? transaction.firstWeight;
  const packageCount = Number(req.body.packageCount || 0);
  const tareWeight = Number(req.body.tareWeight || 0);
  const packingTare = Number(req.body.packingTare || 0);
  const totalTare = Math.max(0, tareWeight + packageCount * packingTare);
  const productWeight = Math.max(0, Math.abs(grossWeight - previousWeight) - totalTare);
  const entry: ProductEntry = {
    id: uid("pwe"),
    productId: product.id,
    productName: product.name,
    unit: text(req.body.unit, product.unit),
    packageCount,
    tareWeight,
    packingMode: text(req.body.packingMode),
    packingTare,
    sequence: transaction.productEntries.length + 1,
    grossWeight,
    previousWeight,
    productWeight,
    remarks: text(req.body.remarks),
    capturedAt: new Date().toISOString(),
    operatorName: req.user!.name
  };
  transaction.productEntries.push(entry);
  transaction.status = "IN_PROGRESS";
  transaction.updatedAt = new Date().toISOString();
  audit(db, { userId: req.user!.id, userName: req.user!.name, action: "PRODUCT_WEIGH", entityType: "TRANSACTION", entityId: transaction.id, details: `${product.name}: ${productWeight}` });
  writeDb(db);
  res.json(transaction);
});

app.post("/api/transactions/:id/final-weigh", auth, permit("CAPTURE_FINAL_WEIGHT"), async (req: AuthedRequest, res, next: NextFunction) => {
  try {
    const db = readDb();
    const transaction = db.transactions.find((item) => item.id === req.params.id);
    if (!transaction) throw new Error("Transaction not found");
    if (transaction.firstWeight == null) throw new Error("First weigh is required");
    if (transaction.finalWeight != null || transaction.status === "COMPLETED") throw new Error("Second weight already captured");
    if (transaction.status !== "IN_PROGRESS") throw new Error("Only in-progress slips can be completed");
    if (transaction.productEntries.length === 0) throw new Error("Add at least one product line before second weigh");
    transaction.finalWeight = weight(req.body.weight);
    transaction.netWeight = Math.abs(transaction.finalWeight - transaction.firstWeight);
    transaction.finalWeighedAt = new Date().toISOString();
    transaction.status = "COMPLETED";
    if (!bool(req.body.skipCameraCapture, false)) {
      transaction.cameraImages.push(...await captureCameras(db.settings, "FINAL"));
    }
    transaction.updatedAt = new Date().toISOString();
    audit(db, { userId: req.user!.id, userName: req.user!.name, action: "FINAL_WEIGH", entityType: "TRANSACTION", entityId: transaction.id, details: `Net: ${transaction.netWeight}` });
    writeDb(db);
    res.json(transaction);
  } catch (error) {
    next(error);
  }
});

app.post("/api/transactions/:id/camera-capture", auth, permit("CAPTURE_FIRST_WEIGHT"), async (req: AuthedRequest, res, next: NextFunction) => {
  try {
    const db = readDb();
    const transaction = db.transactions.find((item) => item.id === req.params.id);
    if (!transaction) throw new Error("Transaction not found");
    if (transaction.status !== "IN_PROGRESS") throw new Error("Saved transaction history cannot be edited");
    const weighmentType = req.body.weighmentType === "FINAL" ? "FINAL" : "FIRST";
    transaction.cameraImages.push(...await captureCameras(db.settings, weighmentType));
    transaction.updatedAt = new Date().toISOString();
    audit(db, { userId: req.user!.id, userName: req.user!.name, action: "CAMERA_CAPTURE", entityType: "TRANSACTION", entityId: transaction.id, details: weighmentType });
    writeDb(db);
    res.json(transaction);
  } catch (error) {
    next(error);
  }
});

app.post("/api/transactions/:id/reprint", auth, permit("REPRINT_SLIP"), (req: AuthedRequest, res) => {
  const db = readDb();
  const transaction = db.transactions.find((item) => item.id === req.params.id);
  if (!transaction) throw new Error("Transaction not found");
  audit(db, { userId: req.user!.id, userName: req.user!.name, action: "REPRINT_SLIP", entityType: "TRANSACTION", entityId: transaction.id, details: transaction.transactionNo });
  writeDb(db);
  res.json({ ok: true });
});

app.patch("/api/transactions/:id", auth, denyHistoricalMutation);
app.put("/api/transactions/:id", auth, denyHistoricalMutation);
app.delete("/api/transactions/:id", auth, denyHistoricalMutation);

function masterRoute<T extends { id: string }>(
  name: string,
  collection: "vehicles" | "drivers" | "parties" | "products",
  permission: Permission,
  uniqueLabel: string,
  uniqueValue: (record: T) => string,
  create: (body: Record<string, unknown>) => T
) {
  app.get(`/api/${name}`, auth, permit(permission), (req, res) => {
    const db = readDb();
    const search = queryText(req.query.search).toLowerCase();
    const rows = (db[collection] as unknown as Array<Record<string, unknown>>).filter((row) => {
      if (!search) return true;
      return Object.values(row).some((value) => String(value || "").toLowerCase().includes(search));
    });
    res.json(req.query.page || req.query.limit || req.query.search ? paginate(rows, req, 100) : rows);
  });

  app.post(`/api/${name}`, auth, permit(permission), (req: AuthedRequest, res) => {
    const db = readDb();
    const record = create(req.body);
    const key = duplicateKey(uniqueValue(record));
    if (!key) throw new Error(`${uniqueLabel} is required`);
    const rows = db[collection] as unknown as T[];
    if (rows.some((item) => duplicateKey(uniqueValue(item)) === key)) {
      throw new Error(`${uniqueLabel} already exists`);
    }
    rows.push(record);
    audit(db, { userId: req.user!.id, userName: req.user!.name, action: `CREATE_${collection.toUpperCase()}`, entityType: collection.toUpperCase(), entityId: record.id, details: JSON.stringify(record) });
    writeDb(db);
    res.status(201).json(record);
  });
}

masterRoute<Vehicle>("vehicles", "vehicles", "MANAGE_VEHICLES", "Vehicle number", (record) => record.vehicleNo, (body) => ({ id: uid("veh"), vehicleNo: text(body.vehicleNo).toUpperCase(), transporter: text(body.transporter) }));
masterRoute<Driver>("drivers", "drivers", "MANAGE_DRIVERS", "Driver name", (record) => record.name, (body) => ({ id: uid("drv"), name: text(body.name), phone: text(body.phone) }));
masterRoute<Party>("parties", "parties", "MANAGE_PARTIES", "Customer/supplier name", (record) => record.name, (body) => ({ id: uid("par"), name: text(body.name), type: text(body.type) === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER", phone: text(body.phone) }));
masterRoute<Product>("products", "products", "MANAGE_PRODUCTS", "Product name", (record) => record.name, (body) => ({ id: uid("prd"), name: text(body.name), unit: text(body.unit, "kg") }));

app.get("/api/users", auth, permit("MANAGE_USERS"), (_req, res) => {
  const db = readDb();
  res.json(db.users.map(publicUser));
});

app.post("/api/users", auth, permit("MANAGE_USERS"), (req: AuthedRequest, res) => {
  const db = readDb();
  const password = String(req.body.password || "");
  assertStrongPassword(password);
  const name = text(req.body.name);
  const username = text(req.body.username);
  if (!name || !username) throw new Error("Name and username are required");
  if (db.users.some((item) => item.username.toLowerCase() === username.toLowerCase())) {
    throw new Error("Username already exists");
  }
  const role = text(req.body.role);
  if (!isRole(role)) throw new Error("Valid role is required");
  const user = { id: uid("usr"), name, username, passwordHash: hashPassword(password), role, active: true };
  db.users.push(user);
  audit(db, { userId: req.user!.id, userName: req.user!.name, action: "CREATE_USER", entityType: "USER", entityId: user.id, details: user.username });
  writeDb(db);
  res.status(201).json(publicUser(user));
});

app.get("/api/audit-logs", auth, permit("VIEW_AUDIT_LOGS"), (req, res) => {
  const db = readDb();
  const logs = db.auditLogs
    .filter((log) => !queryText(req.query.action) || log.action === queryText(req.query.action))
    .filter((log) => !queryText(req.query.userId) || log.userId === queryText(req.query.userId))
    .filter((log) => !queryText(req.query.entityType) || log.entityType === queryText(req.query.entityType));
  res.json(req.query.page || req.query.limit || req.query.action || req.query.userId || req.query.entityType ? paginate(logs, req, 100) : logs.slice(0, 250));
});

app.patch("/api/settings", auth, permit("CHANGE_SETTINGS"), (req: AuthedRequest, res) => {
  const db = readDb();
  db.settings.companyName = text(req.body.companyName, db.settings.companyName);
  db.settings.siteName = text(req.body.siteName, db.settings.siteName);
  db.settings.logoUrl = text(req.body.logoUrl, db.settings.logoUrl);
  db.settings.slipManualCameraCaptureEnabled = bool(req.body.slipManualCameraCaptureEnabled, db.settings.slipManualCameraCaptureEnabled);
  db.settings.slipWeighbridgeNodeVisible = bool(req.body.slipWeighbridgeNodeVisible, db.settings.slipWeighbridgeNodeVisible);
  db.settings.slipShiftVisible = bool(req.body.slipShiftVisible, db.settings.slipShiftVisible);
  db.settings.slipSelectVehicleVisible = bool(req.body.slipSelectVehicleVisible, db.settings.slipSelectVehicleVisible);
  db.settings.slipSearchControlsVisible = bool(req.body.slipSearchControlsVisible, db.settings.slipSearchControlsVisible);
  db.settings.device = {
    ...db.settings.device,
    connectionType: connectionType(req.body.connectionType ?? db.settings.device.connectionType),
    comPort: text(req.body.comPort, db.settings.device.comPort),
    baudRate: Number(req.body.baudRate || db.settings.device.baudRate),
    dataBits: Number(req.body.dataBits || db.settings.device.dataBits),
    stopBits: Number(req.body.stopBits || db.settings.device.stopBits),
    parity: text(req.body.parity, db.settings.device.parity),
    tcpHost: text(req.body.tcpHost, db.settings.device.tcpHost),
    tcpPort: Number(req.body.tcpPort || db.settings.device.tcpPort),
    weightFormat: text(req.body.weightFormat, db.settings.device.weightFormat),
    stableDetection: bool(req.body.stableDetection, db.settings.device.stableDetection)
  };
  db.settings.weighbridges = normalizeWeighbridges(req.body.weighbridges, db.settings.weighbridges, db.settings.device);
  const activeWeighbridge = db.settings.weighbridges.find((item) => item.active) || db.settings.weighbridges[0];
  if (activeWeighbridge) {
    db.settings.device = {
      connectionType: activeWeighbridge.connectionType,
      comPort: activeWeighbridge.comPort,
      baudRate: activeWeighbridge.baudRate,
      dataBits: activeWeighbridge.dataBits,
      stopBits: activeWeighbridge.stopBits,
      parity: activeWeighbridge.parity,
      tcpHost: activeWeighbridge.tcpHost,
      tcpPort: activeWeighbridge.tcpPort,
      weightFormat: activeWeighbridge.weightFormat,
      stableDetection: activeWeighbridge.stableDetection
    };
  }
  db.settings.cameras = normalizeCameras(req.body.cameras, db.settings.cameras);
  audit(db, { userId: req.user!.id, userName: req.user!.name, action: "CHANGE_SETTINGS", entityType: "SETTINGS", entityId: "system", details: "System settings updated" });
  writeDb(db);
  res.json(db.settings);
});

app.get("/api/reports/:type/export", auth, permit("VIEW_REPORTS"), (req, res) => {
  const db = readDb();
  const format = text(req.query.format, "csv");
  const rows = filteredTransactions(db, req).map((item) => [item.transactionNo, item.createdAt, item.vehicleNo, item.partyName, item.status, item.netWeight ?? ""]);
  const csv = [["Transaction", "Date", "Vehicle", "Party", "Status", "Net Weight"], ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  audit(db, { userId: (req as AuthedRequest).user!.id, userName: (req as AuthedRequest).user!.name, action: "EXPORT_REPORT", entityType: "REPORT", entityId: req.params.type, details: format });
  writeDb(db);
  if (format === "csv") {
    res.header("Content-Type", "text/csv");
    res.attachment(`${req.params.type}-report.csv`);
    res.send(csv);
    return;
  }
  res.header("Content-Type", "text/plain");
  res.attachment(`${req.params.type}-report.${format === "excel" ? "xls" : "pdf"}`);
  res.send(csv);
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API endpoint not found", code: "NOT_FOUND", status: 404 });
});

app.use(express.static(path.join(process.cwd(), "frontend", "dist")));
app.get("*", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "frontend", "dist", "index.html"));
});

app.use((error: Error, req: Request, res: Response, _next: () => void) => {
  const message = error.message || "Unexpected server error";
  const lower = message.toLowerCase();
  const status =
    lower.includes("authentication required") ? 401 :
    lower.includes("permission denied") ? 403 :
    lower.includes("not found") ? 404 :
    lower.includes("already exists") ? 409 :
    400;
  const code =
    status === 401 ? "AUTHENTICATION_REQUIRED" :
    status === 403 ? "PERMISSION_DENIED" :
    status === 404 ? "NOT_FOUND" :
    status === 409 ? "DUPLICATE_RECORD" :
    "REQUEST_ERROR";
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${status}: ${message}`);
  res.status(status).json({ error: message, code, status });
});

app.listen(PORT, HOST, () => {
  console.log(`Weighbridge app running at http://${HOST}:${PORT}`);
});
