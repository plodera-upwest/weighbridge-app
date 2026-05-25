export type Role = "ADMIN" | "WEIGHBRIDGE_OPERATOR" | "ACCOUNTS" | "STORE_DISPATCH" | "VIEWER";
export type TransactionStatus = "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type TransactionMode = "SINGLE" | "MULTIPLE";

export type Permission =
  | "CREATE_TRANSACTION"
  | "EDIT_TRANSACTION"
  | "APPROVE_CORRECTION"
  | "PRINT_SLIP"
  | "REPRINT_SLIP"
  | "VIEW_REPORTS"
  | "MANAGE_USERS"
  | "MANAGE_PRODUCTS"
  | "MANAGE_VEHICLES"
  | "MANAGE_DRIVERS"
  | "MANAGE_PARTIES"
  | "CHANGE_SETTINGS"
  | "CAPTURE_FIRST_WEIGHT"
  | "CAPTURE_PRODUCT_WEIGHT"
  | "CAPTURE_FINAL_WEIGHT"
  | "VIEW_AUDIT_LOGS";

export type User = {
  id: string;
  name: string;
  username: string;
  passwordHash: string;
  role: Role;
  active: boolean;
};

export type Vehicle = { id: string; vehicleNo: string; transporter: string };
export type Driver = { id: string; name: string; phone: string };
export type Party = { id: string; name: string; type: "CUSTOMER" | "SUPPLIER"; phone: string };
export type Product = { id: string; name: string; unit: string };

export type ProductEntry = {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  packageCount: number;
  tareWeight: number;
  packingMode: string;
  packingTare: number;
  sequence: number;
  grossWeight: number;
  previousWeight: number;
  productWeight: number;
  remarks: string;
  capturedAt: string;
  operatorName: string;
};

export type CameraImage = {
  id: string;
  cameraId: string;
  cameraName: string;
  weighmentType: "FIRST" | "FINAL";
  position: "FRONT" | "REAR" | "SIDE";
  imageUrl: string;
  capturedAt: string;
};

export type Transaction = {
  id: string;
  transactionNo: string;
  mode: TransactionMode;
  movementType?: "INBOUND" | "OUTBOUND";
  status: TransactionStatus;
  vehicleId: string;
  vehicleNo: string;
  driverId: string;
  driverName: string;
  partyId: string;
  partyName: string;
  transporter: string;
  destination: string;
  driverIdentity: string;
  shift: string;
  weighbridgeId: string;
  weighbridgeName: string;
  firstWeight: number | null;
  finalWeight: number | null;
  netWeight: number | null;
  firstWeighedAt: string | null;
  finalWeighedAt: string | null;
  productEntries: ProductEntry[];
  cameraImages: CameraImage[];
  operatorId: string;
  operatorName: string;
  remarks: string;
  createdAt: string;
  updatedAt: string;
};

export type AuditLog = {
  id: string;
  createdAt: string;
  userId: string;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
};

export type Settings = {
  companyName: string;
  siteName: string;
  logoUrl: string;
  sessionTimeoutMinutes: number;
  slipManualCameraCaptureEnabled: boolean;
  slipWeighbridgeNodeVisible: boolean;
  slipShiftVisible: boolean;
  slipSelectVehicleVisible: boolean;
  slipSearchControlsVisible: boolean;
  device: {
    connectionType: "serial" | "tcp" | "simulator";
    comPort: string;
    baudRate: number;
    dataBits: number;
    stopBits: number;
    parity: string;
    tcpHost: string;
    tcpPort: number;
    weightFormat: string;
    stableDetection: boolean;
  };
  weighbridges: Array<{
    id: string;
    name: string;
    location: string;
    active: boolean;
    displayOrder: number;
    connectionType: "serial" | "tcp" | "simulator";
    comPort: string;
    baudRate: number;
    dataBits: number;
    stopBits: number;
    parity: string;
    tcpHost: string;
    tcpPort: number;
    weightFormat: string;
    stableDetection: boolean;
  }>;
  cameras: Array<{
    id: string;
    name: string;
    classification: string;
    position: "FRONT" | "REAR" | "SIDE";
    rtspUrl: string;
    username: string;
    password: string;
    captureTiming: "FIRST" | "FINAL" | "BOTH";
    displayOnSlip: boolean;
    displayOrder: number;
    active: boolean;
  }>;
};

export type LicensePayload = {
  licenseId: string;
  customerName: string;
  issuedAt: string;
  expiresAt: string;
  maxUsers: number;
  maxWeighbridges: number;
  modules: string[];
};

export type LicenseRecord = {
  key: string;
  payload: LicensePayload;
  activatedAt: string;
  activatedBy: string;
};

export type LicenseStatus = {
  state: "ACTIVE" | "TRIAL" | "EXPIRED" | "MISSING" | "INVALID";
  valid: boolean;
  message: string;
  licenseId?: string;
  customerName?: string;
  issuedAt?: string;
  expiresAt?: string;
  daysRemaining?: number;
  maxUsers?: number;
  maxWeighbridges?: number;
  modules?: string[];
};

export type Db = {
  meta: { transactionSequence: number };
  sessions: Record<string, { userId: string; expiresAt: string }>;
  users: User[];
  vehicles: Vehicle[];
  drivers: Driver[];
  parties: Party[];
  products: Product[];
  transactions: Transaction[];
  auditLogs: AuditLog[];
  settings: Settings;
  license?: LicenseRecord;
};
