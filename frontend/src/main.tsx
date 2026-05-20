import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Role = "ADMIN" | "WEIGHBRIDGE_OPERATOR" | "ACCOUNTS" | "STORE_DISPATCH" | "VIEWER";
type Status = "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
type TransactionMode = "SINGLE" | "MULTIPLE";

type User = { id: string; name: string; username: string; role: Role; permissions: string[] };
type Vehicle = { id: string; vehicleNo: string; transporter: string };
type Driver = { id: string; name: string; phone: string };
type Party = { id: string; name: string; type: "CUSTOMER" | "SUPPLIER"; phone: string };
type Product = { id: string; name: string; unit: string };
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
  status: Status;
  vehicleNo: string;
  driverName: string;
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
  slipManualCameraCaptureEnabled: boolean;
  slipWeighbridgeNodeVisible: boolean;
  slipShiftVisible: boolean;
  device: Record<string, string | number | boolean>;
  weighbridges: WeighbridgeSetting[];
  cameras: CameraSetting[];
};

type AppData = {
  user: User | null;
  settings: Settings | null;
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
  vehicles: [],
  drivers: [],
  parties: [],
  products: [],
  transactions: []
};

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
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
  const [toast, setToast] = useState("");
  const [liveWeight, setLiveWeight] = useState<LiveReading>({ weight: 0, stable: false, source: "offline" });
  const [selected, setSelected] = useState<Transaction | null>(null);

  const flash = (message: string) => {
    setToast(message);
    window.clearTimeout((flash as unknown as { timer?: number }).timer);
    (flash as unknown as { timer?: number }).timer = window.setTimeout(() => setToast(""), 2800);
  };

  const refresh = async () => {
    const [me, master, transactions] = await Promise.all([
      api<{ user: User; settings: Settings }>("/api/me"),
      api<Omit<AppData, "user" | "settings" | "transactions">>("/api/master-data"),
      api<Transaction[]>("/api/transactions")
    ]);
    setData({ user: me.user, settings: me.settings, transactions, ...master });
  };

  useEffect(() => {
    api<{ user: User; settings: Settings }>("/api/me")
      .then(() => refresh())
      .catch(() => setData(emptyData));
  }, []);

  useEffect(() => {
    if (!data.user) return undefined;
    const poll = async () => {
      try {
        setLiveWeight(await api<typeof liveWeight>("/api/device/live-weight"));
      } catch {
        setLiveWeight((current) => ({ ...current, source: "offline", stable: false }));
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
      setError(err instanceof Error ? err.message : "Login failed");
    }
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    setData(emptyData);
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
            <label className="field">Username<input name="username" defaultValue="admin" required /></label>
            <label className="field">Password<input name="password" type="password" defaultValue="Admin123!" required /></label>
            <button className="btn-primary">Sign in</button>
            <p className="min-h-6 text-sm font-medium text-red-700">{error}</p>
          </form>
        </div>
      </main>
    );
  }

  const menu = [
    "Dashboard",
    "Weighbridge Slip",
    "Vehicles",
    "Drivers",
    "Customers",
    "Products",
    "Reports",
    "Audit Logs",
    "Users",
    "Settings"
  ];

  return (
    <main className={`app-shell ${active === "Weighbridge Slip" ? "slip-app" : ""}`}>
      <aside className="app-sidebar sticky top-0 flex h-screen flex-col gap-6 border-r border-slate-200 bg-white p-5 max-lg:static max-lg:h-auto">
        <div className="brand flex items-center gap-3">
          <div className="brand-mark grid h-12 w-12 place-items-center rounded-md bg-teal-700 font-semibold text-white">WB</div>
          <div>
            <strong>{data.settings.companyName}</strong>
            <small className="block text-slate-500">{data.settings.siteName}</small>
          </div>
        </div>
        <nav className="app-nav grid gap-2">
          {menu.map((item) => (
            <button key={item} onClick={() => setActive(item)} className={`nav-btn ${active === item ? "active" : ""}`}>
              {item}
            </button>
          ))}
        </nav>
        <div className="operator-card mt-auto border-t pt-4">
          <strong>{data.user.name}</strong>
          <small className="block text-slate-500">{data.user.role.replaceAll("_", " ")}</small>
          <button className="btn-secondary mt-3 w-full" onClick={logout}>Logout</button>
        </div>
      </aside>

      <section className={`min-w-0 p-6 ${active === "Weighbridge Slip" ? "slip-content" : ""}`}>
        {active !== "Weighbridge Slip" && <LiveWeight reading={liveWeight} />}
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
  const [weighmentType, setWeighmentType] = useState<"FIRST" | "SECOND">("FIRST");
  const [entryFormKey, setEntryFormKey] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [livePaused, setLivePaused] = useState(false);
  const [pausedWeight, setPausedWeight] = useState<number | null>(null);
  const [pendingFirstWeight, setPendingFirstWeight] = useState<{ weight: number; capturedAt: string } | null>(null);
  const [createError, setCreateError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
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
  const activeWeighbridge = data.settings?.weighbridges.find((item) => item.active) || data.settings?.weighbridges[0];
  const shownWeight = livePaused && pausedWeight != null ? pausedWeight : liveWeight.weight;
  const filteredSlips = selectableTransactions.filter((item) => {
    const text = `${item.transactionNo} ${item.vehicleNo} ${item.partyName}`.toLowerCase();
    return text.includes(searchTerm.toLowerCase());
  });

  useEffect(() => {
    api<{ slipNo: string }>("/api/transactions/next-slip-no")
      .then((payload) => setNextSlipNo(payload.slipNo))
      .catch(() => setNextSlipNo("Auto-generated"));
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

  const resetEntry = () => {
    setActiveSlipId("");
    setPendingFirstWeight(null);
    setCreateError("");
    setWeighmentType("FIRST");
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

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setCreateError("");
    if (activeSlip) {
      const message = activeSlip.firstWeight == null
        ? "Capture first weight for the selected slip"
        : "This slip already has first weight. Add product lines or select 2nd Weight to close it.";
      setCreateError(message);
      onToast(message);
      return;
    }
    if (!pendingFirstWeight) {
      setCreateError("Capture weight first to save");
      onToast("Capture weight first to save");
      return;
    }
    setIsCreating(true);
    try {
      const transaction = await api<Transaction>("/api/transactions", {
        method: "POST",
        body: JSON.stringify({
          ...formObject(form),
          captureInitialWeight: true,
          initialWeight: pendingFirstWeight.weight
        })
      });
      form.reset();
      await onRefresh();
      const preview = await api<{ slipNo: string }>("/api/transactions/next-slip-no").catch(() => null);
      if (preview) setNextSlipNo(preview.slipNo);
      resetEntry();
      onToast(`Slip ${transaction.transactionNo} saved. Select it from Select Slip to continue.`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create transaction");
    } finally {
      setIsCreating(false);
    }
  };

  const action = async (path: string, body: object, message: string) => {
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      await onRefresh();
      onToast(message);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Action failed");
    }
  };

  const captureWeight = async () => {
    if (!activeSlip) {
      if (weighmentType === "SECOND") {
        onToast("Save the first weight before selecting 2nd Weight");
        return;
      }
      setPendingFirstWeight({ weight: shownWeight, capturedAt: new Date().toISOString() });
      onToast("First weight captured. Save to create slip and camera image.");
      return;
    }
    if (weighmentType === "FIRST") {
      await action(`/api/transactions/${activeSlip.id}/first-weigh`, { weight: shownWeight }, "First weight and camera captured");
      return;
    }
    await action(`/api/transactions/${activeSlip.id}/final-weigh`, { weight: shownWeight }, "Second weight and camera captured");
  };

  const captureProduct = async () => {
    if (!activeSlip) {
      onToast("Select an open slip first");
      return;
    }
    await action(`/api/transactions/${activeSlip.id}/product-weigh`, { ...productDraft, weight: shownWeight }, "Product line captured");
  };

  const captureCamera = async () => {
    if (!activeSlip) {
      onToast("Select an open slip first");
      return;
    }
    await action(`/api/transactions/${activeSlip.id}/camera-capture`, { weighmentType: weighmentType === "SECOND" ? "FINAL" : "FIRST" }, "Camera image captured");
  };

  const selectedProduct = data.products.find((item) => item.id === productDraft.productId);

  return (
    <section className="slip-entry-screen">
      <Header eyebrow="Slip Entry" title="Weighment Entry" compact />
      <div className="slip-entry-toolbar">
        <button className="btn-secondary" type="button" onClick={resetEntry}>New Entry</button>
        <button className="btn-secondary" type="button" onClick={() => {
          resetEntry();
          onToast("Entry cleared");
        }}>Cancel</button>
        <button className="btn-secondary" type="button" onClick={onBack}>Exit / Back</button>
        <label className="field slip-search">Search<input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Slip, vehicle, customer" /></label>
        <button className="btn-secondary" type="button" onClick={() => onToast(`${filteredSlips.length} slip(s) found`)}>Search</button>
        <button className="btn-secondary" type="button" onClick={() => activeSlip && onView(activeSlip)} disabled={!activeSlip || activeSlip.status !== "COMPLETED"}>Print Slip</button>
        <button className="btn-secondary" type="button" onClick={() => activeSlip && onView(activeSlip)} disabled={!activeSlip || !can(data.user, "REPRINT_SLIP")}>Reprint Slip</button>
      </div>

      <div className="slip-entry-grid">
        <section className="panel slip-entry-panel">
          <form id="weighment-entry-form" className="weighment-form" key={entryFormKey} onSubmit={create}>
            <div className="form-section-head">
              <h3 className="section-title mb-0">Slip Details</h3>
              <span className="status-pill">{activeSlip?.status || "NEW"}</span>
            </div>
            <div className="slip-detail-group slip-detail-group-primary">
              <label className="field field-muted">Slip No<input value={activeSlip?.transactionNo || nextSlipNo} readOnly /></label>
              <label className="field">Select Slip<select value={activeSlip?.id || ""} onChange={(event) => {
                const selectedSlip = selectableTransactions.find((item) => item.id === event.target.value);
                setActiveSlipId(event.target.value);
                setPendingFirstWeight(null);
                setCreateError("");
                setWeighmentType(selectedSlip?.firstWeight != null && selectedSlip.finalWeight == null ? "SECOND" : "FIRST");
              }}>
                <option value="">New unsaved slip</option>
                {filteredSlips.map((item) => <option key={item.id} value={item.id}>{item.transactionNo} - {item.vehicleNo} - {item.status}</option>)}
              </select></label>
              <label className="field field-muted">Date Time<input value={fmtSlipDateTime()} readOnly /></label>
              <label className="field">Weighment type<select value={weighmentType} onChange={(event) => setWeighmentType(event.target.value as "FIRST" | "SECOND")}><option value="FIRST">1st Weight</option><option value="SECOND">2nd Weight</option></select></label>
            </div>
            <div className="slip-detail-group">
              <span className="group-label">Party and Vehicle</span>
              <label className="field">Vehicle No<select name="vehicleId" required><option value="">Select vehicle</option>{data.vehicles.map((item) => <option key={item.id} value={item.id}>{item.vehicleNo}</option>)}</select></label>
              <label className="field">Customer<select name="partyId" required><option value="">Select customer</option>{data.parties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="field">Driver Name<select name="driverId" required><option value="">Select driver</option>{data.drivers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="field">Driver ID<input name="driverIdentity" defaultValue={activeSlip?.driverIdentity || ""} /></label>
              <label className="field">Transporter<input name="transporter" defaultValue={activeSlip?.transporter || ""} /></label>
              <label className="field">Destination<input name="destination" defaultValue={activeSlip?.destination || ""} /></label>
            </div>
            <div className="slip-detail-group slip-weight-group">
              <span className="group-label">Weight Capture</span>
              {data.settings?.slipShiftVisible ? (
                <label className="field">Shift<select name="shift" defaultValue="Day"><option>Day</option><option>Night</option><option>Morning</option><option>Evening</option></select></label>
              ) : (
                <input type="hidden" name="shift" value="Day" />
              )}
              {data.settings?.slipWeighbridgeNodeVisible ? (
                <label className="field">Current weighbridge node<select name="weighbridgeId" defaultValue={activeWeighbridge?.id || ""}>{data.settings?.weighbridges.map((item) => <option key={item.id} value={item.id}>{item.name} {item.active ? "(active)" : "(disabled)"}</option>)}</select></label>
              ) : (
                <input type="hidden" name="weighbridgeId" value={activeWeighbridge?.id || ""} />
              )}
              <label className="field field-muted weight-field">First Weight<input value={fmtWeight(activeSlip?.firstWeight ?? pendingFirstWeight?.weight)} readOnly /></label>
              <label className="field field-muted weight-field">Second Weight<input value={fmtWeight(activeSlip?.finalWeight)} readOnly /></label>
              <label className="field field-muted weight-field weight-field-net">Net Weight<input value={fmtWeight(activeSlip?.netWeight)} readOnly /></label>
              <label className="field field-muted">First weight date/time<input value={activeSlip?.firstWeighedAt ? fmtDate(activeSlip.firstWeighedAt) : pendingFirstWeight ? fmtDate(pendingFirstWeight.capturedAt) : "-"} readOnly /></label>
              <label className="field field-muted">Second weight date/time<input value={activeSlip?.finalWeighedAt ? fmtDate(activeSlip.finalWeighedAt) : "-"} readOnly /></label>
            </div>
            <input type="hidden" name="mode" value="MULTIPLE" />
            <div className="slip-action-strip">
              <button className="btn-primary" disabled={isCreating || Boolean(activeSlip) || !can(data.user, "CREATE_TRANSACTION")}>{isCreating ? "Saving..." : "Save"}</button>
              <button className="btn-primary" type="button" onClick={captureWeight} disabled={!liveWeight.stable || Boolean(activeSlip && ((weighmentType === "FIRST" && activeSlip.firstWeight != null) || (weighmentType === "SECOND" && (activeSlip.firstWeight == null || activeSlip.productEntries.length === 0 || activeSlip.status === "COMPLETED"))))}>
                Capture Weight
              </button>
              <button className="btn-secondary" type="button" onClick={() => {
                if (livePaused) {
                  setLivePaused(false);
                  setPausedWeight(null);
                } else {
                  setPausedWeight(liveWeight.weight);
                  setLivePaused(true);
                }
              }}>{livePaused ? "Resume Live Reading" : "Pause Live Reading"}</button>
              <div className="action-live-indicator">
                <LiveWeight reading={{ ...liveWeight, weight: shownWeight }} compact />
              </div>
              {data.settings?.slipManualCameraCaptureEnabled && (
                <button className="btn-secondary" type="button" onClick={captureCamera} disabled={!activeSlip}>Camera Capture</button>
              )}
            </div>
            {createError && <p className="slip-action-error">{createError}</p>}
          </form>

          <section className="product-line-editor">
            <div className="form-section-head">
              <h3 className="section-title mb-0">Material / Product Lines</h3>
              <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={captureProduct} disabled={!productDraft.productId || !activeSlip || activeSlip.firstWeight == null || activeSlip.status === "COMPLETED" || !can(data.user, "CAPTURE_PRODUCT_WEIGHT")}>Add Product Line</button>
            </div>
            <div className="weighment-form product-line-form">
              <label className="field">Material/Product<select value={productDraft.productId} onChange={(event) => {
                const product = data.products.find((item) => item.id === event.target.value);
                setProductDraft((current) => ({ ...current, productId: event.target.value, unit: product?.unit || "" }));
              }}><option value="">Select product</option>{data.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="field">Packing Mode<input value={productDraft.packingMode} onChange={(event) => setProductDraft((current) => ({ ...current, packingMode: event.target.value }))} /></label>
              <label className="field">Total Packages<input type="number" value={productDraft.packageCount} onChange={(event) => setProductDraft((current) => ({ ...current, packageCount: Number(event.target.value) }))} /></label>
              <label className="field">Unit<input value={productDraft.unit || selectedProduct?.unit || "kg"} onChange={(event) => setProductDraft((current) => ({ ...current, unit: event.target.value }))} /></label>
              <label className="field">Tare Weight<input type="number" value={productDraft.tareWeight} onChange={(event) => setProductDraft((current) => ({ ...current, tareWeight: Number(event.target.value) }))} /></label>
              <label className="field">Packing Tare<input type="number" value={productDraft.packingTare} onChange={(event) => setProductDraft((current) => ({ ...current, packingTare: Number(event.target.value) }))} /></label>
            </div>
            <div className="compact-table-wrap">
              <table className="mini-table">
                <thead><tr><th>#</th><th>Product</th><th>Pkgs</th><th>Gross/Intermediate</th><th>Product Weight</th><th>Unit</th></tr></thead>
                <tbody>
                  {(activeSlip?.productEntries || []).map((entry) => (
                    <tr key={entry.id}><td>{entry.sequence}</td><td>{entry.productName}</td><td>{entry.packageCount}</td><td>{fmtWeight(entry.grossWeight)}</td><td>{fmtWeight(entry.productWeight)}</td><td>{entry.unit}</td></tr>
                  ))}
                  {!activeSlip?.productEntries.length && <tr><td colSpan={6}>No product lines captured yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <aside className="slip-live-panel">
          <section className="panel slip-panel">
            <h3 className="section-title">Camera Live View</h3>
            <CameraWall cameras={slipCameras(data.settings)} large />
          </section>
        </aside>
      </div>
    </section>
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
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    await api(endpoint, { method: "POST", body: JSON.stringify(formObject(form)) });
    form.reset();
    await onRefresh();
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
  useEffect(() => { api<Array<Record<string, string>>>("/api/audit-logs").then(setLogs); }, []);
  return (
    <section className="grid gap-5">
      <Header eyebrow="Security" title="Audit Logs" />
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
  useEffect(() => { api<User[]>("/api/users").then(setUsers); }, []);
  return (
    <section className="grid gap-5">
      <Header eyebrow="Access" title="Users and Roles" />
      <section className="panel">
        <form className="grid grid-cols-5 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1" onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          await api("/api/users", { method: "POST", body: JSON.stringify(formObject(form)) });
          setUsers(await api<User[]>("/api/users"));
          form.reset();
        }}>
          <label className="field">Name<input name="name" required /></label>
          <label className="field">Username<input name="username" required /></label>
          <label className="field">Password<input name="password" type="password" required /></label>
          <label className="field">Role<select name="role"><option>ADMIN</option><option>WEIGHBRIDGE_OPERATOR</option><option>ACCOUNTS</option><option>STORE_DISPATCH</option><option>VIEWER</option></select></label>
          <button className="btn-primary self-end" disabled={disabled}>Create</button>
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
  const [weighbridgeNodeVisible, setWeighbridgeNodeVisible] = useState(Boolean(settings.slipWeighbridgeNodeVisible));
  const [shiftVisible, setShiftVisible] = useState(Boolean(settings.slipShiftVisible));
  const [message, setMessage] = useState("");

  useEffect(() => {
    setWeighbridges(settingsWeighbridges(settings));
    setCameras([...settings.cameras].sort((left, right) => left.displayOrder - right.displayOrder));
    setManualCameraCaptureEnabled(Boolean(settings.slipManualCameraCaptureEnabled));
    setWeighbridgeNodeVisible(Boolean(settings.slipWeighbridgeNodeVisible));
    setShiftVisible(Boolean(settings.slipShiftVisible));
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

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage("");
    const orderedWeighbridges = weighbridges.map((weighbridge, index) => ({ ...weighbridge, displayOrder: index + 1 }));
    const orderedCameras = cameras.map((camera, index) => ({ ...camera, displayOrder: index + 1 }));
    await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        ...formObject(form),
        slipManualCameraCaptureEnabled: manualCameraCaptureEnabled,
        slipWeighbridgeNodeVisible: weighbridgeNodeVisible,
        slipShiftVisible: shiftVisible,
        weighbridges: orderedWeighbridges,
        cameras: orderedCameras
      })
    });
    setMessage("Settings saved");
    await onRefresh();
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

          <div>
            <h3 className="section-title">Slip Entry Options</h3>
            <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={manualCameraCaptureEnabled}
                onChange={(event) => setManualCameraCaptureEnabled(event.target.checked)}
              />
              Show manual Camera Capture button on Slip Entry
            </label>
            <label className="mt-2 inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={weighbridgeNodeVisible}
                onChange={(event) => setWeighbridgeNodeVisible(event.target.checked)}
              />
              Show current weighbridge node on Slip Entry
            </label>
            <label className="mt-2 inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={shiftVisible}
                onChange={(event) => setShiftVisible(event.target.checked)}
              />
              Show shift on Slip Entry
            </label>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="section-title mb-0">Weighbridge Display Settings</h3>
              <div className="flex flex-wrap justify-end gap-2">
                <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={() => setExpandedWeighbridgeIds(weighbridges.map((weighbridge) => weighbridge.id))} disabled={weighbridges.length === 0}>Expand All</button>
                <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={() => setExpandedWeighbridgeIds([])} disabled={weighbridges.length === 0}>Collapse All</button>
                <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={addWeighbridge} disabled={disabled}>Add Weighbridge</button>
              </div>
            </div>
            <div className="grid gap-3">
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
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="section-title mb-0">Camera Classification and Slip Display</h3>
              <div className="flex flex-wrap justify-end gap-2">
                <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={() => setExpandedCameraIds(cameras.map((camera) => camera.id))} disabled={cameras.length === 0}>Expand All</button>
                <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={() => setExpandedCameraIds([])} disabled={cameras.length === 0}>Collapse All</button>
                <button className="btn-secondary min-h-8 px-3 py-1 text-sm" type="button" onClick={addCamera} disabled={disabled}>Add Camera</button>
              </div>
            </div>
            <div className="grid gap-3">
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
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={disabled}>Save Settings</button>
            {message && <span className="text-sm font-medium text-teal-700">{message}</span>}
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
    await api(`/api/transactions/${transaction.id}/reprint`, { method: "POST" });
    window.print();
    onToast("Reprint logged");
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

createRoot(document.getElementById("root")!).render(<App />);
