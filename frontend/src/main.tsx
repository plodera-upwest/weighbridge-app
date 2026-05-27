import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BarChart3, History, LayoutDashboard, Package, Scale, Settings as SettingsIcon, Truck, User, Users as UsersIcon, type LucideIcon } from "lucide-react";
import "./styles.css";

type Role = "ADMIN" | "WEIGHBRIDGE_OPERATOR" | "ACCOUNTS" | "STORE_DISPATCH" | "VIEWER";
type Status = "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
type TransactionMode = "SINGLE" | "MULTIPLE";

type User = { id: string; name: string; username: string; role: Role; permissions: string[] };
type LicenseStatus = {
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
type Vehicle = { id: string; vehicleNo: string; transporter: string };
type Driver = { id: string; name: string; phone: string };
type Party = { id: string; name: string; type: "CUSTOMER" | "SUPPLIER"; phone: string };
type Product = { id: string; name: string; unit: string };
type QuickAddKind = "vehicle" | "party" | "driver";
type ProductEntry = { id: string; productId: string; productName: string; unit: string; packageCount: number; tareWeight: number; packingMode: string; packingTare: number; sequence: number; grossWeight: number; previousWeight: number; productWeight: number; remarks: string; capturedAt: string; operatorName: string };
type CameraPosition = "FRONT" | "REAR" | "SIDE";
type WeighbridgeSetting = {
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
};
type CameraSetting = {
  id: string;
  name: string;
  classification: string;
  position: CameraPosition;
  rtspUrl: string;
  username: string;
  password: string;
  captureTiming: "FIRST" | "FINAL" | "BOTH";
  displayOnSlip: boolean;
  displayOrder: number;
  active: boolean;
};
type CameraImage = { id: string; cameraId: string; cameraName: string; weighmentType: "FIRST" | "FINAL"; position: CameraPosition; imageUrl: string; capturedAt: string };
type Transaction = {
  id: string;
  transactionNo: string;
  mode: TransactionMode;
  movementType?: "INBOUND" | "OUTBOUND";
  status: Status;
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
  operatorName: string;
  remarks: string;
  createdAt: string;
};
type Settings = {
  companyName: string;
  siteName: string;
  logoUrl: string;
  slipNumberMode: "PREVIEW" | "RESERVE";
  slipManualCameraCaptureEnabled: boolean;
  slipWeighbridgeNodeVisible: boolean;
  slipShiftVisible: boolean;
  slipSelectVehicleVisible: boolean;
  slipSearchControlsVisible: boolean;
  device: Record<string, string | number | boolean>;
  weighbridges: WeighbridgeSetting[];
  cameras: CameraSetting[];
};

type AppData = {
  user: User | null;
  settings: Settings | null;
  license: LicenseStatus | null;
  vehicles: Vehicle[];
  drivers: Driver[];
  parties: Party[];
  products: Product[];
  transactions: Transaction[];
};

type LiveReading = { weight: number; stable: boolean; source: string; weighbridgeId?: string; weighbridgeName?: string };

const emptyData: AppData = {
  user: null,
  settings: null,
  license: null,
  vehicles: [],
  drivers: [],
  parties: [],
  products: [],
  transactions: []
};

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
  } catch {
    throw new Error("Network error. Check the server connection and try again.");
  }
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : { error: await response.text().catch(() => "") };
  if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}`);
  return payload;
}

function errorMessage(error: unknown, fallback = "Something went wrong") {
  if (typeof error === "string" && error.trim()) return error;
  return error instanceof Error && error.message ? error.message : fallback;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { message: string }> {
  state = { message: "" };

  static getDerivedStateFromError(error: unknown) {
    return { message: errorMessage(error, "The app screen could not be loaded") };
  }

  componentDidCatch(error: unknown) {
    console.error("[UI error]", error);
  }

  render() {
    if (this.state.message) {
      return (
        <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
          <section className="max-w-lg rounded-lg border border-red-200 bg-white p-6 shadow-xl">
            <p className="text-xs font-semibold uppercase text-red-700">Application Error</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">This screen could not load</h1>
            <p className="mt-3 text-sm text-slate-600">{this.state.message}</p>
            <button className="btn-primary mt-5" type="button" onClick={() => window.location.reload()}>Reload App</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

function formObject(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form).entries());
}

function fmtWeight(value: number | null | undefined) {
  if (value == null) return "-";
  return `${value.toLocaleString()} kg`;
}

function fmtIndicatorWeight(value: number | null | undefined) {
  if (value == null) return "-";
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
}

function fmtDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function fmtSlipDateTime(value: string | Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${date.getFullYear()} ${date.getHours()}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function can(user: User | null, permission: string) {
  return Boolean(user?.permissions.includes(permission));
}

function slipCameras(settings: Settings | null) {
  return (settings?.cameras || [])
    .filter((camera) => camera.active && camera.displayOnSlip)
    .sort((left, right) => left.displayOrder - right.displayOrder);
}

function App() {
  const [data, setData] = useState<AppData>(emptyData);
  const [active, setActive] = useState("Dashboard");
  const [error, setError] = useState("");
  const [systemError, setSystemError] = useState("");
  const [toast, setToast] = useState("");
  const [liveWeight, setLiveWeight] = useState<LiveReading>({ weight: 0, stable: false, source: "offline" });
  const [selected, setSelected] = useState<Transaction | null>(null);

  const flash = (message: string) => {
    setToast(message);
    window.clearTimeout((flash as unknown as { timer?: number }).timer);
    (flash as unknown as { timer?: number }).timer = window.setTimeout(() => setToast(""), 2800);
  };

  const reportError = (err: unknown, fallback = "Action failed") => {
    const message = errorMessage(err, fallback);
    setSystemError(message);
    flash(message);
  };

  useEffect(() => {
    const onWindowError = (event: ErrorEvent) => {
      console.error("[Browser error]", event.error || event.message);
      reportError(event.error || event.message, "Unexpected browser error");
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error("[Unhandled promise rejection]", event.reason);
      reportError(event.reason, "Unexpected background error");
    };
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  const refresh = async () => {
    try {
      const me = await api<{ user: User; settings: Settings; license: LicenseStatus }>("/api/me");
      if (!me.license.valid) {
        setData({ ...emptyData, user: me.user, settings: me.settings, license: me.license });
        return;
      }
      const [master, transactions] = await Promise.all([
        api<Omit<AppData, "user" | "settings" | "license" | "transactions">>("/api/master-data"),
        api<Transaction[]>("/api/transactions")
      ]);
      setData({ user: me.user, settings: me.settings, license: me.license, transactions, ...master });
      setSystemError("");
    } catch (err) {
      reportError(err, "Could not refresh app data");
      throw err;
    }
  };

  useEffect(() => {
    api<{ user: User; settings: Settings; license: LicenseStatus }>("/api/me")
      .then(() => refresh())
      .catch((err) => {
        setData(emptyData);
        if (!String(errorMessage(err)).toLowerCase().includes("authentication required")) {
          setError(errorMessage(err, "Could not load the app"));
        }
      });
  }, []);

  useEffect(() => {
    if (!data.user) return undefined;
    const poll = async () => {
      try {
        setLiveWeight(await api<typeof liveWeight>("/api/device/live-weight"));
      } catch (err) {
        setLiveWeight((current) => ({ ...current, source: errorMessage(err, "Live weight unavailable"), stable: false }));
      }
    };
    poll();
    const timer = window.setInterval(poll, 1500);
    return () => window.clearInterval(timer);
  }, [data.user]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify(formObject(form)) });
      await refresh();
      flash("Signed in");
    } catch (err) {
      setError(errorMessage(err, "Login failed"));
    }
  };

  const logout = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
      setData(emptyData);
      setSystemError("");
    } catch (err) {
      reportError(err, "Could not logout");
    }
  };

  if (!data.user || !data.settings) {
    return (
      <main className="min-h-screen bg-slate-950 bg-[url('/weighbridge-yard.svg')] bg-cover bg-center">
        <div className="flex min-h-screen items-center justify-center bg-slate-950/70 p-5">
          <form onSubmit={login} className="grid w-full max-w-md gap-5 rounded-lg bg-white p-8 shadow-2xl">
            <div>
              <p className="text-xs font-medium uppercase text-teal-700">Weighbridge Control</p>
              <h1 className="text-3xl font-semibold text-slate-950">Operator Login</h1>
            </div>
            <label className="field">Username<input name="username" required autoComplete="username" /></label>
            <label className="field">Password<input name="password" type="password" required autoComplete="current-password" /></label>
            <button className="btn-primary">Sign in</button>
            <p className="min-h-6 text-sm font-medium text-red-700">{error}</p>
          </form>
        </div>
      </main>
    );
  }

  if (data.license && !data.license.valid) {
    return <LicenseGate user={data.user} license={data.license} onRefresh={refresh} onLogout={logout} />;
  }

  const primaryMenu = [
    "Dashboard",
    "Weighbridge Slip",
    "Vehicles",
    "Drivers",
    "Customers",
    "Products",
    "Reports"
  ];
  const utilityMenu = [
    "Audit Logs",
    "Users",
    "Settings"
  ];

  return (
    <main className={`app-shell ${active === "Weighbridge Slip" ? "slip-app" : ""}`}>
      <aside className="app-sidebar sticky top-0 flex h-screen flex-col gap-6 border-r border-slate-200 bg-white p-5 max-lg:static max-lg:h-auto">
        <div className="brand flex items-center gap-3">
          <div className="brand-mark grid h-12 w-12 place-items-center rounded-md bg-teal-700 font-semibold text-white">
            <MenuIcon name="Weighbridge Slip" />
          </div>
          <div>
            <strong>{data.settings.companyName}</strong>
            <small className="block text-slate-500">{data.settings.siteName}</small>
          </div>
        </div>
        <nav className="app-nav grid gap-2">
          {primaryMenu.map((item) => (
            <button key={item} onClick={() => setActive(item)} className={`nav-btn ${active === item ? "active" : ""}`}>
              <span className="nav-icon"><MenuIcon name={item} /></span>
              <span>{item}</span>
            </button>
          ))}
          <div className="nav-divider" />
          {utilityMenu.map((item) => (
            <button key={item} onClick={() => setActive(item)} className={`nav-btn ${active === item ? "active" : ""}`}>
              <span className="nav-icon"><MenuIcon name={item} /></span>
              <span>{item}</span>
            </button>
          ))}
        </nav>
        <div className="operator-card mt-auto border-t pt-4">
          <strong>{data.user.name}</strong>
          <small className="block text-slate-500">{data.user.role.replaceAll("_", " ")}</small>
          <button className="btn-secondary mt-3 w-full" onClick={logout}>Logout</button>
        </div>
      </aside>

      <section className={`app-content min-w-0 p-6 ${active === "Weighbridge Slip" ? "slip-content" : ""}`}>
        {systemError && (
          <div className="app-error-banner" role="alert">
            <span>{systemError}</span>
            <button type="button" onClick={() => setSystemError("")}>Cancel</button>
          </div>
        )}
        {active === "Dashboard" && <Dashboard transactions={data.transactions} />}
        {active === "Weighbridge Slip" && (
          <Transactions
            data={data}
            liveWeight={liveWeight}
            onRefresh={refresh}
            onToast={flash}
            onView={setSelected}
            onBack={() => setActive("Dashboard")}
          />
        )}
        {active === "Vehicles" && <MasterModule title="Vehicle Master" endpoint="/api/vehicles" fields={["vehicleNo", "transporter"]} rows={data.vehicles} primary="vehicleNo" onRefresh={refresh} disabled={!can(data.user, "MANAGE_VEHICLES")} />}
        {active === "Drivers" && <MasterModule title="Driver Master" endpoint="/api/drivers" fields={["name", "phone"]} rows={data.drivers} primary="name" onRefresh={refresh} disabled={!can(data.user, "MANAGE_DRIVERS")} />}
        {active === "Customers" && <MasterModule title="Customer/Supplier Master" endpoint="/api/parties" fields={["name", "type", "phone"]} rows={data.parties} primary="name" onRefresh={refresh} disabled={!can(data.user, "MANAGE_PARTIES")} />}
        {active === "Products" && <MasterModule title="Product Master" endpoint="/api/products" fields={["name", "unit"]} rows={data.products} primary="name" onRefresh={refresh} disabled={!can(data.user, "MANAGE_PRODUCTS")} />}
        {active === "Reports" && <Reports />}
        {active === "Audit Logs" && <AuditLogs />}
        {active === "Users" && <Users disabled={!can(data.user, "MANAGE_USERS")} />}
        {active === "Settings" && <Settings settings={data.settings} disabled={!can(data.user, "CHANGE_SETTINGS")} onRefresh={refresh} />}
      </section>

      {selected && <SlipModal transaction={selected} settings={data.settings} onClose={() => setSelected(null)} onToast={flash} />}
      {toast && <div className="fixed bottom-5 right-5 rounded-md bg-slate-950 px-4 py-3 font-medium text-white shadow-xl">{toast}</div>}
    </main>
  );
}

function LiveWeight({ reading, compact = false }: { reading: LiveReading; compact?: boolean }) {
  if (compact) {
    return (
      <div className="live-weight live-weight-compact">
        <div>
          <p>Digital Indicator</p>
          <strong>{fmtIndicatorWeight(reading.weight)}</strong>
        </div>
        <div className="compact-indicator-meta">
          <span className={reading.stable ? "stable" : "motion"}>{reading.stable ? "Stable" : "Motion"}</span>
          <small>{reading.source}</small>
        </div>
      </div>
    );
  }

  return (
    <div className={`live-weight ${compact ? "live-weight-compact" : ""}`}>
      <div>
        <p className="text-xs font-medium uppercase text-teal-200">Digital Indicator</p>
        <strong className={compact ? "text-2xl" : "text-3xl"}>{fmtIndicatorWeight(reading.weight)}</strong>
      </div>
      <div className="text-right max-sm:mt-3 max-sm:text-left">
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${reading.stable ? "bg-teal-100 text-teal-900" : "bg-amber-100 text-amber-900"}`}>
          {reading.stable ? "Stable" : "Motion"}
        </span>
        <small className="mt-2 block text-slate-300">{reading.source}</small>
      </div>
    </div>
  );
}

function LicenseGate({ user, license, onRefresh, onLogout }: { user: User; license: LicenseStatus; onRefresh: () => Promise<void>; onLogout: () => Promise<void> }) {
  const [licenseKey, setLicenseKey] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const canActivate = can(user, "CHANGE_SETTINGS");

  const activate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      await api<LicenseStatus>("/api/license/activate", {
        method: "POST",
        body: JSON.stringify({ licenseKey })
      });
      setLicenseKey("");
      await onRefresh();
    } catch (error) {
      setMessage(errorMessage(error, "Could not activate license"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="license-page">
      <section className="license-card">
        <div>
          <p className="slip-eyebrow">Licensing</p>
          <h1>License Activation Required</h1>
          <p className="license-message">{license.message}</p>
        </div>
        <div className="license-status-grid">
          <span>Status<strong>{license.state}</strong></span>
          <span>Customer<strong>{license.customerName || "-"}</strong></span>
          <span>Expiry<strong>{license.expiresAt ? fmtSlipDateTime(license.expiresAt) : "-"}</strong></span>
          <span>Users<strong>{license.maxUsers || "-"}</strong></span>
          <span>Weighbridges<strong>{license.maxWeighbridges || "-"}</strong></span>
        </div>
        {canActivate ? (
          <form className="grid gap-3" onSubmit={activate}>
            <label className="field">License key<textarea value={licenseKey} onChange={(event) => setLicenseKey(event.target.value)} rows={5} placeholder="Paste license key here" required /></label>
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn-primary" disabled={saving}>{saving ? "Activating..." : "Activate License"}</button>
              <button className="btn-secondary" type="button" onClick={onLogout}>Logout</button>
            </div>
            {message && <p className="text-sm font-medium text-red-700">{message}</p>}
          </form>
        ) : (
          <div className="grid gap-3">
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900">Ask an administrator to activate the license.</p>
            <button className="btn-secondary justify-self-start" type="button" onClick={onLogout}>Logout</button>
          </div>
        )}
      </section>
    </main>
  );
}

function Dashboard({ transactions }: { transactions: Transaction[] }) {
  const completed = transactions.filter((item) => item.status === "COMPLETED");
  const totalNet = completed.reduce((sum, item) => sum + (item.netWeight || 0), 0);
  return (
    <section className="grid gap-5">
      <Header eyebrow="Operations" title="Dashboard" />
      <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2 max-sm:grid-cols-1">
        <Metric label="Open" value={transactions.filter((item) => item.status === "OPEN").length} />
        <Metric label="In Progress" value={transactions.filter((item) => item.status === "IN_PROGRESS").length} />
        <Metric label="Completed" value={completed.length} />
        <Metric label="Total Net" value={fmtWeight(totalNet)} />
      </div>
      <TransactionTable rows={transactions.slice(0, 8)} />
    </section>
  );
}

function Transactions({ data, liveWeight, onRefresh, onToast, onView, onBack }: { data: AppData; liveWeight: LiveReading; onRefresh: () => Promise<void>; onToast: (message: string) => void; onView: (transaction: Transaction) => void; onBack: () => void }) {
  const openTransactions = data.transactions.filter((item) => item.status !== "COMPLETED" && item.status !== "CANCELLED");
  const selectableTransactions = data.transactions.filter((item) => item.status !== "CANCELLED");
  const [activeSlipId, setActiveSlipId] = useState("");
  const [nextSlipNo, setNextSlipNo] = useState("Auto-generated");
  const [newSlipStarted, setNewSlipStarted] = useState(false);
  const [reservedSlipNo, setReservedSlipNo] = useState("");
  const [movementType, setMovementType] = useState<"INBOUND" | "OUTBOUND">("INBOUND");
  const [transactionMode, setTransactionMode] = useState<TransactionMode>("SINGLE");
  const [entryFormKey, setEntryFormKey] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [livePaused, setLivePaused] = useState(false);
  const [pausedWeight, setPausedWeight] = useState<number | null>(null);
  const [pendingFirstWeight, setPendingFirstWeight] = useState<{ weight: number; capturedAt: string } | null>(null);
  const [capturedWeight, setCapturedWeight] = useState<{ weight: number; capturedAt: string } | null>(null);
  const [createError, setCreateError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [quickAddKind, setQuickAddKind] = useState<QuickAddKind | null>(null);
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  const [draftSelection, setDraftSelection] = useState({ vehicleId: "", partyId: "", driverId: "" });
  const [productDraft, setProductDraft] = useState({
    productId: "",
    packingMode: "Loose",
    packageCount: 0,
    unit: "",
    tareWeight: 0,
    packingTare: 0,
    remarks: ""
  });
  const activeSlip = activeSlipId ? selectableTransactions.find((item) => item.id === activeSlipId) || null : null;
  const effectiveTransactionMode = activeSlip?.mode || transactionMode;
  const systemWeighmentType: "FIRST" | "SECOND" = !activeSlip || activeSlip.firstWeight == null ? "FIRST" : "SECOND";
  const shownSlipNo = activeSlip?.transactionNo || (newSlipStarted ? nextSlipNo : "SN-0000000");
  const slipNoIsPlaceholder = !activeSlip && !newSlipStarted;
  const isCompletedSlip = activeSlip?.status === "COMPLETED";
  const lockLoadedSlipDetails = activeSlip?.status === "IN_PROGRESS" || activeSlip?.status === "COMPLETED";
  const lockProductEntry = !activeSlip || activeSlip.firstWeight == null || isCompletedSlip;
  const canAddIntermediateProduct = effectiveTransactionMode === "MULTIPLE";
  const selectedVehicleId = activeSlip?.vehicleId || draftSelection.vehicleId;
  const selectedPartyId = activeSlip?.partyId || draftSelection.partyId;
  const selectedDriverId = activeSlip?.driverId || draftSelection.driverId;
  const shownMovementType = activeSlip?.movementType || movementType;
  const locationLabel = shownMovementType === "INBOUND" ? "Receiving Location" : "Destination";
  const displayedNetWeight = activeSlip?.netWeight ?? activeSlip?.firstWeight ?? pendingFirstWeight?.weight;
  const activeWeighbridge = data.settings?.weighbridges.find((item) => item.active) || data.settings?.weighbridges[0];
  const shownWeight = livePaused && pausedWeight != null ? pausedWeight : liveWeight.weight;
  const filteredSlips = selectableTransactions.filter((item) => {
    const text = `${item.transactionNo} ${item.vehicleNo} ${item.partyName}`.toLowerCase();
    return text.includes(searchTerm.toLowerCase());
  });
  const vehicleSlips = selectedVehicleId
    ? data.transactions
      .filter((item) => item.vehicleId === selectedVehicleId && item.status !== "CANCELLED" && item.id !== activeSlip?.id)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    : [];
  const vehicleOpenSlips = vehicleSlips.filter((item) => item.status !== "COMPLETED");
  const vehicleCompletedSlips = vehicleSlips.filter((item) => item.status === "COMPLETED").slice(0, 3);

  useEffect(() => {
    api<{ slipNo: string; mode: Settings["slipNumberMode"] }>("/api/transactions/next-slip-no")
      .then((payload) => setNextSlipNo(payload.slipNo))
      .catch((err) => {
        const message = errorMessage(err, "Could not load next slip number");
        setNextSlipNo("Auto-generated");
        setCreateError(message);
        onToast(message);
      });
  }, [data.transactions.length]);

  useEffect(() => {
    if (activeSlipId && !selectableTransactions.some((item) => item.id === activeSlipId)) {
      setActiveSlipId("");
    }
  }, [activeSlipId, openTransactions, selectableTransactions]);

  useEffect(() => {
    setProductDraft((current) => ({
      ...current,
      unit: current.unit || data.products.find((product) => product.id === current.productId)?.unit || ""
    }));
  }, [data.products]);

  const resetEntry = async (voidReserved = true) => {
    if (voidReserved && reservedSlipNo) {
      try {
        await api("/api/transactions/cancel-reserved-slip", { method: "POST", body: JSON.stringify({ transactionNo: reservedSlipNo }) });
      } catch (err) {
        onToast(errorMessage(err, "Could not cancel reserved slip number"));
      }
    }
    setActiveSlipId("");
    setNewSlipStarted(false);
    setReservedSlipNo("");
    setNextSlipNo("SN-0000000");
    setPendingFirstWeight(null);
    setCapturedWeight(null);
    setCreateError("");
    setMovementType("INBOUND");
    setTransactionMode("SINGLE");
    setDraftSelection({ vehicleId: "", partyId: "", driverId: "" });
    setProductDraft({
      productId: "",
      packingMode: "Loose",
      packageCount: 0,
      unit: "",
      tareWeight: 0,
      packingTare: 0,
      remarks: ""
    });
    setEntryFormKey((current) => current + 1);
  };

  const startNewSlip = async () => {
    await resetEntry(true);
    setCreateError("");
    try {
      if (data.settings?.slipNumberMode === "RESERVE") {
        const reservation = await api<{ slipNo: string }>("/api/transactions/reserve-slip-no", { method: "POST" });
        setNextSlipNo(reservation.slipNo);
        setReservedSlipNo(reservation.slipNo);
      } else {
        const preview = await api<{ slipNo: string }>("/api/transactions/next-slip-no");
        setNextSlipNo(preview.slipNo);
      }
      setNewSlipStarted(true);
    } catch (err) {
      const message = errorMessage(err, "Could not start new slip");
      setCreateError(message);
      onToast(message);
    }
  };

  const quickAdd = async (kind: QuickAddKind, values: Record<string, string>) => {
    setQuickAddSaving(true);
    try {
      if (kind === "vehicle") {
        const vehicle = await api<Vehicle>("/api/vehicles", { method: "POST", body: JSON.stringify({ vehicleNo: values.vehicleNo, transporter: "" }) });
        setDraftSelection((current) => ({ ...current, vehicleId: vehicle.id }));
        onToast(`Vehicle ${vehicle.vehicleNo} added`);
      }
      if (kind === "party") {
        const party = await api<Party>("/api/parties", { method: "POST", body: JSON.stringify({ name: values.name, type: "CUSTOMER", phone: "" }) });
        setDraftSelection((current) => ({ ...current, partyId: party.id }));
        onToast(`Customer ${party.name} added`);
      }
      if (kind === "driver") {
        const driver = await api<Driver>("/api/drivers", { method: "POST", body: JSON.stringify({ name: values.name, phone: "" }) });
        setDraftSelection((current) => ({ ...current, driverId: driver.id }));
        onToast(`Driver ${driver.name} added`);
      }
      await onRefresh();
      setQuickAddKind(null);
    } catch (err) {
      onToast(errorMessage(err, "Could not add record"));
    } finally {
      setQuickAddSaving(false);
    }
  };

  const continueSlip = (transaction: Transaction) => {
    setActiveSlipId(transaction.id);
    setNewSlipStarted(false);
    setReservedSlipNo("");
    setPendingFirstWeight(null);
    setCapturedWeight(null);
    setCreateError("");
    setMovementType(transaction.movementType || "INBOUND");
    setTransactionMode(transaction.mode);
    onToast(`Continuing slip ${transaction.transactionNo}`);
  };

  const saveSlip = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setCreateError("");
    if (activeSlip) {
      if (activeSlip.status === "COMPLETED") {
        onToast("Completed slips cannot be changed");
        return;
      }
      if (!capturedWeight) {
        const message = "Capture weight first to save";
        setCreateError(message);
        onToast(message);
        return;
      }
      if (systemWeighmentType === "FIRST") {
        if (activeSlip.firstWeight != null) {
          const message = "Add product lines before saving 2nd Weight";
          setCreateError(message);
          onToast(message);
          return;
        }
        const saved = await action(`/api/transactions/${activeSlip.id}/first-weigh`, { weight: capturedWeight.weight, skipCameraCapture: true }, "First weight saved");
        if (saved) {
          setCapturedWeight(null);
          setPendingFirstWeight(null);
        }
        return;
      }
      if (activeSlip.firstWeight == null) {
        const message = "Save first weight before selecting 2nd Weight";
        setCreateError(message);
        onToast(message);
        return;
      }
      if (activeSlip.mode === "MULTIPLE" && activeSlip.productEntries.length === 0) {
        const message = "Add product lines before saving 2nd Weight";
        setCreateError(message);
        onToast(message);
        return;
      }
      if (activeSlip.mode !== "MULTIPLE" && !productDraft.productId) {
        const message = "Select product before saving 2nd Weight";
        setCreateError(message);
        onToast(message);
        return;
      }
      const saved = await action(`/api/transactions/${activeSlip.id}/final-weigh`, { ...productDraft, weight: capturedWeight.weight, skipCameraCapture: true }, "Second weight saved");
      if (saved) setCapturedWeight(null);
      return;
    }
    if (!capturedWeight) {
      const message = "Capture weight first to save";
      setCreateError(message);
      onToast(message);
      return;
    }
    if (!newSlipStarted) {
      const message = "Click New Slip before saving a new slip";
      setCreateError(message);
      onToast(message);
      return;
    }
    const capturedFirstWeight = capturedWeight;
    setPendingFirstWeight(capturedFirstWeight);
    setIsCreating(true);
    try {
      const transaction = await api<Transaction>("/api/transactions", {
        method: "POST",
        body: JSON.stringify({
          ...formObject(form),
          reservedSlipNo,
          captureInitialWeight: true,
          initialWeight: capturedFirstWeight.weight
        })
      });
      form.reset();
      await onRefresh();
      let previewError = "";
      try {
        const preview = await api<{ slipNo: string }>("/api/transactions/next-slip-no");
        setNextSlipNo(preview.slipNo);
      } catch (err) {
        previewError = errorMessage(err, "Slip saved, but next slip number could not be loaded");
      }
      await resetEntry(false);
      onToast(previewError || `Slip ${transaction.transactionNo} saved. Select it from Select Slip to continue.`);
      if (previewError) setCreateError(previewError);
    } catch (err) {
      setCreateError(errorMessage(err, "Could not create transaction"));
    } finally {
      setIsCreating(false);
    }
  };

  const action = async (path: string, body: object, message: string) => {
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      await onRefresh();
      onToast(message);
      return true;
    } catch (err) {
      onToast(errorMessage(err, "Action failed"));
      return false;
    }
  };

  const captureProduct = async () => {
    if (!activeSlip) {
      onToast("Select an open slip first");
      return;
    }
    if (activeSlip.status === "COMPLETED") {
      onToast("Completed slips cannot be changed");
      return;
    }
    if (activeSlip.firstWeight == null) {
      const message = "Capture first weight before adding products";
      setCreateError(message);
      onToast(message);
      return;
    }
    if (activeSlip.mode !== "MULTIPLE") {
      const message = "Single product slips use the 2nd Weight as the product line";
      setCreateError(message);
      onToast(message);
      return;
    }
    if (!capturedWeight) {
      const message = "Capture weight first before adding product";
      setCreateError(message);
      onToast(message);
      return;
    }
    if (!productDraft.productId) {
      const message = "Product needs to be selected before capturing weight";
      setCreateError(message);
      onToast(message);
      return;
    }
    const captured = await action(`/api/transactions/${activeSlip.id}/product-weigh`, { ...productDraft, weight: capturedWeight.weight }, "Product line captured");
    if (captured) {
      setCapturedWeight(null);
      setProductDraft((current) => ({
        ...current,
        productId: "",
        unit: ""
      }));
    }
  };

  const captureWeight = async () => {
    setCreateError("");
    if (isCompletedSlip) {
      onToast("Completed slips cannot be changed");
      return;
    }
    if (!activeSlip && !newSlipStarted) {
      const message = "Click New Slip before capturing weight";
      setCreateError(message);
      onToast(message);
      return;
    }
    if (!liveWeight.stable) {
      const message = "Wait for stable weight before capturing";
      setCreateError(message);
      onToast(message);
      return;
    }
    const nextCaptured = { weight: shownWeight, capturedAt: new Date().toISOString() };
    setCapturedWeight(nextCaptured);
    if (!activeSlip || activeSlip.firstWeight == null) {
      setPendingFirstWeight(nextCaptured);
    }
    if (activeSlip) {
      const captured = await action(`/api/transactions/${activeSlip.id}/camera-capture`, { weighmentType: systemWeighmentType === "SECOND" ? "FINAL" : "FIRST" }, "Weight and camera captured");
      if (!captured) {
        setCapturedWeight(null);
        if (activeSlip.firstWeight == null) setPendingFirstWeight(null);
        return;
      }
      setCapturedWeight(nextCaptured);
    } else {
      onToast("Weight captured. Camera will be attached when the new slip is saved.");
    }
  };

  const captureCamera = async () => {
    if (!activeSlip) {
      onToast("Select an open slip first");
      return;
    }
    await action(`/api/transactions/${activeSlip.id}/camera-capture`, { weighmentType: systemWeighmentType === "SECOND" ? "FINAL" : "FIRST" }, "Camera image captured");
  };

  const selectedProduct = data.products.find((item) => item.id === productDraft.productId);

  return (
    <>
    <section className="weighbridge-page">
      <header className="weighbridge-topbar">
        <h1>Weighbridge Management</h1>
        <div className="weighbridge-top-actions">
          <span className="topbar-icon" aria-hidden="true">!</span>
          <span className="topbar-avatar" aria-hidden="true">{data.user?.name?.slice(0, 1) || "U"}</span>
        </div>
      </header>

      <form id="weighment-entry-form" className="weighbridge-workspace" key={`${entryFormKey}-${activeSlip?.id || "new"}`} onSubmit={saveSlip}>
        {data.settings?.slipShiftVisible ? null : <input type="hidden" name="shift" value={activeSlip?.shift || "Day"} />}
        {data.settings?.slipWeighbridgeNodeVisible ? null : <input type="hidden" name="weighbridgeId" value={activeSlip?.weighbridgeId || activeWeighbridge?.id || ""} />}

        <section className="weighbridge-column">
          <div className="slip-primary-actions" aria-label="Slip actions">
            <button className="btn-primary" type="button" onClick={startNewSlip}>New Slip</button>
            <button className="btn-secondary" type="button" onClick={() => {
              resetEntry();
              onToast("Entry cleared");
            }}>Cancel</button>
            <button className="btn-primary" type="submit" disabled={isCreating || isCompletedSlip || (!activeSlip && (!newSlipStarted || !can(data.user, "CREATE_TRANSACTION")))}>{isCreating ? "Saving..." : "Save"}</button>
            <button className="btn-secondary" type="button" onClick={() => activeSlip && onView(activeSlip)} disabled={!activeSlip || activeSlip.status !== "COMPLETED"}>Print Slip</button>
          </div>

          <article className="wb-card transaction-card">
            <div className="wb-card-head">
              <h2>Transaction Details</h2>
              <span className="status-pill">{activeSlip?.status || "NEW"}</span>
            </div>
            <div className="wb-field-grid wb-two">
              <label className={`field field-muted ${slipNoIsPlaceholder ? "is-placeholder-slip" : ""}`}>Slip No<input value={shownSlipNo} readOnly /></label>
              <label className="field field-muted">Date Time<input value={activeSlip ? fmtSlipDateTime(activeSlip.createdAt) : fmtSlipDateTime()} readOnly /></label>
              <label className="field">Select Slip<select value={activeSlip?.id || ""} onChange={(event) => {
                const selectedSlip = selectableTransactions.find((item) => item.id === event.target.value);
                setActiveSlipId(event.target.value);
                setPendingFirstWeight(null);
                setCapturedWeight(null);
                setCreateError("");
                setMovementType(selectedSlip?.movementType || "INBOUND");
                setTransactionMode(selectedSlip?.mode || "SINGLE");
              }}>
                <option value=""></option>
                {filteredSlips.map((item) => (
                  <option key={item.id} value={item.id}>
                    {data.settings?.slipSelectVehicleVisible ? `${item.transactionNo} - ${item.vehicleNo}` : item.transactionNo}
                  </option>
                ))}
              </select></label>
              <label className="field">Movement<select name="movementType" value={shownMovementType} onChange={(event) => setMovementType(event.target.value as "INBOUND" | "OUTBOUND")} disabled={lockLoadedSlipDetails}>
                <option value="INBOUND">Inbound</option>
                <option value="OUTBOUND">Outbound</option>
              </select></label>
              <label className="field">Product Workflow<select name="mode" value={effectiveTransactionMode} onChange={(event) => setTransactionMode(event.target.value as TransactionMode)} disabled={Boolean(activeSlip)}>
                <option value="SINGLE">Single product</option>
                <option value="MULTIPLE">Multiple products</option>
              </select></label>
              <label className="field wb-span-2 field-muted">Weighment Type<input value={systemWeighmentType === "FIRST" ? "1st Weight" : "2nd Weight"} readOnly /></label>
              {data.settings?.slipShiftVisible && (
                <label className="field">Shift<select name="shift" defaultValue={activeSlip?.shift || "Day"} disabled={lockLoadedSlipDetails}><option>Day</option><option>Night</option><option>Morning</option><option>Evening</option></select></label>
              )}
              {data.settings?.slipWeighbridgeNodeVisible && (
                <label className="field">Weighbridge<select name="weighbridgeId" defaultValue={activeSlip?.weighbridgeId || activeWeighbridge?.id || ""} disabled={lockLoadedSlipDetails}>{data.settings?.weighbridges.map((item) => <option key={item.id} value={item.id}>{item.name} {item.active ? "(active)" : "(disabled)"}</option>)}</select></label>
              )}
            </div>
          </article>

          <article className="wb-card party-card">
            <h2><span className="section-glyph">CA</span> Vehicle & Party Information</h2>
            <div className="wb-field-grid">
              <label className="field quick-add-field">Vehicle No<span className="quick-add-control"><select name="vehicleId" value={selectedVehicleId} onChange={(event) => setDraftSelection((current) => ({ ...current, vehicleId: event.target.value }))} disabled={lockLoadedSlipDetails} required><option value="">Select vehicle</option>{data.vehicles.map((item) => <option key={item.id} value={item.id}>{item.vehicleNo}</option>)}</select><button className="quick-add-button" type="button" onClick={() => setQuickAddKind("vehicle")} disabled={lockLoadedSlipDetails || !can(data.user, "MANAGE_VEHICLES")} title="Quick add vehicle">+</button></span></label>
              <label className="field quick-add-field">Customer<span className="quick-add-control"><select name="partyId" value={selectedPartyId} onChange={(event) => setDraftSelection((current) => ({ ...current, partyId: event.target.value }))} disabled={lockLoadedSlipDetails} required><option value="">Select customer</option>{data.parties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="quick-add-button" type="button" onClick={() => setQuickAddKind("party")} disabled={lockLoadedSlipDetails || !can(data.user, "MANAGE_PARTIES")} title="Quick add customer">+</button></span></label>
              <label className="field">Transporter<input name="transporter" defaultValue={activeSlip?.transporter || ""} disabled={lockLoadedSlipDetails} /></label>
              <label className="field quick-add-field">Driver Name<span className="quick-add-control"><select name="driverId" value={selectedDriverId} onChange={(event) => setDraftSelection((current) => ({ ...current, driverId: event.target.value }))} disabled={lockLoadedSlipDetails} required><option value="">Select driver</option>{data.drivers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="quick-add-button" type="button" onClick={() => setQuickAddKind("driver")} disabled={lockLoadedSlipDetails || !can(data.user, "MANAGE_DRIVERS")} title="Quick add driver">+</button></span></label>
              <label className="field">Driver ID<input name="driverIdentity" defaultValue={activeSlip?.driverIdentity || ""} disabled={lockLoadedSlipDetails} /></label>
              <label className="field">{locationLabel}<input name="destination" defaultValue={activeSlip?.destination || ""} disabled={lockLoadedSlipDetails} /></label>
            </div>
            {!activeSlip && selectedVehicleId && (vehicleOpenSlips.length > 0 || vehicleCompletedSlips.length > 0) && (
              <div className="vehicle-slip-history">
                {vehicleOpenSlips.length > 0 && (
                  <section>
                    <h3>Open slips for this vehicle</h3>
                    <div className="vehicle-slip-list">
                      {vehicleOpenSlips.map((transaction) => (
                        <article className="vehicle-slip-row is-open" key={transaction.id}>
                          <div>
                            <strong>{transaction.transactionNo}</strong>
                            <span>{transaction.partyName} | {transaction.driverName} | {transaction.movementType === "OUTBOUND" ? "Outbound" : "Inbound"}</span>
                            <small>{transaction.firstWeight != null ? `1st Weight ${fmtWeight(transaction.firstWeight)}` : "Waiting for 1st weight"} | {fmtDate(transaction.createdAt)}</small>
                          </div>
                          <button className="btn-secondary" type="button" onClick={() => continueSlip(transaction)}>Continue Slip</button>
                        </article>
                      ))}
                    </div>
                  </section>
                )}
                {vehicleCompletedSlips.length > 0 && (
                  <section>
                    <h3>Recent completed history</h3>
                    <div className="vehicle-slip-list">
                      {vehicleCompletedSlips.map((transaction) => (
                        <article className="vehicle-slip-row" key={transaction.id}>
                          <div>
                            <strong>{transaction.transactionNo}</strong>
                            <span>{transaction.partyName} | {transaction.driverName} | {transaction.movementType === "OUTBOUND" ? "Outbound" : "Inbound"}</span>
                            <small>Net {fmtWeight(transaction.netWeight)} | {fmtDate(transaction.createdAt)}</small>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </article>
        </section>

        <section className="weighbridge-column weight-column">
          <article className="wb-card digital-card">
            <h2>Weight & Materials</h2>
            <LiveWeight reading={{ ...liveWeight, weight: shownWeight }} compact />
            <div className="weight-tools">
              <button className="btn-primary" type="button" onClick={captureWeight} disabled={!liveWeight.stable || isCompletedSlip}>Capture Weight</button>
              <button className="btn-secondary" type="button" onClick={() => {
                if (livePaused) {
                  setLivePaused(false);
                  setPausedWeight(null);
                } else {
                  setPausedWeight(liveWeight.weight);
                  setLivePaused(true);
                }
              }}>{livePaused ? "Resume Live Reading" : "Pause Live Reading"}</button>
              {data.settings?.slipManualCameraCaptureEnabled && (
                <button className="btn-secondary" type="button" onClick={captureCamera} disabled={!activeSlip || isCompletedSlip}>Camera Capture</button>
              )}
            </div>
            <p className={`captured-weight-note ${capturedWeight ? "is-captured" : ""}`}>{capturedWeight ? `Captured: ${fmtIndicatorWeight(capturedWeight.weight)} at ${fmtDate(capturedWeight.capturedAt)}` : "No weight captured for the next action"}</p>
          </article>

          <article className="wb-card weight-row-card">
            <label className="field field-muted">1st Weight<input value={fmtWeight(activeSlip?.firstWeight ?? pendingFirstWeight?.weight)} readOnly /></label>
            <label className="field field-muted">1st Weight Date<input value={activeSlip?.firstWeighedAt ? fmtDate(activeSlip.firstWeighedAt) : pendingFirstWeight ? fmtDate(pendingFirstWeight.capturedAt) : "-"} readOnly /></label>
          </article>
          <article className="wb-card weight-row-card">
            <label className="field field-muted">2nd Weight<input value={fmtWeight(activeSlip?.finalWeight)} readOnly /></label>
            <label className="field field-muted">2nd Weight Date<input value={activeSlip?.finalWeighedAt ? fmtDate(activeSlip.finalWeighedAt) : "-"} readOnly /></label>
          </article>
          <article className="wb-card weight-row-card">
            <label className="field field-muted weight-field-net">Net Weight<input value={fmtWeight(displayedNetWeight)} readOnly /></label>
            <div className="weight-row-spacer" aria-hidden="true" />
          </article>

          <article className="wb-card material-card">
            <div className="wb-card-head">
              <h2>Material/Product</h2>
              <button className="btn-secondary" type="button" onClick={captureProduct} disabled={lockProductEntry || !canAddIntermediateProduct || !can(data.user, "CAPTURE_PRODUCT_WEIGHT")}>Add Product Line</button>
            </div>
            <div className="product-line-form">
              <label className="field">Material/Product<select value={productDraft.productId} onChange={(event) => {
                const product = data.products.find((item) => item.id === event.target.value);
                setProductDraft((current) => ({ ...current, productId: event.target.value, unit: product?.unit || "" }));
              }} disabled={lockProductEntry}><option value="">Select product</option>{data.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="field">Pkgs<input type="number" value={productDraft.packageCount} onChange={(event) => setProductDraft((current) => ({ ...current, packageCount: Number(event.target.value) }))} disabled={lockProductEntry} /></label>
              <label className="field">Unit<input value={productDraft.unit || selectedProduct?.unit || "kg"} onChange={(event) => setProductDraft((current) => ({ ...current, unit: event.target.value }))} disabled={lockProductEntry} /></label>
              <label className="field">Tare<input type="number" value={productDraft.tareWeight} onChange={(event) => setProductDraft((current) => ({ ...current, tareWeight: Number(event.target.value) }))} disabled={lockProductEntry} /></label>
              <label className="field">Packing Tare<input type="number" value={productDraft.packingTare} onChange={(event) => setProductDraft((current) => ({ ...current, packingTare: Number(event.target.value) }))} disabled={lockProductEntry} /></label>
            </div>
            <div className="compact-table-wrap">
              <table className="mini-table">
                <colgroup>
                  <col className="col-seq" />
                  <col className="col-product" />
                  <col className="col-pkgs" />
                  <col className="col-gross" />
                  <col className="col-product-weight" />
                  <col className="col-unit" />
                </colgroup>
                <thead><tr><th>#</th><th>Product</th><th>Pkgs</th><th>Gross/Inter.</th><th>Product Wt.</th><th>Unit</th></tr></thead>
                <tbody>
                  {(activeSlip?.productEntries || []).map((entry) => (
                    <tr key={entry.id}><td>{entry.sequence}</td><td>{entry.productName}</td><td>{entry.packageCount}</td><td>{fmtWeight(entry.grossWeight)}</td><td>{fmtWeight(entry.productWeight)}</td><td>{entry.unit}</td></tr>
                  ))}
                  {!activeSlip?.productEntries.length && <tr><td colSpan={6}>No product lines captured yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </article>
          {createError && (
            <div className="slip-action-error" role="alert">
              <span>{createError}</span>
              <button type="button" onClick={() => setCreateError("")}>Cancel</button>
            </div>
          )}
        </section>

        <aside className="wb-card cctv-card">
          <h2>Live CCTV Monitoring</h2>
          <CameraWall cameras={slipCameras(data.settings)} large />
        </aside>
      </form>
    </section>
    {quickAddKind && <QuickAddModal kind={quickAddKind} saving={quickAddSaving} onClose={() => setQuickAddKind(null)} onSubmit={quickAdd} />}
    </>
  );
}

function QuickAddModal({ kind, saving, onClose, onSubmit }: { kind: QuickAddKind; saving: boolean; onClose: () => void; onSubmit: (kind: QuickAddKind, values: Record<string, string>) => Promise<void> }) {
  const title = kind === "vehicle" ? "Quick Add Vehicle" : kind === "party" ? "Quick Add Customer" : "Quick Add Driver";
  const fieldName = kind === "vehicle" ? "vehicleNo" : "name";
  const fieldLabel = kind === "vehicle" ? "Vehicle No" : kind === "party" ? "Customer Name" : "Driver Name";
  const placeholder = kind === "vehicle" ? "e.g. KAA123A" : kind === "party" ? "Customer name" : "Driver name";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    await onSubmit(kind, formObject(form));
  };

  return (
    <div className="quick-add-modal-backdrop" onMouseDown={onClose}>
      <section className="quick-add-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <span>Quick Add</span>
          <h2>{title}</h2>
        </header>
        <form onSubmit={submit}>
          <label className="field">{fieldLabel}<input name={fieldName} placeholder={placeholder} required autoFocus /></label>
          <div className="quick-add-modal-actions">
            <button className="btn-secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn-primary" type="submit" disabled={saving}>{saving ? "Adding..." : "Add and Select"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function CameraWall({ cameras, large = false }: { cameras: CameraSetting[]; large?: boolean }) {
  const [refreshKey, setRefreshKey] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setRefreshKey(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  if (cameras.length === 0) {
    return (
      <div className="mb-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm font-medium text-slate-500">
        No cameras configured.
      </div>
    );
  }

  return (
    <div className={large ? "camera-live-wall" : "mb-4"}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium uppercase text-slate-600">Slip Cameras</h4>
        <span className="text-xs font-medium text-slate-500">{large ? `${cameras.length} cams` : `${cameras.length} configured`}</span>
      </div>
      <div className={large ? "camera-live-grid" : "grid grid-cols-3 gap-2 max-sm:grid-cols-1"}>
        {cameras.map((camera) => (
          <figure className="overflow-hidden rounded-md border border-slate-200 bg-slate-950" key={camera.id}>
            <img
              className="aspect-video w-full object-cover"
              src={`/api/cameras/${camera.id}/preview.svg?refresh=${refreshKey}`}
              alt={`${camera.name} ${camera.position} camera preview`}
            />
            <figcaption className="grid gap-0.5 px-2 py-1 text-[11px] font-medium text-white">
              <span className="truncate">{camera.name}</span>
              <span className="text-teal-100">{camera.position}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="mt-2 text-xs font-medium text-slate-500">Images are captured automatically during first weigh and final weigh.</p>
    </div>
  );
}

function CapturedCameraStrip({ images }: { images: CameraImage[] }) {
  return (
    <div className="mt-4">
      <h4 className="mb-2 text-xs font-medium uppercase text-slate-500">Captured Images</h4>
      <div className="grid grid-cols-3 gap-2 max-lg:grid-cols-2 max-sm:grid-cols-1">
        {images.map((image) => (
          <figure className="overflow-hidden rounded-md border border-slate-200 bg-white" key={image.id}>
            <img className="aspect-video w-full object-cover" src={image.imageUrl} alt={`${image.cameraName} ${image.weighmentType} capture`} />
            <figcaption className="px-2 py-1 text-xs font-medium text-slate-600">
              {image.cameraName} | {image.weighmentType}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function MasterModule({ title, endpoint, fields, rows, primary, onRefresh, disabled }: { title: string; endpoint: string; fields: string[]; rows: Array<Record<string, string>>; primary: string; onRefresh: () => Promise<void>; disabled: boolean }) {
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage("");
    setMessageTone("success");
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify(formObject(form)) });
      form.reset();
      await onRefresh();
      setMessage("Record created successfully");
      setMessageTone("success");
    } catch (err) {
      setMessage(errorMessage(err, "Could not create record"));
      setMessageTone("error");
    }
  };
  return (
    <section className="grid gap-5">
      <Header eyebrow="Master" title={title} />
      <section className="panel">
        <form className="grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1" onSubmit={submit}>
          {fields.map((field) => field === "type" ? (
            <label className="field" key={field}>{field}<select name={field}><option>CUSTOMER</option><option>SUPPLIER</option></select></label>
          ) : (
            <label className="field" key={field}>{field}<input name={field} required={field === primary || field === "name"} /></label>
          ))}
          <button className="btn-primary self-end" disabled={disabled}>Save</button>
        </form>
        {message && <p className={`mt-3 text-sm font-medium ${messageTone === "success" ? "text-teal-700" : "text-red-700"}`}>{message}</p>}
      </section>
      <section className="panel overflow-auto">
        <table className="data-table"><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row[primary]}</strong></td>{fields.filter((field) => field !== primary).map((field) => <td key={field}>{row[field]}</td>)}</tr>)}</tbody></table>
      </section>
    </section>
  );
}

function Reports() {
  const reports = ["daily", "vehicle", "product", "customer", "operator", "reprinted", "cancelled", "edited", "date-range"];
  return (
    <section className="grid gap-5">
      <Header eyebrow="Exports" title="Reports" />
      <section className="panel grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
        {reports.map((report) => (
          <div className="rounded-md border border-slate-200 p-4" key={report}>
            <strong className="capitalize">{report.replaceAll("-", " ")} report</strong>
            <div className="mt-3 flex gap-2">
              {["csv", "excel", "pdf"].map((format) => <a className="btn-secondary text-center" key={format} href={`/api/reports/${report}/export?format=${format}`}>{format.toUpperCase()}</a>)}
            </div>
          </div>
        ))}
      </section>
    </section>
  );
}

function AuditLogs() {
  const [logs, setLogs] = useState<Array<Record<string, string>>>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    api<Array<Record<string, string>>>("/api/audit-logs")
      .then((rows) => {
        setLogs(rows);
        setMessage("");
      })
      .catch((err) => setMessage(errorMessage(err, "Could not load audit logs")));
  }, []);
  return (
    <section className="grid gap-5">
      <Header eyebrow="Security" title="Audit Logs" />
      {message && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{message}</p>}
      <section className="panel overflow-auto">
        <table className="data-table">
          <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
          <tbody>{logs.map((log) => <tr key={log.id}><td>{fmtDate(log.createdAt)}</td><td>{log.userName}</td><td>{log.action}</td><td>{log.entityType}</td><td>{log.details}</td></tr>)}</tbody>
        </table>
      </section>
    </section>
  );
}

function Users({ disabled }: { disabled: boolean }) {
  const [users, setUsers] = useState<User[]>([]);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [creatingUser, setCreatingUser] = useState(false);
  useEffect(() => {
    api<User[]>("/api/users")
      .then((rows) => {
        setUsers(rows);
        setMessage("");
      })
      .catch((err) => {
        setMessage(errorMessage(err, "Could not load users"));
        setMessageTone("error");
      });
  }, []);
  return (
    <section className="grid gap-5">
      <Header eyebrow="Access" title="Users and Roles" />
      <section className="panel">
        <form className="grid grid-cols-5 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1" onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          setMessage("");
          setMessageTone("success");
          setCreatingUser(true);
          try {
            await api("/api/users", { method: "POST", body: JSON.stringify(formObject(form)) });
            setUsers(await api<User[]>("/api/users"));
            form.reset();
            setMessage("User created successfully");
            setMessageTone("success");
          } catch (err) {
            setMessage(errorMessage(err, "Could not create user"));
            setMessageTone("error");
          } finally {
            setCreatingUser(false);
          }
        }}>
          <label className="field">Name<input name="name" required /></label>
          <label className="field">Username<input name="username" required /></label>
          <label className="field">Password<input name="password" type="password" required autoComplete="new-password" /></label>
          <label className="field">Role<select name="role"><option>ADMIN</option><option>WEIGHBRIDGE_OPERATOR</option><option>ACCOUNTS</option><option>STORE_DISPATCH</option><option>VIEWER</option></select></label>
          <button className="btn-primary self-end" disabled={disabled || creatingUser}>{creatingUser ? "Creating..." : "Create"}</button>
          <p className={`col-span-5 min-h-5 text-sm font-medium max-xl:col-span-2 max-sm:col-span-1 ${messageTone === "success" ? "text-teal-700" : "text-red-700"}`}>
            {message || "Password must include uppercase, lowercase, number, symbol, and at least 8 characters."}
          </p>
        </form>
      </section>
      <section className="panel overflow-auto">
        <table className="data-table"><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.name}</strong></td><td>{user.username}</td><td>{user.role.replaceAll("_", " ")}</td></tr>)}</tbody></table>
      </section>
    </section>
  );
}

function settingsWeighbridges(settings: Settings): WeighbridgeSetting[] {
  if (settings.weighbridges?.length) {
    return [...settings.weighbridges].sort((left, right) => left.displayOrder - right.displayOrder);
  }
  return [{
    id: "wb-main",
    name: "Main Weighbridge",
    location: settings.siteName,
    active: true,
    displayOrder: 1,
    connectionType: String(settings.device.connectionType || "simulator") as WeighbridgeSetting["connectionType"],
    comPort: String(settings.device.comPort || ""),
    baudRate: Number(settings.device.baudRate || 9600),
    dataBits: Number(settings.device.dataBits || 8),
    stopBits: Number(settings.device.stopBits || 1),
    parity: String(settings.device.parity || "none"),
    tcpHost: String(settings.device.tcpHost || ""),
    tcpPort: Number(settings.device.tcpPort || 4001),
    weightFormat: String(settings.device.weightFormat || ""),
    stableDetection: Boolean(settings.device.stableDetection)
  }];
}

function Settings({ settings, disabled, onRefresh }: { settings: Settings; disabled: boolean; onRefresh: () => Promise<void> }) {
  const [weighbridges, setWeighbridges] = useState<WeighbridgeSetting[]>(() => settingsWeighbridges(settings));
  const [expandedWeighbridgeIds, setExpandedWeighbridgeIds] = useState<string[]>([]);
  const [cameras, setCameras] = useState<CameraSetting[]>(() => [...settings.cameras].sort((left, right) => left.displayOrder - right.displayOrder));
  const [expandedCameraIds, setExpandedCameraIds] = useState<string[]>([]);
  const [manualCameraCaptureEnabled, setManualCameraCaptureEnabled] = useState(Boolean(settings.slipManualCameraCaptureEnabled));
  const [slipNumberMode, setSlipNumberMode] = useState<Settings["slipNumberMode"]>(settings.slipNumberMode || "PREVIEW");
  const [weighbridgeNodeVisible, setWeighbridgeNodeVisible] = useState(Boolean(settings.slipWeighbridgeNodeVisible));
  const [shiftVisible, setShiftVisible] = useState(Boolean(settings.slipShiftVisible));
  const [selectVehicleVisible, setSelectVehicleVisible] = useState(Boolean(settings.slipSelectVehicleVisible));
  const [searchControlsVisible, setSearchControlsVisible] = useState(Boolean(settings.slipSearchControlsVisible));
  const [collapsedSettingsSections, setCollapsedSettingsSections] = useState({
    slipEntry: true,
    weighbridge: true,
    cameras: true
  });
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    setWeighbridges(settingsWeighbridges(settings));
    setCameras([...settings.cameras].sort((left, right) => left.displayOrder - right.displayOrder));
    setManualCameraCaptureEnabled(Boolean(settings.slipManualCameraCaptureEnabled));
    setSlipNumberMode(settings.slipNumberMode || "PREVIEW");
    setWeighbridgeNodeVisible(Boolean(settings.slipWeighbridgeNodeVisible));
    setShiftVisible(Boolean(settings.slipShiftVisible));
    setSelectVehicleVisible(Boolean(settings.slipSelectVehicleVisible));
    setSearchControlsVisible(Boolean(settings.slipSearchControlsVisible));
  }, [settings]);

  const updateWeighbridge = (id: string, changes: Partial<WeighbridgeSetting>) => {
    setWeighbridges((current) => current.map((weighbridge) => weighbridge.id === id ? { ...weighbridge, ...changes } : weighbridge));
  };

  const reorderWeighbridge = (id: string, direction: -1 | 1) => {
    setWeighbridges((current) => {
      const next = [...current].sort((left, right) => left.displayOrder - right.displayOrder);
      const index = next.findIndex((weighbridge) => weighbridge.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((weighbridge, orderIndex) => ({ ...weighbridge, displayOrder: orderIndex + 1 }));
    });
  };

  const addWeighbridge = () => {
    const id = `wb-${Date.now()}`;
    const template = weighbridges[0] || settingsWeighbridges(settings)[0];
    setWeighbridges((current) => [
      ...current,
      {
        ...template,
        id,
        name: `Weighbridge ${current.length + 1}`,
        location: settings.siteName,
        active: false,
        displayOrder: current.length + 1
      }
    ]);
    setExpandedWeighbridgeIds((current) => [...current, id]);
  };

  const deleteWeighbridge = (id: string) => {
    setWeighbridges((current) => current.filter((weighbridge) => weighbridge.id !== id).map((weighbridge, index) => ({ ...weighbridge, displayOrder: index + 1 })));
    setExpandedWeighbridgeIds((current) => current.filter((weighbridgeId) => weighbridgeId !== id));
  };

  const toggleWeighbridge = (id: string) => {
    setExpandedWeighbridgeIds((current) => current.includes(id) ? current.filter((weighbridgeId) => weighbridgeId !== id) : [...current, id]);
  };

  const updateCamera = (id: string, changes: Partial<CameraSetting>) => {
    setCameras((current) => current.map((camera) => camera.id === id ? { ...camera, ...changes } : camera));
  };

  const reorderCamera = (id: string, direction: -1 | 1) => {
    setCameras((current) => {
      const next = [...current].sort((left, right) => left.displayOrder - right.displayOrder);
      const index = next.findIndex((camera) => camera.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((camera, orderIndex) => ({ ...camera, displayOrder: orderIndex + 1 }));
    });
  };

  const addCamera = () => {
    const id = `cam-${Date.now()}`;
    setCameras((current) => [
      ...current,
      {
        id,
        name: `Camera ${current.length + 1}`,
        classification: "Weighbridge slip",
        position: "FRONT",
        rtspUrl: "",
        username: "",
        password: "",
        captureTiming: "BOTH",
        displayOnSlip: true,
        displayOrder: current.length + 1,
        active: true
      }
    ]);
    setExpandedCameraIds((current) => [...current, id]);
  };

  const deleteCamera = (id: string) => {
    setCameras((current) => current.filter((camera) => camera.id !== id).map((camera, index) => ({ ...camera, displayOrder: index + 1 })));
    setExpandedCameraIds((current) => current.filter((cameraId) => cameraId !== id));
  };

  const toggleCamera = (id: string) => {
    setExpandedCameraIds((current) => current.includes(id) ? current.filter((cameraId) => cameraId !== id) : [...current, id]);
  };

  const toggleSettingsSection = (section: keyof typeof collapsedSettingsSections) => {
    setCollapsedSettingsSections((current) => ({ ...current, [section]: !current[section] }));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage("");
    setMessageTone("success");
    const orderedWeighbridges = weighbridges.map((weighbridge, index) => ({ ...weighbridge, displayOrder: index + 1 }));
    const orderedCameras = cameras.map((camera, index) => ({ ...camera, displayOrder: index + 1 }));
    setSavingSettings(true);
    try {
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          ...formObject(form),
          slipNumberMode,
          slipManualCameraCaptureEnabled: manualCameraCaptureEnabled,
          slipWeighbridgeNodeVisible: weighbridgeNodeVisible,
          slipShiftVisible: shiftVisible,
          slipSelectVehicleVisible: selectVehicleVisible,
          slipSearchControlsVisible: searchControlsVisible,
          weighbridges: orderedWeighbridges,
          cameras: orderedCameras
        })
      });
      setMessage("Settings saved");
      setMessageTone("success");
      await onRefresh();
      setCollapsedSettingsSections({
        slipEntry: true,
        weighbridge: true,
        cameras: true
      });
      setExpandedWeighbridgeIds([]);
      setExpandedCameraIds([]);
    } catch (error) {
      setMessage(errorMessage(error, "Could not save settings"));
      setMessageTone("error");
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <section className="grid gap-5">
      <Header eyebrow="Configuration" title="System Settings" />
      <section className="panel">
        <form className="grid gap-5" onSubmit={save}>
          <div>
            <h3 className="section-title">Company</h3>
            <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
              <label className="field">Company name<input name="companyName" defaultValue={settings.companyName} /></label>
              <label className="field">Site name<input name="siteName" defaultValue={settings.siteName} /></label>
              <label className="field">Logo URL<input name="logoUrl" defaultValue={settings.logoUrl} /></label>
            </div>
          </div>

          <div className="settings-section-card">
            <button className="settings-section-header" type="button" onClick={() => toggleSettingsSection("slipEntry")} aria-expanded={!collapsedSettingsSections.slipEntry}>
              <span>
                <h3 className="section-title mb-0">Slip Entry Options</h3>
                <span className="settings-section-summary">Optional fields and camera controls shown on Slip Entry</span>
              </span>
              <span className="settings-section-state">{collapsedSettingsSections.slipEntry ? "Open" : "Close"}</span>
            </button>
            {!collapsedSettingsSections.slipEntry && (
              <div className="mt-3 flex flex-wrap gap-2">
                <label className="field min-w-64 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                  Slip number mode
                  <select value={slipNumberMode} onChange={(event) => setSlipNumberMode(event.target.value as Settings["slipNumberMode"])}>
                    <option value="PREVIEW">Preview only</option>
                    <option value="RESERVE">Reserve on New Slip</option>
                  </select>
                </label>
                <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={manualCameraCaptureEnabled}
                    onChange={(event) => setManualCameraCaptureEnabled(event.target.checked)}
                  />
                  Show manual Camera Capture button on Slip Entry
                </label>
                <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={weighbridgeNodeVisible}
                    onChange={(event) => setWeighbridgeNodeVisible(event.target.checked)}
                  />
                  Show current weighbridge node on Slip Entry
                </label>
                <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={shiftVisible}
                    onChange={(event) => setShiftVisible(event.target.checked)}
                  />
                  Show shift on Slip Entry
                </label>
                <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectVehicleVisible}
                    onChange={(event) => setSelectVehicleVisible(event.target.checked)}
                  />
                  Show vehicle number in Select Slip
                </label>
                <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={searchControlsVisible}
                    onChange={(event) => setSearchControlsVisible(event.target.checked)}
                  />
                  Show Exit and Search controls on Slip Entry
                </label>
              </div>
            )}
          </div>

          <div className="settings-section-card">
            <div className={`flex items-center justify-between gap-3 ${collapsedSettingsSections.weighbridge ? "" : "mb-3"}`}>
              <button className="settings-section-header flex-1" type="button" onClick={() => toggleSettingsSection("weighbridge")} aria-expanded={!collapsedSettingsSections.weighbridge}>
                <span>
                  <h3 className="section-title mb-0">Weighbridge Display Settings</h3>
                  <span className="settings-section-summary">{weighbridges.length} weighbridge{weighbridges.length === 1 ? "" : "s"} configured</span>
                </span>
                <span className="settings-section-state">{collapsedSettingsSections.weighbridge ? "Open" : "Close"}</span>
              </button>
              {!collapsedSettingsSections.weighbridge && (
                <div className="flex flex-wrap justify-end gap-2">
                  <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={() => setExpandedWeighbridgeIds(weighbridges.map((weighbridge) => weighbridge.id))} disabled={weighbridges.length === 0}>Expand All</button>
                  <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={() => setExpandedWeighbridgeIds([])} disabled={weighbridges.length === 0}>Collapse All</button>
                  <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={addWeighbridge} disabled={disabled}>Add Weighbridge</button>
                </div>
              )}
            </div>
            {!collapsedSettingsSections.weighbridge && <div className="grid gap-3">
              {weighbridges.map((weighbridge, index) => (
                <article className="collapsible-setting-card" key={weighbridge.id}>
                  <div className="setting-card-summary">
                    <button className="camera-card-toggle" type="button" onClick={() => toggleWeighbridge(weighbridge.id)} aria-expanded={expandedWeighbridgeIds.includes(weighbridge.id)}>
                      <strong>{index + 1}. {weighbridge.name || "Weighbridge"}</strong>
                      <span>
                        {weighbridge.location || "No location"} | {weighbridge.connectionType.toUpperCase()} | COM {weighbridge.comPort || "-"} | TCP {weighbridge.tcpHost || "-"}:{weighbridge.tcpPort || "-"}
                      </span>
                    </button>
                    <div className="camera-card-badges">
                      <span className={weighbridge.active ? "badge-on" : "badge-off"}>{weighbridge.active ? "Active" : "Disabled"}</span>
                      <span className={weighbridge.stableDetection ? "badge-on" : "badge-off"}>{weighbridge.stableDetection ? "Stable detect" : "No stable detect"}</span>
                      <span className="badge-on">{weighbridge.baudRate || 9600} baud</span>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={() => toggleWeighbridge(weighbridge.id)}>{expandedWeighbridgeIds.includes(weighbridge.id) ? "Close" : "Edit"}</button>
                      <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={() => reorderWeighbridge(weighbridge.id, -1)} disabled={disabled || index === 0}>Up</button>
                      <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={() => reorderWeighbridge(weighbridge.id, 1)} disabled={disabled || index === weighbridges.length - 1}>Down</button>
                      <button className="btn-danger min-h-8 px-3 py-1 text-sm" type="button" onClick={() => deleteWeighbridge(weighbridge.id)} disabled={disabled || weighbridges.length === 1}>Delete</button>
                    </div>
                  </div>
                  {expandedWeighbridgeIds.includes(weighbridge.id) && (
                    <>
                      <div className="mt-3 grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
                        <label className="field">Weighbridge name<input value={weighbridge.name} onChange={(event) => updateWeighbridge(weighbridge.id, { name: event.target.value })} /></label>
                        <label className="field">Location<input value={weighbridge.location} onChange={(event) => updateWeighbridge(weighbridge.id, { location: event.target.value })} /></label>
                        <label className="field">Setup type<select value={weighbridge.connectionType} onChange={(event) => updateWeighbridge(weighbridge.id, { connectionType: event.target.value as WeighbridgeSetting["connectionType"] })}><option value="serial">COM port</option><option value="tcp">IP address</option><option value="simulator">Simulator</option></select></label>
                        {weighbridge.connectionType === "serial" && (
                          <>
                            <label className="field">COM port<input value={weighbridge.comPort} onChange={(event) => updateWeighbridge(weighbridge.id, { comPort: event.target.value })} /></label>
                            <label className="field">Baud rate<input type="number" value={weighbridge.baudRate} onChange={(event) => updateWeighbridge(weighbridge.id, { baudRate: Number(event.target.value) })} /></label>
                            <label className="field">Data bits<input type="number" value={weighbridge.dataBits} onChange={(event) => updateWeighbridge(weighbridge.id, { dataBits: Number(event.target.value) })} /></label>
                            <label className="field">Stop bits<input type="number" value={weighbridge.stopBits} onChange={(event) => updateWeighbridge(weighbridge.id, { stopBits: Number(event.target.value) })} /></label>
                            <label className="field">Parity<input value={weighbridge.parity} onChange={(event) => updateWeighbridge(weighbridge.id, { parity: event.target.value })} /></label>
                          </>
                        )}
                        {weighbridge.connectionType === "tcp" && (
                          <>
                            <label className="field">IP address<input value={weighbridge.tcpHost} onChange={(event) => updateWeighbridge(weighbridge.id, { tcpHost: event.target.value })} /></label>
                            <label className="field">TCP port<input type="number" value={weighbridge.tcpPort} onChange={(event) => updateWeighbridge(weighbridge.id, { tcpPort: Number(event.target.value) })} /></label>
                          </>
                        )}
                        <label className="field md:col-span-2">Weight parsing format<input value={weighbridge.weightFormat} onChange={(event) => updateWeighbridge(weighbridge.id, { weightFormat: event.target.value })} /></label>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-700">
                        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={weighbridge.active} onChange={(event) => updateWeighbridge(weighbridge.id, { active: event.target.checked })} /> Weighbridge active</label>
                        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={weighbridge.stableDetection} onChange={(event) => updateWeighbridge(weighbridge.id, { stableDetection: event.target.checked })} /> Stable weight detection</label>
                      </div>
                    </>
                  )}
                </article>
              ))}
            </div>}
          </div>

          <div className="settings-section-card">
            <div className={`flex items-center justify-between gap-3 ${collapsedSettingsSections.cameras ? "" : "mb-3"}`}>
              <button className="settings-section-header flex-1" type="button" onClick={() => toggleSettingsSection("cameras")} aria-expanded={!collapsedSettingsSections.cameras}>
                <span>
                  <h3 className="section-title mb-0">Camera Settings</h3>
                  <span className="settings-section-summary">{cameras.length} camera{cameras.length === 1 ? "" : "s"} configured for slip display and capture</span>
                </span>
                <span className="settings-section-state">{collapsedSettingsSections.cameras ? "Open" : "Close"}</span>
              </button>
              {!collapsedSettingsSections.cameras && (
                <div className="flex flex-wrap justify-end gap-2">
                  <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={() => setExpandedCameraIds(cameras.map((camera) => camera.id))} disabled={cameras.length === 0}>Expand All</button>
                  <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={() => setExpandedCameraIds([])} disabled={cameras.length === 0}>Collapse All</button>
                  <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={addCamera} disabled={disabled}>Add Camera</button>
                </div>
              )}
            </div>
            {!collapsedSettingsSections.cameras && <div className="grid gap-3">
              {cameras.map((camera, index) => (
                <article className="camera-setting-card" key={camera.id}>
                  <div className="camera-card-summary">
                    <button className="camera-card-toggle" type="button" onClick={() => toggleCamera(camera.id)} aria-expanded={expandedCameraIds.includes(camera.id)}>
                      <strong>{index + 1}. {camera.name || "Camera"}</strong>
                      <span>{camera.classification || "Unclassified"} | {camera.position} | order {camera.displayOrder}</span>
                    </button>
                    <div className="camera-card-badges">
                      <span className={camera.active ? "badge-on" : "badge-off"}>{camera.active ? "Active" : "Inactive"}</span>
                      <span className={camera.displayOnSlip ? "badge-on" : "badge-off"}>{camera.displayOnSlip ? "On slip" : "Hidden"}</span>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={() => toggleCamera(camera.id)}>{expandedCameraIds.includes(camera.id) ? "Close" : "Edit"}</button>
                      <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={() => reorderCamera(camera.id, -1)} disabled={disabled || index === 0}>Up</button>
                      <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={() => reorderCamera(camera.id, 1)} disabled={disabled || index === cameras.length - 1}>Down</button>
                      <button className="btn-danger min-h-8 px-3 py-1 text-sm" type="button" onClick={() => deleteCamera(camera.id)} disabled={disabled}>Delete</button>
                    </div>
                  </div>
                  {expandedCameraIds.includes(camera.id) && (
                    <>
                      <div className="mt-3 grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
                        <label className="field">Camera name<input value={camera.name} onChange={(event) => updateCamera(camera.id, { name: event.target.value })} /></label>
                        <label className="field">Classification<select value={camera.classification} onChange={(event) => updateCamera(camera.id, { classification: event.target.value })}><option>Weighbridge slip</option><option>Gate entry</option><option>Yard security</option><option>Dispatch bay</option><option>Other</option></select></label>
                        <label className="field">Position<select value={camera.position} onChange={(event) => updateCamera(camera.id, { position: event.target.value as CameraPosition })}><option value="FRONT">Front</option><option value="REAR">Rear</option><option value="SIDE">Side</option></select></label>
                        <label className="field">Capture timing<select value={camera.captureTiming} onChange={(event) => updateCamera(camera.id, { captureTiming: event.target.value as CameraSetting["captureTiming"] })}><option value="BOTH">First and final</option><option value="FIRST">First only</option><option value="FINAL">Final only</option></select></label>
                        <label className="field md:col-span-2">IP address / RTSP URL<input value={camera.rtspUrl} onChange={(event) => updateCamera(camera.id, { rtspUrl: event.target.value })} /></label>
                        <label className="field">Username<input value={camera.username} onChange={(event) => updateCamera(camera.id, { username: event.target.value })} /></label>
                        <label className="field">Password<input value={camera.password} type="password" onChange={(event) => updateCamera(camera.id, { password: event.target.value })} /></label>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-700">
                        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={camera.active} onChange={(event) => updateCamera(camera.id, { active: event.target.checked })} /> Camera active</label>
                        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={camera.displayOnSlip} onChange={(event) => updateCamera(camera.id, { displayOnSlip: event.target.checked })} /> Display and capture on Weighbridge Slip</label>
                      </div>
                    </>
                  )}
                </article>
              ))}
              {cameras.length === 0 && <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">No cameras configured. Add a camera to show it on the slip screen.</p>}
            </div>}
          </div>

          <div className="flex items-center gap-3">
            <button className="btn-primary" type="submit" disabled={disabled || savingSettings}>{savingSettings ? "Saving..." : "Save Settings"}</button>
            {message && <span className={`text-sm font-medium ${messageTone === "success" ? "text-teal-700" : "text-red-700"}`}>{message}</span>}
          </div>
        </form>
      </section>
    </section>
  );
}

function SlipModal({ transaction, settings, onClose, onToast }: { transaction: Transaction; settings: Settings; onClose: () => void; onToast: (message: string) => void }) {
  const cameraOrder = new Map(settings.cameras.map((camera) => [camera.id, camera.displayOrder]));
  const cameraImages = [...transaction.cameraImages].sort((left, right) => (cameraOrder.get(left.cameraId) || 99) - (cameraOrder.get(right.cameraId) || 99));
  const firstCameraImages = cameraImages.filter((image) => image.weighmentType === "FIRST");
  const finalCameraImages = cameraImages.filter((image) => image.weighmentType === "FINAL");
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  const reprint = async () => {
    try {
      await api(`/api/transactions/${transaction.id}/reprint`, { method: "POST" });
      window.print();
      onToast("Reprint logged");
    } catch (err) {
      onToast(errorMessage(err, "Could not reprint slip"));
    }
  };
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-slate-950/60 p-4" onMouseDown={onClose}>
      <section className="relative max-h-[92vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-5 shadow-2xl print:max-h-none print:overflow-visible print:shadow-none" onMouseDown={(event) => event.stopPropagation()}>
        <button
          aria-label="Close slip preview"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-md border border-slate-300 bg-white text-xl leading-none text-slate-700 hover:border-teal-700 hover:text-teal-800 print:hidden"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
        <div className="print-area font-mono text-sm">
          <h2 className="text-center text-xl font-semibold">{settings.companyName}</h2>
          <p className="text-center">{settings.siteName}</p>
          <SlipLine label="Slip No." value={transaction.transactionNo} />
          <SlipLine label="Vehicle" value={transaction.vehicleNo} />
          <SlipLine label="Driver" value={transaction.driverName} />
          <SlipLine label="Driver ID" value={transaction.driverIdentity || "-"} />
          <SlipLine label="Customer/Supplier" value={transaction.partyName} />
          <SlipLine label="Transporter" value={transaction.transporter || "-"} />
          <SlipLine label="Destination" value={transaction.destination || "-"} />
          <SlipLine label="Shift" value={transaction.shift || "-"} />
          <SlipLine label="Weighbridge" value={transaction.weighbridgeName || "-"} />
          <SlipLine label="First Weight" value={fmtWeight(transaction.firstWeight)} />
          <SlipLine label="First Time" value={transaction.firstWeighedAt ? fmtDate(transaction.firstWeighedAt) : "-"} />
          <SlipLine label="Final Weight" value={fmtWeight(transaction.finalWeight)} />
          <SlipLine label="Final Time" value={transaction.finalWeighedAt ? fmtDate(transaction.finalWeighedAt) : "-"} />
          <SlipLine label="Net Weight" value={fmtWeight(transaction.netWeight)} />
          <SlipLine label="Operator" value={transaction.operatorName} />
          <SlipLine label="Date" value={fmtDate(transaction.createdAt)} />
          <div className="my-3">
            <strong>Products</strong>
            <table className="mt-2 w-full border-collapse text-xs">
              <thead><tr><th className="border p-1 text-left">Product</th><th className="border p-1 text-right">Pkgs</th><th className="border p-1 text-right">Gross</th><th className="border p-1 text-right">Net/Product</th><th className="border p-1">Unit</th></tr></thead>
              <tbody>
                {transaction.productEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="border p-1">{entry.productName}</td>
                    <td className="border p-1 text-right">{entry.packageCount}</td>
                    <td className="border p-1 text-right">{fmtWeight(entry.grossWeight)}</td>
                    <td className="border p-1 text-right">{fmtWeight(entry.productWeight)}</td>
                    <td className="border p-1 text-center">{entry.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SlipCameraGroup title="1st Weight Camera Captures" images={firstCameraImages} />
          <SlipCameraGroup title="2nd Weight Camera Captures" images={finalCameraImages} />
          <p>QR Verification: {transaction.transactionNo}</p>
          <p className="mt-8">Signature: __________________________</p>
        </div>
        <div className="mt-5 flex justify-end gap-3 print:hidden">
          <button className="btn-secondary" onClick={reprint}>Print / Reprint</button>
          <button className="btn-primary" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

function SlipCameraGroup({ title, images }: { title: string; images: CameraImage[] }) {
  if (images.length === 0) return null;
  return (
    <div className="my-3 break-inside-avoid">
      <strong>{title}</strong>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {images.map((image) => (
          <figure className="overflow-hidden border border-slate-300" key={image.id}>
            <img className="aspect-video w-full object-cover" src={image.imageUrl} alt={`${image.cameraName} ${image.weighmentType} capture`} />
            <figcaption className="px-2 py-1 text-[11px]">
              {image.cameraName} | {image.position} | {fmtDate(image.capturedAt)}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function Header({ eyebrow, title, compact = false }: { eyebrow: string; title: string; compact?: boolean }) {
  return <header><p className="text-xs font-medium uppercase text-teal-700">{eyebrow}</p><h2 className={`${compact ? "text-2xl" : "text-3xl"} font-semibold text-slate-950`}>{title}</h2></header>;
}

function MenuIcon({ name }: { name: string }) {
  const icons: Record<string, LucideIcon> = {
    Dashboard: LayoutDashboard,
    "Weighbridge Slip": Scale,
    Vehicles: Truck,
    Drivers: User,
    Customers: UsersIcon,
    Products: Package,
    Reports: BarChart3,
    "Audit Logs": History,
    Users: UsersIcon,
    Settings: SettingsIcon
  };
  const Icon = icons[name] || LayoutDashboard;
  return <Icon aria-hidden="true" strokeWidth={1.8} />;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <article className="panel"><span className="text-sm font-medium text-slate-500">{label}</span><strong className="block text-3xl font-semibold">{value}</strong></article>;
}

function TransactionTable({ rows, onView }: { rows: Transaction[]; onView?: (transaction: Transaction) => void }) {
  return (
    <section className="panel overflow-auto">
      <table className="data-table">
        <thead><tr><th>Slip</th><th>Vehicle</th><th>Party</th><th>Status</th><th>Products</th><th>Net</th><th></th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.transactionNo}</strong></td><td>{row.vehicleNo}</td><td>{row.partyName}</td><td>{row.status.replace("_", " ")}</td><td>{row.productEntries.length}</td><td>{fmtWeight(row.netWeight)}</td><td>{onView && <button className="btn-secondary" onClick={() => onView(row)}>View</button>}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

function SlipLine({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4 border-b border-dashed border-slate-300 py-1"><span>{label}</span><strong>{value}</strong></div>;
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
