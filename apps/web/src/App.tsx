import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CreditCard,
  FileText,
  Layers3,
  LayoutGrid,
  Leaf,
  Menu,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import "./styles.css";
import {
  type Subscription,
  type Proposal,
  proposalSchema,
  boundedChatHistory,
  validateReview,
  monthlyTotals,
  duplicateKey,
  parseInventoryCsv,
} from "@saldo/domain";

type Cadence =
  | "monthly"
  | "yearly"
  | "weekly"
  | "quarterly"
  | "one-time"
  | "unknown";
type Status = "active" | "trial" | "paused" | "cancelled" | "unknown";
type Draft = Omit<Subscription, "id"> & { id?: string };
interface Connection {
  authenticated: boolean;
  aiConnected: boolean;
}
interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}
interface Attachment {
  name: string;
  type: string;
  dataUrl: string;
}
const categories = [
  "Entertainment",
  "Productivity",
  "Design",
  "Health & wellness",
  "Education",
  "Storage",
  "Other",
];
const cadenceNames: Record<Cadence, string> = {
  monthly: "Monthly",
  yearly: "Yearly",
  weekly: "Weekly",
  quarterly: "Quarterly",
  "one-time": "One-time",
  unknown: "Not confirmed",
};
const statusNames: Record<Status, string> = {
  active: "Active",
  trial: "Free trial",
  paused: "Paused",
  cancelled: "Cancelled",
  unknown: "Unconfirmed",
};
const factors: Record<Cadence, number> = {
  monthly: 1,
  yearly: 1 / 12,
  weekly: 52 / 12,
  quarterly: 1 / 3,
  "one-time": 0,
  unknown: 0,
};
const money = (amount: number, currency = "USD") => {
  if (currency === "UNK") return amount.toFixed(2);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};
const parseDay = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00`);
const displayDate = (s: string) =>
  parseDay(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const isoDate = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const emptyDraft = (): Draft => ({
  name: "",
  amount: null,
  currency: "USD",
  cadence: "monthly",
  renewalDate: null,
  status: "active",
  category: "Other",
  source: "Manual entry",
  lastVerified: null,
  notes: "",
});
function sampleSubscriptions(): Subscription[] {
  return [
    {
      id: "demo-1",
      name: "Spotify",
      amount: 11.99,
      currency: "USD",
      cadence: "monthly",
      renewalDate: isoDate(2),
      status: "active",
      category: "Entertainment",
      source: "Sample data",
      lastVerified: new Date().toISOString(),
      notes: "Individual plan. This is fictional sample data.",
    },
    {
      id: "demo-2",
      name: "Notion",
      amount: 96,
      currency: "USD",
      cadence: "yearly",
      renewalDate: isoDate(7),
      status: "active",
      category: "Productivity",
      source: "Sample data",
      lastVerified: new Date().toISOString(),
      notes: "Personal workspace. This is fictional sample data.",
    },
    {
      id: "demo-3",
      name: "Netflix",
      amount: 15.49,
      currency: "USD",
      cadence: "monthly",
      renewalDate: isoDate(9),
      status: "active",
      category: "Entertainment",
      source: "Sample data",
      lastVerified: new Date().toISOString(),
      notes: "This is fictional sample data.",
    },
    {
      id: "demo-4",
      name: "Figma",
      amount: 15,
      currency: "USD",
      cadence: "monthly",
      renewalDate: isoDate(14),
      status: "active",
      category: "Design",
      source: "Sample data",
      lastVerified: new Date().toISOString(),
      notes: "This is fictional sample data.",
    },
    {
      id: "demo-5",
      name: "Headspace",
      amount: 12.99,
      currency: "USD",
      cadence: "monthly",
      renewalDate: isoDate(19),
      status: "trial",
      category: "Health & wellness",
      source: "Sample data",
      lastVerified: new Date().toISOString(),
      notes:
        "Trial: confirm the billing date and price before it ends. Fictional sample data.",
    },
    {
      id: "demo-6",
      name: "iCloud+",
      amount: 2.99,
      currency: "USD",
      cadence: "monthly",
      renewalDate: isoDate(22),
      status: "active",
      category: "Storage",
      source: "Sample data",
      lastVerified: new Date().toISOString(),
      notes: "This is fictional sample data.",
    },
  ];
}
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
  };
  if (!response.ok)
    throw new Error(
      body.error || body.message || `Request failed (${response.status}).`,
    );
  return body;
}
function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`logo ${small ? "small" : ""}`}>
      <span className="logo-symbol">
        <span />
        <span />
        <span />
      </span>
      {!small && (
        <span>
          saldo<span className="logo-period">.</span>
        </span>
      )}
    </span>
  );
}
function ServiceIcon({ name, size = "" }: { name: string; size?: string }) {
  const brand = name.toLowerCase();
  let icon: ReactNode = name.slice(0, 1).toUpperCase();
  let className = "generic";
  if (brand.includes("spotify")) {
    className = "spotify";
    icon = (
      <span className="spotify-lines">
        <i />
        <i />
        <i />
      </span>
    );
  } else if (brand.includes("notion")) {
    className = "notion";
    icon = "N";
  } else if (brand.includes("netflix")) {
    className = "netflix";
    icon = "N";
  } else if (brand.includes("figma")) {
    className = "figma";
    icon = (
      <span className="figma-mark">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    );
  } else if (brand.includes("headspace")) {
    className = "headspace";
    icon = <span />;
  } else if (brand.includes("icloud")) {
    className = "icloud";
    icon = <span>☁</span>;
  }
  return (
    <span className={`service-icon ${className} ${size}`} aria-hidden="true">
      {icon}
    </span>
  );
}
function useDialogFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTarget =
      ref.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([type="file"]):not(:disabled), textarea:not(:disabled), select:not(:disabled)',
      ) || ref.current?.querySelector<HTMLElement>("button:not(:disabled)");
    focusTarget?.focus();
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key === "Tab" && ref.current) {
        const nodes = Array.from(
          ref.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled):not([hidden]), input:not(:disabled):not([hidden]):not([type="hidden"]):not([type="file"]), select:not(:disabled):not([hidden]), textarea:not(:disabled):not([hidden]), summary, [tabindex="0"]',
          ),
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [open]);
  return ref;
}

export default function App() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [demo, setDemo] = useState(false);
  const [demoItems, setDemoItems] =
    useState<Subscription[]>(sampleSubscriptions);
  const [connection, setConnection] = useState<Connection>({
    authenticated: false,
    aiConnected: false,
  });
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All categories");
  const [status, setStatus] = useState("all");
  const [view, setView] = useState<"subscriptions" | "upcoming">(
    "subscriptions",
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"chat" | "csv">("chat");
  const [mobileNav, setMobileNav] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [chartCurrency, setChartCurrency] = useState("USD");
  const source = demo ? demoItems : subscriptions;
  const refresh = async () => {
    setLoading(true);
    setConnectionError("");
    try {
      const state = await api<Connection>("/api/status");
      setConnection({
        authenticated: !!state.authenticated,
        aiConnected: !!state.aiConnected,
      });
      if (state.authenticated) {
        const result = await api<
          Subscription[] | { subscriptions: Subscription[] }
        >("/api/subscriptions");
        setSubscriptions(
          Array.isArray(result) ? result : result.subscriptions || [],
        );
      } else setSubscriptions([]);
    } catch {
      setSubscriptions([]);
      setConnectionError(
        "Your private workspace is not connected. You can still explore the sample workspace.",
      );
      setConnection({ authenticated: false, aiConnected: false });
      setSubscriptions([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const active = source.filter((s) => s.status === "active");
  const monthly = useMemo(() => monthlyTotals(source).totals, [source]);
  const currencies = Object.keys(monthly).sort();
  const selectedCurrency = currencies.includes(chartCurrency)
    ? chartCurrency
    : currencies[0] || "USD";
  const unknown = active.filter(
    (s) => s.amount === null || s.cadence === "unknown" || s.currency === "UNK",
  ).length;
  const upcoming = useMemo(
    () =>
      source
        .filter(
          (s) =>
            ["active", "trial"].includes(s.status) &&
            s.renewalDate &&
            s.renewalDate >= isoDate() &&
            s.renewalDate <= isoDate(30),
        )
        .sort((a, b) => a.renewalDate!.localeCompare(b.renewalDate!)),
    [source],
  );
  const filtered = source.filter(
    (s) =>
      (s.name.toLowerCase().includes(query.toLowerCase()) ||
        s.category.toLowerCase().includes(query.toLowerCase())) &&
      (category === "All categories" || s.category === category) &&
      (status === "all" || s.status === status) &&
      (view !== "upcoming" || upcoming.some((u) => u.id === s.id)),
  );
  const categoryTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    active.forEach((s) => {
      if (
        s.currency === selectedCurrency &&
        s.amount !== null &&
        factors[s.cadence] > 0
      )
        totals[s.category || "Other"] =
          (totals[s.category || "Other"] || 0) + s.amount * factors[s.cadence];
    });
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
  }, [source, selectedCurrency]);
  const save = async (next: Draft) => {
    const id = next.id || crypto.randomUUID();
    const proposal = proposalSchema.parse({
      ...next,
      id,
      operation: next.id ? "update" : "add",
      targetId: next.id,
    });
    const validated = validateReview([proposal], source);
    if (demo) setDemoItems(validated);
    else {
      const result = await api<{ subscription: Subscription }>(
        next.id
          ? `/api/subscriptions/${encodeURIComponent(next.id)}`
          : "/api/subscriptions",
        { method: next.id ? "PATCH" : "POST", body: JSON.stringify(next) },
      );
      setSubscriptions((items) =>
        next.id
          ? items.map((old) => (old.id === next.id ? result.subscription : old))
          : [...items, result.subscription],
      );
    }
    setToast(
      demo
        ? "Saved to sample workspace only."
        : "Subscription saved. A little more clarity.",
    );
  };
  const remove = async (id: string) => {
    if (demo) setDemoItems((items) => items.filter((item) => item.id !== id));
    else {
      await api(`/api/subscriptions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setSubscriptions((items) => items.filter((item) => item.id !== id));
    }
    setToast(
      demo
        ? "Removed from sample workspace."
        : "Subscription removed from your tracker. This does not cancel the service.",
    );
  };
  const saveReview = async (proposals: Proposal[], requestId: string) => {
    if (demo) setDemoItems(validateReview(proposals, demoItems));
    else {
      const result = await api<{ subscriptions: Subscription[] }>(
        "/api/review",
        { method: "POST", body: JSON.stringify({ proposals, requestId }) },
      );
      setSubscriptions(result.subscriptions);
    }
    setToast(
      `${proposals.length} ${proposals.length === 1 ? "subscription" : "subscriptions"} saved${demo ? " to the sample workspace only" : ""}.`,
    );
  };
  const beginAdd = () => setDraft(emptyDraft());
  const openImport = (mode: "chat" | "csv") => {
    setImportMode(mode);
    setImportOpen(true);
  };
  const switchDemo = () => {
    setDemo((old) => !old);
    setQuery("");
    setStatus("all");
    setCategory("All categories");
  };
  const navigate = (to: "subscriptions" | "upcoming") => {
    setView(to);
    setStatus("all");
    setMobileNav(false);
  };
  const totalDisplay = (multiplier = 1) =>
    currencies.length ? (
      <div className={`money-stack ${currencies.length > 1 ? "multiple" : ""}`}>
        {currencies.map((currency) => (
          <div key={currency}>
            {money(monthly[currency] * multiplier, currency)}
            <span>{currency}</span>
          </div>
        ))}
      </div>
    ) : (
      <div className="metric-empty">
        {source.length ? "No confirmed costs" : "No spend yet"}
        <span>
          {source.length
            ? "Active recurring costs will appear here"
            : "Start with your first subscription"}
        </span>
      </div>
    );

  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        className={`sidebar ${mobileNav ? "open" : ""}`}
        aria-label="Main navigation"
      >
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("subscriptions");
          }}
          aria-label="Saldo home"
        >
          <Logo />
        </a>
        <div className="workspace-switch">
          <span className="workspace-icon">
            <Wallet size={18} />
          </span>
          <div>
            Personal workspace<small>Your money. Your space.</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          <button
            className={
              view === "subscriptions" ? "nav-item active" : "nav-item"
            }
            onClick={() => navigate("subscriptions")}
          >
            <Layers3 size={19} />
            <span>Subscriptions</span>
            <span className="nav-count">{source.length}</span>
          </button>
          <button
            className={view === "upcoming" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("upcoming")}
          >
            <CalendarDays size={19} />
            <span>Upcoming payments</span>
          </button>
          <button
            className="nav-item"
            onClick={() => {
              setMobileNav(false);
              openImport("chat");
            }}
            aria-label="Chat with Saldo"
          >
            <Sparkles size={19} />
            <span>AI assistant</span>
          </button>
          <div className="nav-divider" />
          <span className="nav-item disabled">
            <LayoutGrid size={19} />
            <span>Budgets</span>
            <small>Soon</small>
          </span>
          <span className="nav-item disabled">
            <TrendingUp size={19} />
            <span>Insights</span>
            <small>Soon</small>
          </span>
        </nav>
        <div className="sidebar-bottom">
          <div className="calm-card">
            <span className="calm-leaf">
              <Leaf size={22} strokeWidth={1.5} />
            </span>
            <h3>A little less mental math.</h3>
            <p>A little more room for life.</p>
            <span className="calm-orbit orbit-one" />
            <span className="calm-orbit orbit-two" />
          </div>
          <button
            className="nav-item help-button"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp size={18} />
            <span>How Saldo works</span>
            <ArrowUpRight size={15} />
          </button>
          <div className="workspace-person">
            <span className="person-avatar">Y</span>
            <div>
              Your workspace
              <small>
                <span
                  className={`connection-dot ${connection.authenticated && !demo ? "connected" : ""}`}
                />
                {demo
                  ? "Sample data"
                  : connection.authenticated
                    ? "Private & connected"
                    : "Not connected"}
              </small>
            </div>
            <ShieldCheck size={17} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">
              Workspace <ChevronRight size={13} />{" "}
              <strong>
                {view === "upcoming" ? "Upcoming payments" : "Subscriptions"}
              </strong>
            </span>
          </div>
          <div className="topbar-right">
            <button
              className={`demo-switch ${demo ? "on" : ""}`}
              onClick={switchDemo}
              aria-label={demo ? "Exit demo" : "Load demo"}
              aria-pressed={demo}
            >
              <span className="toggle-track">
                <i />
              </span>
              <span>Sample workspace</span>
            </button>
            <span className="topbar-divider" />
            <span className="header-avatar" title="Your private workspace">
              Y
            </span>
          </div>
        </header>
        <main>
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> A CLEARER PICTURE
              </div>
              <h1>
                {view === "upcoming"
                  ? "Know what’s next."
                  : "Good things. Fewer surprises."}
              </h1>
              <p>
                {view === "upcoming"
                  ? "Your confirmed renewal dates for the next 30 days."
                  : "All your subscriptions, with a little breathing room."}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="button secondary"
                onClick={() => openImport("csv")}
                aria-label="Import CSV"
              >
                <FileText size={16} /> Import CSV
              </button>
              <button className="button primary" onClick={beginAdd}>
                <Plus size={18} /> Add subscription
              </button>
            </div>
          </section>
          {demo && (
            <div className="notice demo-notice">
              <span className="notice-icon">
                <Sparkles size={16} />
              </span>
              <p>
                <strong>A look around, with sample data.</strong> Changes stay
                in this sample workspace and don’t touch your real
                subscriptions.
              </p>
              <button onClick={switchDemo}>
                Exit sample <ArrowRight size={14} />
              </button>
            </div>
          )}
          {!demo && !loading && !connection.authenticated && (
            <div className="notice connection-notice">
              <ShieldCheck size={18} />
              <p>
                <strong>Your private workspace is not connected.</strong>{" "}
                {connectionError
                  ? "Check your server configuration to start saving securely."
                  : "Set up authentication on the server before adding real financial information."}
              </p>
              <button onClick={() => void refresh()}>
                Check again <ArrowRight size={14} />
              </button>
            </div>
          )}
          <section className="metrics" aria-label="Subscription summary">
            <article className="metric-card primary-metric">
              <div className="metric-label">
                <span>Monthly committed</span>
                <span className="metric-icon">
                  <ArrowUpRight size={18} />
                </span>
              </div>
              {totalDisplay()}
              <div className="metric-footer">
                <span className="tiny-dot" />
                {unknown
                  ? `${unknown} unconfirmed ${unknown === 1 ? "cost excluded" : "costs excluded"}`
                  : "Known active recurring costs"}
                <span className="metric-detail">Monthly equivalent</span>
              </div>
            </article>
            <article className="metric-card">
              <div className="metric-label">
                <span>Annual outlook</span>
                <span className="metric-icon">
                  <CalendarDays size={17} />
                </span>
              </div>
              {totalDisplay(12)}
              <div className="metric-footer">
                <span>Based on your current subscriptions</span>
                <span className="metric-detail">Estimate</span>
              </div>
            </article>
            <article className="metric-card count-metric">
              <div className="metric-label">
                <span>Active subscriptions</span>
                <span className="metric-icon">
                  <Layers3 size={17} />
                </span>
              </div>
              <div className="count-number">
                {active.length.toString().padStart(2, "0")}
                <span>things you’re making room for</span>
              </div>
              <div className="metric-footer">
                <span className="mini-pill">
                  <span />
                  {source.filter((s) => s.status === "trial").length} free{" "}
                  {source.filter((s) => s.status === "trial").length === 1
                    ? "trial"
                    : "trials"}
                </span>
                <span>
                  {source.filter((s) => s.status === "paused").length} paused
                </span>
              </div>
            </article>
          </section>
          <div className="content-grid">
            <section className="subscriptions-section panel">
              <div className="section-heading">
                <div>
                  <h2>
                    {view === "upcoming"
                      ? "Coming up soon"
                      : "Your subscriptions"}{" "}
                    <span className="number-badge">
                      {view === "upcoming" ? upcoming.length : source.length}
                    </span>
                  </h2>
                  <p>
                    {view === "upcoming"
                      ? "Only dates you’ve confirmed. No guesses."
                      : "The everyday essentials. And the just-for-you extras."}
                  </p>
                </div>
                <button
                  className="icon-button"
                  title="Add a subscription"
                  aria-label="Add a subscription"
                  onClick={beginAdd}
                >
                  <Plus size={19} />
                </button>
              </div>
              <div className="filter-bar">
                <label className="search-box">
                  <Search size={16} />
                  <input
                    placeholder="Find a subscription…"
                    aria-label="Search subscriptions"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </label>
                <label className="category-select">
                  <Settings2 size={15} />
                  <select
                    aria-label="Filter by category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option>All categories</option>
                    {Array.from(
                      new Set([
                        ...categories,
                        ...source.map((s) => s.category),
                      ]),
                    )
                      .filter(Boolean)
                      .map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                  </select>
                  <ChevronDown size={13} />
                </label>
              </div>
              <div
                className="status-tabs"
                role="tablist"
                aria-label="Subscription status"
              >
                {[
                  ["all", "All subscriptions"],
                  ["active", "Active"],
                  ["trial", "Trials"],
                  ["paused", "Paused"],
                  ["cancelled", "Cancelled"],
                  ["unknown", "Unconfirmed"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={status === value}
                    className={status === value ? "selected" : ""}
                    onClick={() => setStatus(value)}
                  >
                    {label}
                    {value === "all" && <span>{source.length}</span>}
                  </button>
                ))}
              </div>
              {loading && !demo ? (
                <div className="loading-state">
                  <span className="loader" />
                  Opening your workspace…
                </div>
              ) : filtered.length ? (
                <div className="subscription-table">
                  <div className="table-head">
                    <span>Subscription</span>
                    <span>Cost</span>
                    <span>Next renewal</span>
                    <span>Status</span>
                    <span />
                  </div>
                  {filtered.map((s) => (
                    <div className="subscription-row" key={s.id}>
                      <button
                        className="service-cell"
                        onClick={() => setDraft({ ...s })}
                      >
                        <ServiceIcon name={s.name} />
                        <span>
                          <strong>{s.name}</strong>
                          <small>{s.category}</small>
                        </span>
                      </button>
                      <div className="cost-cell">
                        <strong>
                          {s.amount === null
                            ? "Not confirmed"
                            : money(s.amount, s.currency)}
                        </strong>
                        <small>
                          {s.amount !== null
                            ? `${s.currency === "UNK" ? "Unknown currency" : s.currency} · `
                            : ""}
                          {cadenceNames[s.cadence]}
                        </small>
                      </div>
                      <div className="renewal-cell">
                        <span>
                          {s.renewalDate
                            ? displayDate(s.renewalDate)
                            : "Not confirmed"}
                        </span>
                        <small>
                          {s.renewalDate
                            ? parseDay(s.renewalDate).getFullYear()
                            : "Add a date"}
                        </small>
                      </div>
                      <div className="status-cell">
                        <span className={`status-pill ${s.status}`}>
                          <i />
                          {statusNames[s.status]}
                        </span>
                      </div>
                      <button
                        className="row-menu icon-button"
                        aria-label={`Edit ${s.name}`}
                        title={`Edit ${s.name}`}
                        onClick={() => setDraft({ ...s })}
                      >
                        <MoreHorizontal size={19} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : source.length ? (
                <div className="no-results">
                  <Search size={25} />
                  <h3>No subscriptions here.</h3>
                  <p>Try another search or filter.</p>
                  <button
                    className="text-button"
                    onClick={() => {
                      setQuery("");
                      setStatus("all");
                      setCategory("All categories");
                    }}
                  >
                    Reset filters
                  </button>
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-illustration">
                    <div className="illustration-orbit" />
                    <div className="floating-card back">
                      <span />
                      <i />
                      <i />
                    </div>
                    <div className="floating-card front">
                      <span>
                        <CreditCard size={21} />
                      </span>
                      <div>
                        <i />
                        <i />
                      </div>
                      <Check size={14} />
                    </div>
                    <span className="illustration-spark">✦</span>
                    <span className="illustration-dot" />
                  </div>
                  <h3>Start small. See the whole picture.</h3>
                  <p>
                    Add your first subscription and give every recurring
                    <br className="desktop-break" /> payment a place to call
                    home.
                  </p>
                  <button className="button primary" onClick={beginAdd}>
                    <Plus size={16} /> Add your first subscription
                  </button>
                  <button
                    className="text-button sample-link"
                    onClick={switchDemo}
                  >
                    Or take a look at a sample workspace{" "}
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
              {source.length > 0 && (
                <div className="table-footer">
                  <span>
                    Showing {filtered.length} of {source.length} subscriptions
                  </span>
                  <span>
                    <ShieldCheck size={13} /> Your data stays yours
                  </span>
                </div>
              )}
            </section>
            <aside className="right-column">
              <section className="renewals-panel panel">
                <div className="section-heading">
                  <div>
                    <div className="section-kicker">
                      <CalendarDays size={15} /> NEXT 30 DAYS
                    </div>
                    <h2>Around the corner</h2>
                  </div>
                  <span className="soft-icon">
                    <ArrowDownLeft size={17} />
                  </span>
                </div>
                {upcoming.length ? (
                  <div className="renewal-list">
                    {upcoming.slice(0, 3).map((s) => (
                      <button
                        key={s.id}
                        className="upcoming-item"
                        onClick={() => setDraft({ ...s })}
                      >
                        <span className="date-tile">
                          <small>
                            {parseDay(s.renewalDate!).toLocaleDateString(
                              "en-US",
                              { month: "short" },
                            )}
                          </small>
                          <strong>{parseDay(s.renewalDate!).getDate()}</strong>
                        </span>
                        <span className="upcoming-name">
                          <strong>{s.name}</strong>
                          <small>
                            {s.status === "trial"
                              ? "Trial ending"
                              : `${cadenceNames[s.cadence]} renewal`}
                          </small>
                        </span>
                        <span className="upcoming-amount">
                          {s.amount === null
                            ? "Unknown"
                            : money(s.amount, s.currency)}
                          <small>
                            {s.currency === "UNK"
                              ? "Unknown currency"
                              : s.currency}
                          </small>
                        </span>
                      </button>
                    ))}
                    <button
                      className="upcoming-all"
                      onClick={() => navigate("upcoming")}
                    >
                      See all upcoming <ArrowRight size={15} />
                    </button>
                  </div>
                ) : (
                  <div className="upcoming-empty">
                    <span>
                      <CalendarDays size={25} strokeWidth={1.3} />
                    </span>
                    <p>A clear calendar, for now.</p>
                    <small>Confirmed renewal dates will appear here.</small>
                  </div>
                )}
              </section>
              <section className="category-panel panel">
                <div className="section-heading">
                  <div>
                    <div className="section-kicker">THE BIG PICTURE</div>
                    <h2>Where it goes</h2>
                  </div>
                  {currencies.length > 1 && (
                    <select
                      className="currency-select"
                      value={selectedCurrency}
                      onChange={(e) => setChartCurrency(e.target.value)}
                      aria-label="Category chart currency"
                    >
                      {currencies.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  )}
                </div>
                {categoryTotals.length ? (
                  <>
                    <div className="category-total">
                      {money(monthly[selectedCurrency], selectedCurrency)}
                      <small>{selectedCurrency} / month</small>
                    </div>
                    <div className="segmented-bar" aria-hidden="true">
                      {categoryTotals.map(([name, value], i) => (
                        <span
                          key={name}
                          className={`category-color color-${i % 6}`}
                          style={{ flex: value }}
                        />
                      ))}
                    </div>
                    <div className="category-legend">
                      {categoryTotals.map(([name, value], i) => (
                        <div key={name}>
                          <span className={`legend-dot color-${i % 6}`} />
                          <span>{name}</span>
                          <strong>{money(value, selectedCurrency)}</strong>
                        </div>
                      ))}
                    </div>
                    <p className="chart-footnote">
                      Active subscriptions · monthly equivalents
                    </p>
                  </>
                ) : (
                  <div className="category-empty">
                    <div className="empty-chart">
                      <i />
                      <i />
                      <i />
                      <i />
                    </div>
                    <p>Give your spending some shape.</p>
                    <small>Your categories will come together here.</small>
                  </div>
                )}
              </section>
              <div className="gentle-note">
                <span>
                  <Leaf size={18} strokeWidth={1.4} />
                </span>
                <p>
                  Knowing where your money goes
                  <br />
                  <strong>is a good place to start.</strong>
                </p>
              </div>
            </aside>
          </div>
          <footer className="page-footer">
            <span>
              <Logo small /> A little clarity goes a long way.
            </span>
            <span>Built for a calmer relationship with money.</span>
          </footer>
        </main>
      </div>
      {draft && (
        <SubscriptionModal
          initial={draft}
          demo={demo}
          canSave={demo || connection.authenticated}
          onClose={() => setDraft(null)}
          onSave={save}
          onDelete={remove}
        />
      )}
      {importOpen && (
        <ImportPanel
          initialMode={importMode}
          subscriptions={source}
          onSaveReview={saveReview}
          connected={connection.aiConnected && connection.authenticated}
          demo={demo}
          canSave={demo || connection.authenticated}
          onClose={() => setImportOpen(false)}
          onManual={() => {
            setImportOpen(false);
            beginAdd();
          }}
        />
      )}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function SubscriptionModal({
  initial,
  demo,
  canSave,
  onClose,
  onSave,
  onDelete,
  reviewing = false,
}: {
  initial: Draft;
  demo: boolean;
  canSave: boolean;
  onClose: () => void;
  onSave: (draft: Draft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  reviewing?: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [amount, setAmount] = useState(
    initial.amount === null ? "" : String(initial.amount),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const savingLock = useRef(false);
  const ref = useDialogFocus(true, () => {
    if (!savingLock.current) onClose();
  });
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((old) => ({ ...old, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingLock.current || !canSave) return;
    if (!draft.name.trim()) {
      setError("Give this subscription a name.");
      return;
    }
    if (
      amount !== "" &&
      (!Number.isFinite(Number(amount)) || Number(amount) < 0)
    ) {
      setError("Enter a valid amount, or leave it empty if you’re unsure.");
      return;
    }
    if (!/^[A-Z]{3}$/.test(draft.currency)) {
      setError("Enter a three-letter currency code, such as USD or EUR.");
      return;
    }
    savingLock.current = true;
    setBusy(true);
    setError("");
    try {
      await onSave({
        ...draft,
        name: draft.name.trim(),
        amount: amount === "" ? null : Number(amount),
      });
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save. Please try again.",
      );
    } finally {
      savingLock.current = false;
      setBusy(false);
    }
  };
  const deleteItem = async () => {
    if (savingLock.current || !canSave) return;
    savingLock.current = true;
    setBusy(true);
    setError("");
    try {
      await onDelete(draft.id!);
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not remove this subscription.",
      );
    } finally {
      savingLock.current = false;
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !savingLock.current) onClose();
      }}
    >
      <div
        className="subscription-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscription-title"
        ref={ref}
      >
        <header className="modal-header">
          <span className="modal-symbol">
            <CreditCard size={21} />
          </span>
          <button
            className="icon-button"
            disabled={busy}
            onClick={onClose}
            aria-label="Close subscription editor"
          >
            <X size={20} />
          </button>
        </header>
        <div className="modal-intro">
          <div className="eyebrow">
            {reviewing
              ? "NOT SAVED YET"
              : demo
                ? "SAMPLE WORKSPACE"
                : "A LITTLE MORE CLARITY"}
          </div>
          <h2 id="subscription-title">
            {reviewing
              ? "Review the little details."
              : initial.id
                ? "The little details."
                : "Make it part of the picture."}
          </h2>
          <p>
            {reviewing
              ? "Confirm what you know. This edits your import draft only."
              : initial.id
                ? "Keep your subscription details up to date."
                : "Add what you know. You can fill in the rest later."}
          </p>
        </div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="form-field full">
              Subscription name
              <input
                required
                maxLength={120}
                placeholder="e.g. Spotify"
                value={draft.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </label>
            <label className="form-field">
              Amount <span className="optional">optional</span>
              <input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="Not confirmed"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="form-field">
              Currency
              <input
                required
                maxLength={3}
                minLength={3}
                placeholder="USD or UNK"
                title="Use UNK if the currency is unknown"
                value={draft.currency}
                onChange={(e) =>
                  update("currency", e.target.value.toUpperCase())
                }
              />
            </label>
            <label className="form-field">
              Billing cycle
              <select
                value={draft.cadence}
                onChange={(e) => update("cadence", e.target.value as Cadence)}
              >
                {Object.entries(cadenceNames).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Next renewal <span className="optional">optional</span>
              <input
                type="date"
                value={draft.renewalDate || ""}
                onChange={(e) => update("renewalDate", e.target.value || null)}
              />
            </label>
            <label className="form-field">
              Category
              <select
                value={draft.category}
                onChange={(e) => update("category", e.target.value)}
              >
                {Array.from(new Set([...categories, draft.category]))
                  .filter(Boolean)
                  .map((c) => (
                    <option key={c}>{c}</option>
                  ))}
              </select>
            </label>
            <label className="form-field">
              Status
              <select
                value={draft.status}
                onChange={(e) => update("status", e.target.value as Status)}
              >
                {Object.entries(statusNames).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field full">
              Source <span className="optional">optional</span>
              <input
                maxLength={500}
                placeholder="Receipt, account page, or where you found these details"
                value={draft.source}
                onChange={(e) => update("source", e.target.value)}
              />
            </label>
            <label className="form-field full">
              Last verified{" "}
              <span className="optional">only if you checked the details</span>
              <input
                type="datetime-local"
                value={
                  draft.lastVerified
                    ? new Date(
                        new Date(draft.lastVerified).getTime() -
                          new Date(draft.lastVerified).getTimezoneOffset() *
                            60000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : ""
                }
                onChange={(e) =>
                  update(
                    "lastVerified",
                    e.target.value
                      ? new Date(e.target.value).toISOString()
                      : null,
                  )
                }
              />
            </label>
            <label className="form-field full">
              Notes <span className="optional">optional</span>
              <textarea
                rows={2}
                maxLength={2000}
                placeholder="Plan details, reminders, or anything worth keeping…"
                value={draft.notes}
                onChange={(e) => update("notes", e.target.value)}
              />
            </label>
          </div>
          <div className="form-note">
            <ShieldCheck size={15} />
            <span>
              {demo
                ? "This is sample data. Nothing is saved to your real workspace."
                : "Tracking a subscription here does not start, change, or cancel it."}
            </span>
          </div>
          {!canSave && (
            <div className="form-error">
              Connect your private workspace on the server to save real
              subscriptions, or explore the sample workspace.
            </div>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {confirmDelete ? (
            <div className="delete-confirm">
              <p>
                Remove {draft.name} from your tracker? This will not cancel the
                service.
              </p>
              <button
                type="button"
                className="button danger"
                disabled={busy}
                onClick={() => void deleteItem()}
              >
                Remove subscription
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
              >
                Keep it
              </button>
            </div>
          ) : (
            <footer className="modal-footer">
              {initial.id && !reviewing && (
                <button
                  type="button"
                  className="delete-button"
                  disabled={busy || !canSave}
                  onClick={() => setConfirmDelete(true)}
                >
                  Remove
                </button>
              )}
              <div className="footer-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={busy || !canSave}
                >
                  {busy ? (
                    <span className="loader small" />
                  ) : (
                    <Check size={16} />
                  )}
                  {busy
                    ? "Saving…"
                    : reviewing
                      ? "Keep draft changes"
                      : initial.id
                        ? "Save changes"
                        : "Add subscription"}
                </button>
              </div>
            </footer>
          )}
        </form>
      </div>
    </div>
  );
}

function ImportPanel({
  connected,
  demo,
  canSave,
  initialMode,
  subscriptions,
  onClose,
  onSaveReview,
  onManual,
}: {
  connected: boolean;
  demo: boolean;
  canSave: boolean;
  initialMode: "chat" | "csv";
  subscriptions: Subscription[];
  onClose: () => void;
  onSaveReview: (proposals: Proposal[], requestId: string) => Promise<void>;
  onManual: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [review, setReview] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const sendLock = useRef(false);
  const saveLock = useRef(false);
  const pendingBatch = useRef<{
    requestId: string;
    proposals: Proposal[];
  } | null>(null);
  const close = () => {
    if (saving) return;
    controller.current?.abort();
    onClose();
  };
  const ref = useDialogFocus(!review, close);
  const available = connected && !demo;
  useEffect(() => () => controller.current?.abort(), []);
  const addProposals = (incoming: Proposal[]) => {
    setProposals((old) => [
      ...old,
      ...incoming.map((item) => {
        const duplicate = subscriptions.find(
          (s) => duplicateKey(s) === duplicateKey(item),
        );
        return duplicate && item.operation === "add"
          ? {
              ...item,
              warnings: [
                ...(item.warnings || []),
                `Possible duplicate of ${duplicate.name}. Choose update below if this is the same subscription.`,
              ],
            }
          : item;
      }),
    ]);
    setSavedCount(0);
  };
  const attach = async (files: FileList | null) => {
    if (!files) return;
    setError("");
    const selected = Array.from(files);
    const existingBytes = attachments.reduce(
      (total, file) =>
        total + Math.ceil(((file.dataUrl.split(",")[1]?.length || 0) * 3) / 4),
      0,
    );
    if (
      existingBytes + selected.reduce((total, file) => total + file.size, 0) >
      7 * 1024 * 1024
    ) {
      if (input.current) input.current.value = "";
      setError("Choose images totaling less than 7 MB per message.");
      return;
    }
    if (input.current) input.current.value = "";
    if (selected.length + attachments.length > 3) {
      setError("Choose up to 3 images at a time.");
      return;
    }
    const loaded: Attachment[] = [];
    for (const file of selected) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        setError("Choose a PNG, JPEG, or WebP image.");
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError("Each image must be smaller than 5 MB.");
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      loaded.push({ name: file.name, type: file.type, dataUrl });
    }
    setAttachments((old) => [...old, ...loaded].slice(0, 3));
  };
  const importFile = async (file?: File) => {
    if (csvInput.current) csvInput.current.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Choose a CSV file smaller than 2 MB.");
      return;
    }
    setError("");
    try {
      const result = parseInventoryCsv(await file.text());
      if (!result.length) throw new Error("This CSV has no subscription rows.");
      if (result.length + proposals.length > 100)
        throw new Error("Review up to 100 subscriptions at a time.");
      addProposals(result);
      setFilename(file.name);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not read that CSV file. Nothing was saved.",
      );
    }
  };
  const send = async () => {
    if (
      (!message.trim() && !attachments.length) ||
      sendLock.current ||
      !available ||
      saving ||
      pendingBatch.current
    )
      return;
    sendLock.current = true;
    setBusy(true);
    setError("");
    const text = message.trim();
    const request = new AbortController();
    controller.current = request;
    try {
      const result = await api<{ reply: string; proposals: unknown[] }>(
        "/api/chat",
        {
          method: "POST",
          signal: request.signal,
          body: JSON.stringify({
            message: text,
            attachments,
            history: boundedChatHistory(
              messages.map((item) => ({ role: item.role, content: item.text })),
            ),
          }),
        },
      );
      if (request.signal.aborted) return;
      const incoming = (result.proposals || []).map((item) =>
        proposalSchema.parse(item),
      );
      if (incoming.length + proposals.length > 100)
        throw new Error(
          "Save or remove the existing drafts before adding more. Nothing was saved.",
        );
      setMessages((old) => [
        ...old,
        {
          role: "user",
          text:
            text ||
            `${attachments.length} image${attachments.length > 1 ? "s" : ""} attached`,
        },
        ...(typeof result.reply === "string"
          ? [{ role: "assistant" as const, text: result.reply }]
          : []),
      ]);
      addProposals(incoming);
      setMessage("");
      setAttachments([]);
    } catch (e) {
      if (!request.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Could not reach the AI service. No subscriptions were changed.",
        );
    } finally {
      sendLock.current = false;
      setBusy(false);
      if (controller.current === request) controller.current = null;
    }
  };
  const saveAll = async () => {
    if (
      saveLock.current ||
      busy ||
      !canSave ||
      !proposals.length ||
      reviewed.size !== proposals.length
    )
      return;
    saveLock.current = true;
    setSaving(true);
    setError("");
    try {
      if (!pendingBatch.current) {
        validateReview(proposals, subscriptions);
        pendingBatch.current = { requestId: crypto.randomUUID(), proposals };
      }
      const count = pendingBatch.current.proposals.length;
      await onSaveReview(
        pendingBatch.current.proposals,
        pendingBatch.current.requestId,
      );
      pendingBatch.current = null;
      setSavedCount(count);
      setProposals([]);
      setReviewed(new Set());
      setFilename("");
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : "Could not confirm the save."}${pendingBatch.current ? " Retry to safely confirm the same batch." : ""}`,
      );
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };
  const composerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };
  const updateProposal = (id: string, changes: Partial<Proposal>) => {
    setProposals((old) =>
      old.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
    setReviewed((old) => {
      const next = new Set(old);
      next.delete(id);
      return next;
    });
  };
  const locked = saving || !!pendingBatch.current;
  return (
    <>
      <div
        className="drawer-backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div
          className="import-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-title"
          ref={ref}
        >
          <header className="drawer-header">
            <span className="ai-symbol">
              {mode === "chat" ? (
                <Sparkles size={20} />
              ) : (
                <FileText size={20} />
              )}
            </span>
            <div>
              <h2 id="import-title">
                {mode === "chat"
                  ? "A little help from Saldo"
                  : "Bring your subscriptions home"}
              </h2>
              <span className={`ai-state ${available ? "ready" : ""}`}>
                <i />
                {mode === "csv"
                  ? "Private import · review before saving"
                  : available
                    ? "AI connected"
                    : "AI not connected"}
              </span>
            </div>
            <button
              className="icon-button"
              disabled={saving}
              onClick={close}
              aria-label="Close import"
            >
              <X size={21} />
            </button>
          </header>
          <div
            className="import-tabs"
            role="tablist"
            aria-label="Import method"
          >
            <button
              role="tab"
              aria-selected={mode === "csv"}
              onClick={() => setMode("csv")}
              disabled={busy || saving}
            >
              <FileText size={15} /> Import CSV
            </button>
            <button
              role="tab"
              aria-selected={mode === "chat"}
              onClick={() => setMode("chat")}
              disabled={busy || saving}
            >
              <Sparkles size={15} /> Chat with Saldo
            </button>
          </div>
          <div className="drawer-content">
            {mode === "chat" ? (
              <>
                <div className="ai-intro">
                  <span className="ai-welcome-symbol">
                    <Sparkles size={28} strokeWidth={1.4} />
                  </span>
                  <h3>
                    Less typing.
                    <br />
                    More living.
                  </h3>
                  <p>
                    Share a receipt, a screenshot, or a few words. Review every
                    detail before anything is saved.
                  </p>
                </div>
                <div className="ai-privacy">
                  <ShieldCheck size={16} />
                  <span>
                    Your choice, always. Selected images stay in this browser
                    until you send them. Sending shares them with the configured
                    AI provider.
                  </span>
                </div>
                {!available && (
                  <div className="ai-offline">
                    <span className="offline-dot" />
                    <div>
                      <strong>
                        {demo
                          ? "AI is off in the sample workspace"
                          : "The AI connection isn’t set up yet"}
                      </strong>
                      <p>
                        {demo
                          ? "Explore manual entry or CSV imports here. Real AI requests are only available in your connected private workspace."
                          : "Configure the AI provider on your server to read images and suggest subscriptions. Nothing has been analyzed or saved."}
                      </p>
                      <button className="text-button" onClick={onManual}>
                        Add details manually <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
                {messages.map((item, index) => (
                  <div className={`chat-message ${item.role}`} key={index}>
                    {item.role === "assistant" && (
                      <span>
                        <Sparkles size={14} /> Saldo
                      </span>
                    )}
                    <p>{item.text}</p>
                  </div>
                ))}
              </>
            ) : (
              <>
                <div className="ai-intro csv-intro">
                  <span className="ai-welcome-symbol">
                    <FileText size={28} strokeWidth={1.4} />
                  </span>
                  <h3>
                    A fresh start.
                    <br />
                    No fresh typing.
                  </h3>
                  <p>
                    Bring in an existing subscription inventory. Check the
                    details, then save when you’re ready.
                  </p>
                </div>
                <input
                  ref={csvInput}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={(e) => void importFile(e.target.files?.[0])}
                />
                <button
                  className="csv-upload"
                  disabled={locked}
                  onClick={() => csvInput.current?.click()}
                >
                  <span>
                    <ArrowUpRight size={22} />
                  </span>
                  <strong>Choose a CSV file</strong>
                  <small>Up to 100 subscriptions · maximum 2 MB</small>
                </button>
                {filename && (
                  <div className="import-filename">
                    <FileText size={14} />
                    <span>{filename}</span>
                    <Check size={13} />
                  </div>
                )}
                <div className="ai-privacy csv-privacy">
                  <ShieldCheck size={16} />
                  <span>
                    Your CSV is read in this browser. Only the subscriptions you
                    review are sent to your private workspace when you save.
                    {demo ? " In sample mode, nothing is uploaded." : ""}
                  </span>
                </div>
                <details className="csv-format">
                  <summary>
                    What should my CSV include? <ChevronDown size={13} />
                  </summary>
                  <p>
                    Use a “service” column for the name. Supported details
                    include amount, currency, cadence, status, next_or_end_date,
                    date_type, notes, and source_urls.
                  </p>
                  <p>
                    Dates use YYYY-MM-DD. A date becomes a renewal only when
                    date_type says renewal. Blank amounts and unknown currencies
                    stay unconfirmed.
                  </p>
                </details>
              </>
            )}
            {savedCount > 0 && (
              <div className="import-success">
                <CheckCircle2 size={20} />
                <div>
                  <strong>
                    {savedCount}{" "}
                    {savedCount === 1 ? "subscription" : "subscriptions"} saved.
                  </strong>
                  <p>
                    {demo
                      ? "Saved to your sample workspace only."
                      : "Your overview is up to date."}
                  </p>
                </div>
              </div>
            )}
            {proposals.length > 0 && (
              <div className="proposal-list">
                <div className="proposal-heading">
                  <div className="section-kicker">REVIEW BEFORE SAVING</div>
                  <span>
                    {reviewed.size} of {proposals.length} checked
                  </span>
                </div>
                {proposals.map((item) => (
                  <div
                    className={`review-proposal ${reviewed.has(item.id) ? "checked" : ""}`}
                    key={item.id}
                  >
                    <div className="proposal">
                      <ServiceIcon name={item.name || "?"} size="compact" />
                      <div>
                        <strong>{item.name || "Unnamed subscription"}</strong>
                        <small>
                          {item.amount === null
                            ? "Amount not confirmed"
                            : `${money(item.amount, item.currency)} ${item.currency === "UNK" ? "· unknown currency" : item.currency}`}{" "}
                          · {cadenceNames[item.cadence]}
                        </small>
                      </div>
                      <button
                        className="button secondary small-button"
                        disabled={locked}
                        onClick={() => setReview(item)}
                      >
                        Edit
                      </button>
                      <button
                        className="icon-button"
                        disabled={locked}
                        aria-label={`Remove ${item.name} from import`}
                        onClick={() => {
                          setProposals((old) =>
                            old.filter((p) => p.id !== item.id),
                          );
                          setReviewed((old) => {
                            const next = new Set(old);
                            next.delete(item.id);
                            return next;
                          });
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="proposal-details">
                      <span>{statusNames[item.status]}</span>
                      <span>
                        {item.renewalDate
                          ? `Renews ${displayDate(item.renewalDate)}`
                          : "Renewal not confirmed"}
                      </span>
                    </div>
                    {item.warnings?.length ? (
                      <ul className="proposal-warnings">
                        {item.warnings.map((warning, i) => (
                          <li key={i}>{warning}</li>
                        ))}
                      </ul>
                    ) : null}
                    <label className="proposal-operation">
                      Save as
                      <select
                        disabled={locked}
                        aria-label={`Save operation for ${item.name}`}
                        value={
                          item.operation === "update"
                            ? item.targetId || ""
                            : "__new"
                        }
                        onChange={(e) =>
                          updateProposal(
                            item.id,
                            e.target.value === "__new"
                              ? { operation: "add", targetId: undefined }
                              : {
                                  operation: "update",
                                  targetId: e.target.value,
                                },
                          )
                        }
                      >
                        <option value="__new">New subscription</option>
                        {subscriptions.map((s) => (
                          <option key={s.id} value={s.id}>
                            Update {s.name} ({s.currency})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="review-check">
                      <input
                        type="checkbox"
                        disabled={locked}
                        checked={reviewed.has(item.id)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setReviewed((old) => {
                            const next = new Set(old);
                            if (checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          });
                        }}
                      />
                      <span>I’ve checked these details</span>
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="composer-area">
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            {proposals.length > 0 && (
              <div className="review-save">
                <button
                  className="button primary"
                  disabled={
                    !canSave ||
                    busy ||
                    saving ||
                    reviewed.size !== proposals.length
                  }
                  onClick={() => void saveAll()}
                >
                  {saving ? (
                    <span className="loader small" />
                  ) : (
                    <Check size={16} />
                  )}
                  {saving
                    ? "Saving…"
                    : pendingBatch.current
                      ? "Retry this reviewed batch"
                      : `Save ${proposals.length} reviewed ${proposals.length === 1 ? "subscription" : "subscriptions"}`}
                </button>
                <p>
                  {!canSave
                    ? "Connect your private workspace to save, or use sample mode."
                    : reviewed.size !== proposals.length
                      ? "Check every subscription above before saving."
                      : "Only this reviewed batch will be saved."}
                </p>
              </div>
            )}
            {mode === "chat" && (
              <>
                {attachments.length > 0 && (
                  <div className="attachment-list">
                    {attachments.map((file, index) => (
                      <div className="attachment" key={`${file.name}-${index}`}>
                        <img src={file.dataUrl} alt={file.name} />
                        <span>{file.name}</span>
                        <button
                          disabled={busy}
                          aria-label={`Remove ${file.name}`}
                          onClick={() =>
                            setAttachments((old) =>
                              old.filter((_, i) => i !== index),
                            )
                          }
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="composer">
                  <textarea
                    maxLength={12000}
                    aria-label="Message Saldo AI"
                    placeholder={
                      available
                        ? "“I pay $12 a month for Spotify…”"
                        : "AI setup required to send a message"
                    }
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={composerKey}
                    disabled={busy || locked}
                    rows={2}
                  />
                  <div className="composer-actions">
                    <input
                      ref={input}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      hidden
                      onChange={(e) => {
                        void attach(e.target.files).catch(() =>
                          setError(
                            "That image could not be opened. Please choose it again.",
                          ),
                        );
                      }}
                    />
                    <button
                      className="attach-button"
                      onClick={() => input.current?.click()}
                      disabled={busy || locked}
                    >
                      <Paperclip size={17} /> Add image
                    </button>
                    {busy ? (
                      <button
                        className="cancel-ai"
                        onClick={() => controller.current?.abort()}
                      >
                        Cancel request <X size={13} />
                      </button>
                    ) : (
                      <button
                        className="send-button"
                        aria-label="Send to AI for review"
                        disabled={
                          !available ||
                          locked ||
                          (!message.trim() && !attachments.length)
                        }
                        onClick={() => void send()}
                      >
                        <ArrowRight size={19} />
                      </button>
                    )}
                  </div>
                </div>
                <p className="composer-hint">
                  Suggestions are drafts. You’re always in control.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
      {review && (
        <SubscriptionModal
          initial={review}
          reviewing
          demo={demo}
          canSave={!locked}
          onClose={() => setReview(null)}
          onSave={async (value) => {
            updateProposal(review.id, { ...review, ...value, id: review.id });
          }}
          onDelete={async () => {}}
        />
      )}
    </>
  );
}
function HelpModal({ onClose }: { onClose: () => void }) {
  const ref = useDialogFocus(true, onClose);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        ref={ref}
      >
        <header className="modal-header">
          <Logo />
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close help"
          >
            <X size={20} />
          </button>
        </header>
        <div className="modal-intro">
          <h2 id="help-title">A calmer kind of money app.</h2>
          <p>A home for the subscriptions in your life.</p>
        </div>
        <div className="help-list">
          <div>
            <CreditCard size={20} />
            <span>
              <strong>Keep the essentials together</strong>
              <p>
                Add a service, what you pay, and when it renews. Unknown details
                stay unknown until you confirm them.
              </p>
            </span>
          </div>
          <div>
            <TrendingUp size={20} />
            <span>
              <strong>A clear view, without the guesswork</strong>
              <p>
                Monthly and annual figures estimate active recurring costs.
                Weekly costs use 52 weeks a year. Currencies stay separate;
                trials, one-time payments, and unconfirmed amounts aren’t
                counted.
              </p>
            </span>
          </div>
          <div>
            <Sparkles size={20} />
            <span>
              <strong>Review first. Save second.</strong>
              <p>
                When connected, AI can suggest details from text or images. You
                review and save each one. Saldo never cancels or buys a
                subscription for you.
              </p>
            </span>
          </div>
          <div>
            <ShieldCheck size={20} />
            <span>
              <strong>Your private space</strong>
              <p>
                Real data requires an authenticated server. The sample workspace
                is fictional and stays separate.
              </p>
            </span>
          </div>
        </div>
        <button className="button primary" onClick={onClose}>
          Sounds good <Check size={16} />
        </button>
      </div>
    </div>
  );
}
