import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createTrialLicense } from "./license";
import { AuditLog, Db, Role, Settings, SlipTemplate } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "runtime-db.json");
const DEFAULT_AI_CONVEYOR_ROI = "0.04,0.24; 0.78,0.20; 0.97,0.86; 0.06,0.88";
const DEFAULT_AI_IGNORE_ZONES = "0,0; 1,0; 1,0.18; 0,0.18\n0.84,0.48; 1,0.48; 1,1; 0.84,1";

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function isRtspUrl(value: string) {
  return /^rtsp:\/\//i.test(value.trim());
}

function repairAiServiceUrl(db: Db, aiCounting: Settings["aiProductCounting"]) {
  const serviceUrl = aiCounting.serviceUrl.trim();
  if (!serviceUrl) return false;
  if (isHttpUrl(serviceUrl)) {
    if (serviceUrl === aiCounting.serviceUrl) return false;
    aiCounting.serviceUrl = serviceUrl;
    return true;
  }
  if (isRtspUrl(serviceUrl)) {
    const selectedCamera = db.settings.cameras.find((camera) => camera.id === aiCounting.cameraId) || db.settings.cameras[0];
    if (selectedCamera && !selectedCamera.rtspUrl.trim()) {
      selectedCamera.rtspUrl = serviceUrl;
    }
  }
  aiCounting.serviceUrl = "";
  return true;
}

export function uid(prefix: string) {
  return `${prefix}-${crypto.randomBytes(6).toString("hex")}`;
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  if (storedHash.startsWith("scrypt$")) {
    const [, salt, expected] = storedHash.split("$");
    if (!salt || !expected) return false;
    const actual = crypto.scryptSync(password, salt, 64);
    const expectedBuffer = Buffer.from(expected, "hex");
    return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
  }

  const legacyHash = crypto.createHash("sha256").update(password).digest("hex");
  const actual = Buffer.from(legacyHash, "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function needsPasswordRehash(storedHash: string) {
  return !storedHash.startsWith("scrypt$");
}

function strongPassword(password: string) {
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

export function assertStrongPassword(password: string) {
  if (!strongPassword(password)) {
    throw new Error("Password must include uppercase, lowercase, number, symbol, and at least 8 characters");
  }
}

export function defaultSlipTemplate(): SlipTemplate {
  return {
    paperSize: "A4",
    width: 794,
    height: 1123,
    elements: [
      { id: "tpl-company", type: "TEXT", label: "Company Name", field: "companyName", x: 40, y: 28, w: 714, h: 36, fontSize: 22, bold: true, align: "center", visible: true },
      { id: "tpl-site", type: "TEXT", label: "Site Name", field: "siteName", x: 40, y: 66, w: 714, h: 24, fontSize: 14, bold: false, align: "center", visible: true },
      { id: "tpl-slip", type: "FIELD", label: "Slip No.", field: "transactionNo", x: 44, y: 112, w: 330, h: 28, fontSize: 13, bold: true, align: "left", visible: true },
      { id: "tpl-date", type: "FIELD", label: "Date", field: "createdAt", x: 420, y: 112, w: 330, h: 28, fontSize: 13, bold: false, align: "left", visible: true },
      { id: "tpl-vehicle", type: "FIELD", label: "Vehicle", field: "vehicleNo", x: 44, y: 150, w: 330, h: 28, fontSize: 13, bold: true, align: "left", visible: true },
      { id: "tpl-party", type: "FIELD", label: "Customer/Supplier", field: "partyName", x: 420, y: 150, w: 330, h: 28, fontSize: 13, bold: false, align: "left", visible: true },
      { id: "tpl-driver", type: "FIELD", label: "Driver", field: "driverName", x: 44, y: 188, w: 330, h: 28, fontSize: 13, bold: false, align: "left", visible: true },
      { id: "tpl-transporter", type: "FIELD", label: "Transporter", field: "transporter", x: 420, y: 188, w: 330, h: 28, fontSize: 13, bold: false, align: "left", visible: true },
      { id: "tpl-first", type: "FIELD", label: "1st Weight", field: "firstWeight", x: 44, y: 240, w: 220, h: 32, fontSize: 14, bold: true, align: "left", visible: true },
      { id: "tpl-second", type: "FIELD", label: "2nd Weight", field: "finalWeight", x: 286, y: 240, w: 220, h: 32, fontSize: 14, bold: true, align: "left", visible: true },
      { id: "tpl-net", type: "FIELD", label: "Net Weight", field: "netWeight", x: 528, y: 240, w: 220, h: 32, fontSize: 15, bold: true, align: "left", visible: true },
      { id: "tpl-products", type: "PRODUCT_TABLE", label: "Products", x: 44, y: 305, w: 706, h: 170, fontSize: 12, bold: false, align: "left", visible: true },
      { id: "tpl-first-cams", type: "CAMERA_GROUP", label: "1st Weight Camera Captures", cameraGroup: "FIRST", x: 44, y: 500, w: 706, h: 160, fontSize: 11, bold: false, align: "left", visible: true },
      { id: "tpl-final-cams", type: "CAMERA_GROUP", label: "2nd Weight Camera Captures", cameraGroup: "FINAL", x: 44, y: 682, w: 706, h: 160, fontSize: 11, bold: false, align: "left", visible: true },
      { id: "tpl-qr", type: "QR", label: "QR Verification", field: "transactionNo", x: 44, y: 880, w: 220, h: 55, fontSize: 12, bold: false, align: "left", visible: true },
      { id: "tpl-signature", type: "SIGNATURE", label: "Signature", x: 420, y: 884, w: 330, h: 45, fontSize: 12, bold: false, align: "left", visible: true }
    ]
  };
}

const settings: Settings = {
  companyName: "North Gate Weighbridge",
  siteName: "Main Yard",
  logoUrl: "",
  sessionTimeoutMinutes: 30,
  slipNumberMode: "PREVIEW",
  slipManualCameraCaptureEnabled: false,
  slipWeighbridgeNodeVisible: false,
  slipShiftVisible: false,
  slipSelectVehicleVisible: false,
  slipSearchControlsVisible: false,
  aiProductCounting: {
    enabled: false,
    serviceUrl: "",
    cameraId: "cam-rear",
    countingMode: "LINE_CROSSING",
    productType: "Bags / cartons / crates",
    confidenceThreshold: 70,
    minBoxWidth: 35,
    maxBoxWidth: 620,
    minBoxHeight: 8,
    maxBoxHeight: 140,
    minAspectRatio: 3,
    maxAspectRatio: 28,
    countGateRatio: 0.62,
    movementDirection: "AUTO",
    trackingTimeoutFrames: 45,
    duplicateWindowSeconds: 20,
    conveyorRoi: DEFAULT_AI_CONVEYOR_ROI,
    ignoreZones: DEFAULT_AI_IGNORE_ZONES,
    requireOperatorConfirmation: true,
    attachSnapshotToSlip: true
  },
  device: {
    connectionType: "simulator",
    comPort: "COM1",
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    tcpHost: "192.168.1.50",
    tcpPort: 4001,
    weightFormat: "ST,GS,+00012345kg",
    stableDetection: true
  },
  weighbridges: [
    {
      id: "wb-main",
      name: "Main Weighbridge",
      location: "Main Yard",
      active: true,
      displayOrder: 1,
      connectionType: "simulator",
      comPort: "COM1",
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      tcpHost: "192.168.1.50",
      tcpPort: 4001,
      weightFormat: "ST,GS,+00012345kg",
      stableDetection: true
    }
  ],
  cameras: [
    { id: "cam-front", name: "Front Camera", classification: "Weighbridge slip", position: "FRONT", rtspUrl: "rtsp://192.168.1.20/front", username: "admin", password: "", captureTiming: "BOTH", displayOnSlip: true, displayOrder: 1, active: true },
    { id: "cam-rear", name: "Rear Camera", classification: "Weighbridge slip", position: "REAR", rtspUrl: "rtsp://192.168.1.21/rear", username: "admin", password: "", captureTiming: "BOTH", displayOnSlip: true, displayOrder: 2, active: true },
    { id: "cam-side", name: "Side Camera", classification: "Weighbridge slip", position: "SIDE", rtspUrl: "rtsp://192.168.1.22/side", username: "admin", password: "", captureTiming: "FINAL", displayOnSlip: true, displayOrder: 3, active: true }
  ],
  slipTemplate: defaultSlipTemplate()
};

const seedDb: Db = {
  meta: { transactionSequence: 1000, reservedSlips: [] },
  sessions: {},
  users: [
    { id: "usr-admin", name: "Admin Operator", username: "admin", passwordHash: hashPassword("Admin123!"), role: "ADMIN", active: true },
    { id: "usr-operator", name: "Scale Operator", username: "operator", passwordHash: hashPassword("Operator123!"), role: "WEIGHBRIDGE_OPERATOR", active: true }
  ],
  vehicles: [
    { id: "veh-1", vehicleNo: "ABC-123XY", transporter: "Apex Logistics" },
    { id: "veh-2", vehicleNo: "LAG-552QJ", transporter: "Metro Haulage" }
  ],
  drivers: [
    { id: "drv-1", name: "Musa Danladi", phone: "+234 803 000 1000" },
    { id: "drv-2", name: "Ngozi Okeke", phone: "+234 805 000 2000" }
  ],
  parties: [
    { id: "par-1", name: "Apex Aggregates", type: "CUSTOMER", phone: "+234 800 111 2222" },
    { id: "par-2", name: "Metro Foods Ltd", type: "SUPPLIER", phone: "+234 800 333 4444" }
  ],
  products: [
    { id: "prd-1", name: "Granite", unit: "kg" },
    { id: "prd-2", name: "Maize", unit: "kg" },
    { id: "prd-3", name: "Diesel", unit: "kg" }
  ],
  transactions: [],
  auditLogs: [],
  settings,
  license: createTrialLicense(settings)
};

export function readDb(): Db {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) writeDb(seedDb);
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8")) as Db;
  let changed = false;

  if (!Array.isArray(db.meta.reservedSlips)) {
    db.meta.reservedSlips = [];
    changed = true;
  }

  if (!db.license) {
    db.license = createTrialLicense(db.settings);
    changed = true;
  }

  if (typeof db.settings.slipManualCameraCaptureEnabled !== "boolean") {
    db.settings.slipManualCameraCaptureEnabled = false;
    changed = true;
  }

  if (db.settings.slipNumberMode !== "RESERVE" && db.settings.slipNumberMode !== "PREVIEW") {
    db.settings.slipNumberMode = "PREVIEW";
    changed = true;
  }

  if (typeof db.settings.slipWeighbridgeNodeVisible !== "boolean") {
    db.settings.slipWeighbridgeNodeVisible = false;
    changed = true;
  }

  if (typeof db.settings.slipShiftVisible !== "boolean") {
    db.settings.slipShiftVisible = false;
    changed = true;
  }

  if (typeof db.settings.slipSelectVehicleVisible !== "boolean") {
    db.settings.slipSelectVehicleVisible = false;
    changed = true;
  }

  if (typeof db.settings.slipSearchControlsVisible !== "boolean") {
    db.settings.slipSearchControlsVisible = false;
    changed = true;
  }

  const migratedAiCounting = db.settings.aiProductCounting as Settings["aiProductCounting"] | undefined;
  if (!migratedAiCounting || typeof migratedAiCounting !== "object") {
    db.settings.aiProductCounting = {
      enabled: false,
      serviceUrl: "",
      cameraId: db.settings.cameras[0]?.id || "",
      countingMode: "LINE_CROSSING",
      productType: "Bags / cartons / crates",
      confidenceThreshold: 70,
      minBoxWidth: 35,
      maxBoxWidth: 620,
      minBoxHeight: 8,
      maxBoxHeight: 140,
      minAspectRatio: 3,
      maxAspectRatio: 28,
      countGateRatio: 0.62,
      movementDirection: "AUTO",
      trackingTimeoutFrames: 45,
      duplicateWindowSeconds: 20,
      conveyorRoi: DEFAULT_AI_CONVEYOR_ROI,
      ignoreZones: DEFAULT_AI_IGNORE_ZONES,
      requireOperatorConfirmation: true,
      attachSnapshotToSlip: true
    };
    changed = true;
  } else {
    if (typeof migratedAiCounting.enabled !== "boolean") {
      migratedAiCounting.enabled = false;
      changed = true;
    }
    if (typeof migratedAiCounting.serviceUrl !== "string") {
      migratedAiCounting.serviceUrl = "";
      changed = true;
    }
    if (typeof migratedAiCounting.cameraId !== "string") {
      migratedAiCounting.cameraId = db.settings.cameras[0]?.id || "";
      changed = true;
    }
    if (!["LINE_CROSSING", "ZONE_OCCUPANCY", "MANUAL_REVIEW"].includes(migratedAiCounting.countingMode)) {
      migratedAiCounting.countingMode = "LINE_CROSSING";
      changed = true;
    }
    if (typeof migratedAiCounting.productType !== "string") {
      migratedAiCounting.productType = "Bags / cartons / crates";
      changed = true;
    }
    if (!Number.isFinite(migratedAiCounting.confidenceThreshold)) {
      migratedAiCounting.confidenceThreshold = 70;
      changed = true;
    }
    if (!Number.isFinite(migratedAiCounting.minBoxWidth)) {
      migratedAiCounting.minBoxWidth = 35;
      changed = true;
    }
    if (!Number.isFinite(migratedAiCounting.maxBoxWidth)) {
      migratedAiCounting.maxBoxWidth = 620;
      changed = true;
    }
    if (!Number.isFinite(migratedAiCounting.minBoxHeight)) {
      migratedAiCounting.minBoxHeight = 8;
      changed = true;
    }
    if (!Number.isFinite(migratedAiCounting.maxBoxHeight)) {
      migratedAiCounting.maxBoxHeight = 140;
      changed = true;
    }
    if (!Number.isFinite(migratedAiCounting.minAspectRatio)) {
      migratedAiCounting.minAspectRatio = 3;
      changed = true;
    }
    if (!Number.isFinite(migratedAiCounting.maxAspectRatio)) {
      migratedAiCounting.maxAspectRatio = 28;
      changed = true;
    }
    if (!Number.isFinite(migratedAiCounting.countGateRatio)) {
      migratedAiCounting.countGateRatio = 0.62;
      changed = true;
    }
    if (!["AUTO", "LEFT_TO_RIGHT", "RIGHT_TO_LEFT"].includes(migratedAiCounting.movementDirection)) {
      migratedAiCounting.movementDirection = "AUTO";
      changed = true;
    }
    if (!Number.isFinite(migratedAiCounting.trackingTimeoutFrames)) {
      migratedAiCounting.trackingTimeoutFrames = 45;
      changed = true;
    }
    if (!Number.isFinite(migratedAiCounting.duplicateWindowSeconds)) {
      migratedAiCounting.duplicateWindowSeconds = 20;
      changed = true;
    }
    if (typeof migratedAiCounting.conveyorRoi !== "string") {
      migratedAiCounting.conveyorRoi = DEFAULT_AI_CONVEYOR_ROI;
      changed = true;
    }
    if (typeof migratedAiCounting.ignoreZones !== "string") {
      migratedAiCounting.ignoreZones = DEFAULT_AI_IGNORE_ZONES;
      changed = true;
    }
    if (typeof migratedAiCounting.requireOperatorConfirmation !== "boolean") {
      migratedAiCounting.requireOperatorConfirmation = true;
      changed = true;
    }
    if (typeof migratedAiCounting.attachSnapshotToSlip !== "boolean") {
      migratedAiCounting.attachSnapshotToSlip = true;
      changed = true;
    }
    if (repairAiServiceUrl(db, migratedAiCounting)) {
      changed = true;
    }
  }

  if (!db.settings.slipTemplate || !Array.isArray(db.settings.slipTemplate.elements)) {
    db.settings.slipTemplate = defaultSlipTemplate();
    changed = true;
  }

  if (!Array.isArray(db.settings.weighbridges) || db.settings.weighbridges.length === 0) {
    db.settings.weighbridges = [
      {
        id: "wb-main",
        name: "Main Weighbridge",
        location: db.settings.siteName || "Main Yard",
        active: true,
        displayOrder: 1,
        ...db.settings.device
      }
    ];
    changed = true;
  } else {
    db.settings.weighbridges = db.settings.weighbridges.map((weighbridge, index) => {
      const migrated = weighbridge as typeof weighbridge & { location?: string; displayOrder?: number; active?: boolean };
      if (!migrated.location) {
        migrated.location = db.settings.siteName || "Main Yard";
        changed = true;
      }
      if (!Number.isFinite(migrated.displayOrder)) {
        migrated.displayOrder = index + 1;
        changed = true;
      }
      if (typeof migrated.active !== "boolean") {
        migrated.active = index === 0;
        changed = true;
      }
      return migrated;
    });
  }

  const activeWeighbridge = db.settings.weighbridges.find((item) => item.active) || db.settings.weighbridges[0];
  if (activeWeighbridge && JSON.stringify(db.settings.device) !== JSON.stringify({
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
  })) {
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
    changed = true;
  }

  db.settings.cameras = db.settings.cameras.map((camera, index) => {
    const migrated = camera as typeof camera & {
      classification?: string;
      displayOnSlip?: boolean;
      displayOrder?: number;
      active?: boolean;
    };
    if (!migrated.classification) {
      migrated.classification = "Weighbridge slip";
      changed = true;
    }
    if (typeof migrated.displayOnSlip !== "boolean") {
      migrated.displayOnSlip = true;
      changed = true;
    }
    if (!Number.isFinite(migrated.displayOrder)) {
      migrated.displayOrder = index + 1;
      changed = true;
    }
    if (typeof migrated.active !== "boolean") {
      migrated.active = true;
      changed = true;
    }
    return migrated;
  });

  for (const transaction of db.transactions) {
    const migratedTransaction = transaction as typeof transaction & {
      destination?: string;
      driverIdentity?: string;
      shift?: string;
      weighbridgeId?: string;
      weighbridgeName?: string;
      firstWeighedAt?: string | null;
      finalWeighedAt?: string | null;
      plannedProductId?: string;
      plannedProductName?: string;
      plannedUnit?: string;
    };
    const activeWeighbridgeForSlip = db.settings.weighbridges.find((item) => item.active) || db.settings.weighbridges[0];
    if (typeof migratedTransaction.destination !== "string") {
      migratedTransaction.destination = "";
      changed = true;
    }
    if (typeof migratedTransaction.driverIdentity !== "string") {
      migratedTransaction.driverIdentity = "";
      changed = true;
    }
    if (typeof migratedTransaction.shift !== "string") {
      migratedTransaction.shift = "Day";
      changed = true;
    }
    if (typeof migratedTransaction.weighbridgeId !== "string") {
      migratedTransaction.weighbridgeId = activeWeighbridgeForSlip?.id || "";
      changed = true;
    }
    if (typeof migratedTransaction.weighbridgeName !== "string") {
      migratedTransaction.weighbridgeName = activeWeighbridgeForSlip?.name || "Weighbridge";
      changed = true;
    }
    if (migratedTransaction.firstWeighedAt === undefined) {
      migratedTransaction.firstWeighedAt = transaction.firstWeight == null ? null : transaction.updatedAt;
      changed = true;
    }
    if (migratedTransaction.finalWeighedAt === undefined) {
      migratedTransaction.finalWeighedAt = transaction.finalWeight == null ? null : transaction.updatedAt;
      changed = true;
    }
    if (typeof migratedTransaction.plannedProductId !== "string") {
      migratedTransaction.plannedProductId = "";
      changed = true;
    }
    if (typeof migratedTransaction.plannedProductName !== "string") {
      migratedTransaction.plannedProductName = "";
      changed = true;
    }
    if (typeof migratedTransaction.plannedUnit !== "string") {
      migratedTransaction.plannedUnit = "";
      changed = true;
    }
    for (const entry of transaction.productEntries) {
      const migratedEntry = entry as typeof entry & {
        unit?: string;
        packageCount?: number;
        tareWeight?: number;
        packingMode?: string;
        packingTare?: number;
        remarks?: string;
      };
      if (typeof migratedEntry.unit !== "string") {
        migratedEntry.unit = "kg";
        changed = true;
      }
      if (!Number.isFinite(migratedEntry.packageCount)) {
        migratedEntry.packageCount = 0;
        changed = true;
      }
      if (!Number.isFinite(migratedEntry.tareWeight)) {
        migratedEntry.tareWeight = 0;
        changed = true;
      }
      if (typeof migratedEntry.packingMode !== "string") {
        migratedEntry.packingMode = "";
        changed = true;
      }
      if (!Number.isFinite(migratedEntry.packingTare)) {
        migratedEntry.packingTare = 0;
        changed = true;
      }
      if (typeof migratedEntry.remarks !== "string") {
        migratedEntry.remarks = "";
        changed = true;
      }
    }
    for (const image of transaction.cameraImages) {
      const cameraImage = image as typeof image & { cameraId?: string; cameraName?: string };
      const camera = db.settings.cameras.find((item) => item.position === image.position) || db.settings.cameras[0];
      if (!cameraImage.cameraId && camera) {
        cameraImage.cameraId = camera.id;
        changed = true;
      }
      if (!cameraImage.cameraName && camera) {
        cameraImage.cameraName = camera.name;
        changed = true;
      }
      if (image.imageUrl.startsWith("/camera-captures/") && camera) {
        image.imageUrl = `/api/camera-snapshots/${camera.id}/${image.weighmentType}/${encodeURIComponent(image.capturedAt)}.svg`;
        changed = true;
      }
    }
  }

  if (changed) writeDb(db);
  return db;
}

export function writeDb(db: Db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function nextTransactionNo(db: Db) {
  db.meta.transactionSequence += 1;
  return `SN-${String(db.meta.transactionSequence).padStart(7, "0")}`;
}

export function peekTransactionNo(db: Db) {
  return `SN-${String(db.meta.transactionSequence + 1).padStart(7, "0")}`;
}

export function audit(db: Db, input: Omit<AuditLog, "id" | "createdAt">) {
  db.auditLogs.unshift({ id: uid("aud"), createdAt: new Date().toISOString(), ...input });
}

export function isRole(value: string): value is Role {
  return ["ADMIN", "WEIGHBRIDGE_OPERATOR", "ACCOUNTS", "STORE_DISPATCH", "VIEWER"].includes(value);
}
