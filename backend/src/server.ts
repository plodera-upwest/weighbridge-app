import cookieParser from "cookie-parser";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import path from "node:path";
import { captureCameras, renderCameraSvg } from "./camera";
import { readLiveWeight } from "./device-client";
import { assertStrongPassword, audit, hashPassword, isRole, nextTransactionNo, readDb, uid, writeDb } from "./repository";
import { hasPermission, publicUser } from "./rbac";
import { Permission, ProductEntry, Settings, User } from "./types";

const PORT = Number(process.env.PORT || 4175);
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));

type AuthedRequest = Request & { user?: User };

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
  const user = getUser(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  req.user = user;
  next();
}

function permit(permission: Permission) {
  return (req: AuthedRequest, res: Response, next: () => void) => {
    if (!req.user || !hasPermission(req.user, permission)) {
      res.status(403).json({ error: "Permission denied" });
      return;
    }
    next();
  };
}

function text(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
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

app.post("/api/auth/login", (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.username === text(req.body.username) && item.passwordHash === hashPassword(String(req.body.password || "")) && item.active);
  if (!user) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  const sessionId = uid("ses");
  db.sessions[sessionId] = {
    userId: user.id,
    expiresAt: new Date(Date.now() + db.settings.sessionTimeoutMinutes * 60 * 1000).toISOString()
  };
  audit(db, { userId: user.id, userName: user.name, action: "LOGIN", entityType: "USER", entityId: user.id, details: "User signed in" });
  writeDb(db);
  res.cookie("wb_session", sessionId, { httpOnly: true, sameSite: "lax", maxAge: db.settings.sessionTimeoutMinutes * 60 * 1000 });
  res.json({ user: publicUser(user), settings: db.settings });
});

app.post("/api/auth/logout", auth, (req: AuthedRequest, res) => {
  const db = readDb();
  const sessionId = req.cookies.wb_session;
  if (sessionId) delete db.sessions[sessionId];
  audit(db, { userId: req.user!.id, userName: req.user!.name, action: "LOGOUT", entityType: "USER", entityId: req.user!.id, details: "User signed out" });
  writeDb(db);
  res.clearCookie("wb_session");
  res.json({ ok: true });
});

app.get("/api/me", auth, (req: AuthedRequest, res) => {
  const db = readDb();
  res.json({ user: publicUser(req.user!), settings: db.settings });
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

app.get("/api/transactions", auth, (_req, res) => {
  const db = readDb();
  res.json(db.transactions);
});

app.get("/api/transactions/next-slip-no", auth, (_req, res) => {
  const db = readDb();
  res.json({ slipNo: `TXN-${String(db.meta.transactionSequence + 1).padStart(7, "0")}` });
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
    transaction.firstWeight = weight(req.body.weight);
    transaction.firstWeighedAt = new Date().toISOString();
    transaction.status = "IN_PROGRESS";
    transaction.cameraImages.push(...await captureCameras(db.settings, "FIRST"));
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
  if (transaction.status === "COMPLETED") throw new Error("Completed transactions cannot be changed");

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
    if (transaction.productEntries.length === 0) throw new Error("Add at least one product line before second weigh");
    transaction.finalWeight = weight(req.body.weight);
    transaction.netWeight = Math.abs(transaction.finalWeight - transaction.firstWeight);
    transaction.finalWeighedAt = new Date().toISOString();
    transaction.status = "COMPLETED";
    transaction.cameraImages.push(...await captureCameras(db.settings, "FINAL"));
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
    if (transaction.status === "COMPLETED") throw new Error("Completed transactions cannot be changed");
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

function masterRoute<T extends { id: string }>(name: string, collection: "vehicles" | "drivers" | "parties" | "products", permission: Permission, create: (body: Record<string, unknown>) => T) {
  app.post(`/api/${name}`, auth, permit(permission), (req: AuthedRequest, res) => {
    const db = readDb();
    const record = create(req.body);
    (db[collection] as unknown as T[]).push(record);
    audit(db, { userId: req.user!.id, userName: req.user!.name, action: `CREATE_${collection.toUpperCase()}`, entityType: collection.toUpperCase(), entityId: record.id, details: JSON.stringify(record) });
    writeDb(db);
    res.status(201).json(record);
  });
}

masterRoute("vehicles", "vehicles", "MANAGE_VEHICLES", (body) => ({ id: uid("veh"), vehicleNo: text(body.vehicleNo).toUpperCase(), transporter: text(body.transporter) }));
masterRoute("drivers", "drivers", "MANAGE_DRIVERS", (body) => ({ id: uid("drv"), name: text(body.name), phone: text(body.phone) }));
masterRoute("parties", "parties", "MANAGE_PARTIES", (body) => ({ id: uid("par"), name: text(body.name), type: text(body.type) === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER", phone: text(body.phone) }));
masterRoute("products", "products", "MANAGE_PRODUCTS", (body) => ({ id: uid("prd"), name: text(body.name), unit: text(body.unit, "kg") }));

app.get("/api/users", auth, permit("MANAGE_USERS"), (_req, res) => {
  const db = readDb();
  res.json(db.users.map(publicUser));
});

app.post("/api/users", auth, permit("MANAGE_USERS"), (req: AuthedRequest, res) => {
  const db = readDb();
  const password = String(req.body.password || "");
  assertStrongPassword(password);
  const role = text(req.body.role);
  if (!isRole(role)) throw new Error("Valid role is required");
  const user = { id: uid("usr"), name: text(req.body.name), username: text(req.body.username), passwordHash: hashPassword(password), role, active: true };
  db.users.push(user);
  audit(db, { userId: req.user!.id, userName: req.user!.name, action: "CREATE_USER", entityType: "USER", entityId: user.id, details: user.username });
  writeDb(db);
  res.status(201).json(publicUser(user));
});

app.get("/api/audit-logs", auth, permit("VIEW_AUDIT_LOGS"), (_req, res) => {
  const db = readDb();
  res.json(db.auditLogs.slice(0, 250));
});

app.patch("/api/settings", auth, permit("CHANGE_SETTINGS"), (req: AuthedRequest, res) => {
  const db = readDb();
  db.settings.companyName = text(req.body.companyName, db.settings.companyName);
  db.settings.siteName = text(req.body.siteName, db.settings.siteName);
  db.settings.logoUrl = text(req.body.logoUrl, db.settings.logoUrl);
  db.settings.slipManualCameraCaptureEnabled = bool(req.body.slipManualCameraCaptureEnabled, db.settings.slipManualCameraCaptureEnabled);
  db.settings.slipWeighbridgeNodeVisible = bool(req.body.slipWeighbridgeNodeVisible, db.settings.slipWeighbridgeNodeVisible);
  db.settings.slipShiftVisible = bool(req.body.slipShiftVisible, db.settings.slipShiftVisible);
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
  const rows = db.transactions.map((item) => [item.transactionNo, item.createdAt, item.vehicleNo, item.partyName, item.status, item.netWeight ?? ""]);
  const csv = [["Transaction", "Date", "Vehicle", "Party", "Status", "Net Weight"], ...rows].map((row) => row.join(",")).join("\n");
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

app.use(express.static(path.join(process.cwd(), "frontend", "dist")));
app.get("*", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "frontend", "dist", "index.html"));
});

app.use((error: Error, _req: Request, res: Response, _next: () => void) => {
  res.status(400).json({ error: error.message });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Weighbridge app running at http://127.0.0.1:${PORT}`);
});
