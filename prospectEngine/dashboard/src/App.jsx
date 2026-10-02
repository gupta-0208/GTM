import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Compass,
  ExternalLink,
  Globe2,
  LoaderCircle,
  Mail,
  Plus,
  Play,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const API = "/api";
const DEFAULT_QUERY = "Find companies that match the selected product's ideal customer profile";
const STORED_RUN_KEY = "prospect-engine.active-run";
const PRODUCTS_KEY = "prospect-engine.products";
const DEFAULT_PRODUCT = {
  id: "linkassist",
  name: "LinkAssist",
  product_description: "LinkedIn authority, consistent content, personal brand, and inbound client acquisition",
  ideal_customer: "India-based founders, consultants, coaches, and agency owners at B2B service businesses who use LinkedIn to build authority and attract clients",
  company_types: ["B2B SaaS", "software companies", "marketing agencies", "consulting firms", "recruitment agencies", "business coaches", "financial consultancies", "legal consultancies", "architecture firms", "IT services companies", "B2B professional services"],
  industries: ["software", "marketing", "consulting", "recruitment", "professional services"],
  location: "India",
};

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function readSavedRun() {
  try {
    return JSON.parse(localStorage.getItem(STORED_RUN_KEY) || "null");
  } catch {
    return null;
  }
}

function readProducts() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRODUCTS_KEY) || "null");
    return Array.isArray(saved) && saved.length ? saved : [DEFAULT_PRODUCT];
  } catch {
    return [DEFAULT_PRODUCT];
  }
}

function prettyDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function companyName(record) {
  return record.payload?.company_name || record.payload?.legal_name || record.source_ref?.replace(/^https?:\/\//, "").split("/")[0] || "Unnamed company";
}

function initials(value = "") {
  return value.split(/[\s.-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function qualificationLabel(value) {
  if (value === "qualified") return "Qualified";
  if (value === "not_qualified") return "Not a fit";
  return "Needs review";
}

function App() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [products, setProducts] = useState(readProducts);
  const [activeProductId, setActiveProductId] = useState(() => localStorage.getItem("prospect-engine.active-product") || DEFAULT_PRODUCT.id);
  const [profileDialog, setProfileDialog] = useState(null);
  const [profileForm, setProfileForm] = useState(null);
  const [searchDiagnostic, setSearchDiagnostic] = useState(null);
  const [diagnosingSearch, setDiagnosingSearch] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [loadingData, setLoadingData] = useState(true);
  const [apiReady, setApiReady] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [activeRun, setActiveRun] = useState(readSavedRun);
  const [job, setJob] = useState(null);
  const [tab, setTab] = useState("companies");
  const [filter, setFilter] = useState("all");
  const [productScope, setProductScope] = useState("all");
  const [indexQuery, setIndexQuery] = useState("");
  const [indexResults, setIndexResults] = useState(null);
  const [searchingIndex, setSearchingIndex] = useState(false);
  const [sources, setSources] = useState([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [savingSource, setSavingSource] = useState(false);
  const [sourceJob, setSourceJob] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadDashboard = useCallback(async () => {
    setLoadingData(true);
    try {
      const [data, readiness] = await Promise.all([
        request("/dashboard"),
        request("/ready"),
      ]);
      setDashboard(data);
      setApiReady(readiness.ok);
      setError("");
    } catch (cause) {
      setApiReady(false);
      setError(cause.message);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard, refreshKey]);

  useEffect(() => {
    if (!activeRun?.jobId) return undefined;
    let cancelled = false;
    let timer;

    const poll = async () => {
      try {
        const nextJob = await request(`/jobs/${encodeURIComponent(activeRun.jobId)}`);
        if (cancelled) return;
        setJob(nextJob);
        const nextRun = { ...activeRun, state: nextJob.state, progress: nextJob.progress, result: nextJob.result };
        setActiveRun(nextRun);
        localStorage.setItem(STORED_RUN_KEY, JSON.stringify(nextRun));

        if (nextJob.state === "completed" || nextJob.state === "failed") {
          if (nextJob.state === "completed") {
            setNotice("Finder run completed. The latest records are shown below.");
            setRefreshKey((value) => value + 1);
          } else {
            setError(nextJob.failedReason || "Finder run failed. Check worker logs for details.");
          }
          return;
        }
      } catch (cause) {
        if (!cancelled) setError(cause.message);
      }
      if (!cancelled) timer = window.setTimeout(poll, 1800);
    };

    poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeRun?.jobId]);

  const scopedRecords = useMemo(() => {
    const records = dashboard?.records || [];
    if (productScope === "all") return records;
    if (productScope === "__unassigned__") return records.filter((record) => !record.product_id);
    return records.filter((record) => record.product_id === productScope);
  }, [dashboard, productScope]);
  const companies = useMemo(() => scopedRecords.filter((record) => record.record_type === "company"), [scopedRecords]);
  const contacts = useMemo(() => scopedRecords.filter((record) => record.record_type === "contact"), [scopedRecords]);
  const visibleCompanies = useMemo(() => filter === "all" ? companies : companies.filter((record) => record.qualification_status === filter), [companies, filter]);
  const displayedCompanies = useMemo(() => {
    const source = indexResults === null ? visibleCompanies : indexResults;
    const byProduct = productScope === "all"
      ? source
      : productScope === "__unassigned__"
        ? source.filter((record) => !record.product_id)
        : source.filter((record) => record.product_id === productScope);
    return filter === "all" ? byProduct : byProduct.filter((record) => record.qualification_status === filter);
  }, [indexResults, visibleCompanies, productScope, filter]);
  const productOptions = useMemo(() => {
    const saved = new Map(products.map((product) => [product.id, product.name]));
    for (const record of dashboard?.records || []) {
      if (record.product_id && !saved.has(record.product_id)) saved.set(record.product_id, record.product_name || record.product_id);
    }
    return [...saved.entries()];
  }, [products, dashboard]);
  const isRunning = Boolean(activeRun?.jobId && !["completed", "failed"].includes(activeRun.state));
  const isHarvestingSources = Boolean(sourceJob?.jobId && !["completed", "failed"].includes(sourceJob.state));
  const runStage = activeRun?.progress?.stage || activeRun?.state || "waiting";
  const activeProduct = products.find((product) => product.id === activeProductId) || products[0] || DEFAULT_PRODUCT;

  useEffect(() => {
    if (query === DEFAULT_QUERY) setQuery(activeProduct.ideal_customer || DEFAULT_QUERY);
  }, [activeProduct, query]);

  useEffect(() => {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
    localStorage.setItem("prospect-engine.active-product", activeProductId);
    if (!products.some((product) => product.id === activeProductId)) {
      setActiveProductId(products[0]?.id || DEFAULT_PRODUCT.id);
    }
  }, [products, activeProductId]);

  useEffect(() => {
    let cancelled = false;
    request(`/index/sources?product_id=${encodeURIComponent(activeProduct.id)}`)
      .then((result) => { if (!cancelled) setSources(result.sources || []); })
      .catch((cause) => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, [activeProduct.id, refreshKey]);

  useEffect(() => {
    if (!sourceJob?.jobId) return undefined;
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const nextJob = await request(`/jobs/${encodeURIComponent(sourceJob.jobId)}`);
        if (cancelled) return;
        setSourceJob({ ...sourceJob, state: nextJob.state, progress: nextJob.progress, result: nextJob.result });
        if (nextJob.state === "completed") {
          const found = nextJob.result?.candidatesFound ?? 0;
          const saved = nextJob.result?.extraction?.companyRecords ?? 0;
          setNotice(`Source harvest completed: ${found} company domains found; ${saved} company records saved.`);
          setRefreshKey((value) => value + 1);
          return;
        }
        if (nextJob.state === "failed") {
          setError(nextJob.failedReason || "Source harvest failed. Check worker logs.");
          return;
        }
      } catch (cause) {
        if (!cancelled) setError(cause.message);
      }
      if (!cancelled) timer = window.setTimeout(poll, 1600);
    };
    poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [sourceJob?.jobId]);

  async function startFinder(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      const submitted = await request("/finder", { method: "POST", body: JSON.stringify({ query, icp: activeProduct }) });
      const run = { jobId: submitted.jobId, query, productName: activeProduct.name, state: "waiting", createdAt: new Date().toISOString() };
      setActiveRun(run);
      setJob(null);
      localStorage.setItem(STORED_RUN_KEY, JSON.stringify(run));
      setNotice("Finder queued. Discovery, crawling, and extraction will run in sequence.");
    } catch (cause) {
      setError(cause.message);
    }
  }

  async function testSearch() {
    setError("");
    setSearchDiagnostic(null);
    setDiagnosingSearch(true);
    try {
      const result = await request(`/search/diagnostic?query=${encodeURIComponent(query)}`);
      setSearchDiagnostic(result);
    } catch (cause) {
      setError(`Search check failed: ${cause.message}`);
    } finally {
      setDiagnosingSearch(false);
    }
  }

  async function searchLocalIndex(event) {
    event.preventDefault();
    if (indexQuery.trim().length < 2) return;
    setSearchingIndex(true);
    try {
      const params = new URLSearchParams({ query: indexQuery.trim(), limit: "100" });
      if (productScope !== "all" && productScope !== "__unassigned__") params.set("product_id", productScope);
      const result = await request(`/index/search?${params}`);
      setIndexResults(result.records || []);
      setError("");
    } catch (cause) {
      setError(cause.message);
    } finally {
      setSearchingIndex(false);
    }
  }

  async function addSource(event) {
    event.preventDefault();
    if (!sourceUrl.trim()) return;
    setSavingSource(true);
    try {
      const result = await request("/index/sources", {
        method: "POST",
        body: JSON.stringify({ product_id: activeProduct.id, product_name: activeProduct.name, source_url: sourceUrl.trim() }),
      });
      setSources((current) => [result.source, ...current.filter((source) => source.id !== result.source.id)]);
      setSourceUrl("");
      setError("");
    } catch (cause) {
      setError(cause.message);
    } finally {
      setSavingSource(false);
    }
  }

  async function removeSource(sourceId) {
    try {
      await request(`/index/sources/${sourceId}?product_id=${encodeURIComponent(activeProduct.id)}`, { method: "DELETE" });
      setSources((current) => current.filter((source) => source.id !== sourceId));
    } catch (cause) {
      setError(cause.message);
    }
  }

  async function harvestSources() {
    setError("");
    setNotice("");
    try {
      const submitted = await request("/index/harvest", { method: "POST", body: JSON.stringify({ icp: activeProduct }) });
      setSourceJob({ jobId: submitted.jobId, state: "waiting" });
    } catch (cause) {
      setError(cause.message);
    }
  }

  function clearLocalIndexSearch() {
    setIndexQuery("");
    setIndexResults(null);
  }

  function openProfileDialog(mode) {
    if (mode === "new") {
      setProfileForm({ name: "", product_description: "", ideal_customer: "", companyTypesText: "", industriesText: "", location: "" });
    } else {
      setProfileForm({ ...activeProduct, companyTypesText: (activeProduct.company_types || []).join(", "), industriesText: (activeProduct.industries || []).join(", ") });
    }
    setProfileDialog(mode);
  }

  function saveProfile(event) {
    event.preventDefault();
    const saved = {
      id: profileDialog === "new" ? `product-${crypto.randomUUID()}` : activeProduct.id,
      name: profileForm.name.trim(),
      product_description: profileForm.product_description.trim(),
      ideal_customer: profileForm.ideal_customer.trim(),
      company_types: profileForm.companyTypesText.split(/[,;\n]/).map((value) => value.trim()).filter(Boolean),
      industries: profileForm.industriesText.split(/[,;\n]/).map((value) => value.trim()).filter(Boolean),
      location: profileForm.location.trim(),
    };
    if (!saved.name || !saved.ideal_customer || !saved.company_types.length) return;
    setProducts((current) => profileDialog === "new" ? [...current, saved] : current.map((product) => product.id === saved.id ? saved : product));
    setActiveProductId(saved.id);
    if (profileDialog === "new" || query === activeProduct.ideal_customer) setQuery(saved.ideal_customer);
    setProfileDialog(null);
  }

  function exportCompanies(records = visibleCompanies) {
    const rows = records.map((record) => ({
      company: companyName(record),
      domain: record.source_ref?.replace(/^https?:\/\//, "").split("/")[0] || "",
      qualification: record.qualification_status || "review",
      description: record.payload?.company_description || "",
      source: record.source_ref || "",
      confidence: record.confidence ?? "",
    }));
    const header = Object.keys(rows[0] || { company: "", domain: "", qualification: "", description: "", source: "", confidence: "" });
    const csv = [header, ...rows.map((row) => header.map((key) => row[key]))]
      .map((line) => line.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "prospect-engine-companies.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><Compass size={21} strokeWidth={2.2} /></div>
          <div><strong>Prospect Engine</strong><span>MULTI-PRODUCT ICP</span></div>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <a className="nav-item active" href="#finder"><Search size={17} /> Finder <span className="nav-dot" /></a>
          <a className="nav-item" href="#prospects"><Building2 size={17} /> Prospects</a>
          <a className="nav-item" href="#activity"><Activity size={17} /> Activity</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="api-card">
            <span className={`status-dot ${apiReady ? "online" : "offline"}`} />
            <div><strong>{apiReady ? "Engine online" : "Engine offline"}</strong><span>Local environment</span></div>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setRefreshKey((value) => value + 1)} aria-label="Refresh connection"><RefreshCw size={16} /></Button>
          </div>
          <div className="sidebar-footer"><span>Prospect Engine</span><span>v1.0</span></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>Finder</strong></div>
          <div className="topbar-actions">
            <span className="env-pill"><span className="status-dot online" /> Local instance</span>
            <button className="avatar" title="Local user">S</button>
          </div>
        </header>

        <div className="page-content">
          <section className="page-heading" id="finder">
            <div><p className="eyebrow">DISCOVERY WORKSPACE</p><h1>Find customers for any product</h1><p className="subtitle">Search the web, qualify companies against a selected product profile, and review the results.</p></div>
            <Button variant="outline" size="lg" className="refresh-button h-11 px-5 text-sm" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={17} className={loadingData ? "spin" : ""} /> Refresh data</Button>
          </section>

          {error && <div className="alert error-alert"><CircleHelp size={17} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss"><X size={16} /></button></div>}
          {notice && <div className="alert success-alert"><Check size={17} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss"><X size={16} /></button></div>}

          <section className="workspace-grid">
            <Card className="search-card panel">
              <div className="card-heading"><div><div className="section-icon"><Search size={17} /></div><div><h2>Describe your ideal prospects</h2><p>Choose a product profile, then describe the prospects you want to find.</p></div></div><button className="icon-button" onClick={() => openProfileDialog("edit")} title="Edit product ICP"><Settings2 size={17} /></button></div>
              <div className="product-picker"><label htmlFor="product-profile">Product profile</label><div><select id="product-profile" value={activeProduct.id} onChange={(event) => { const nextProduct = products.find((product) => product.id === event.target.value); setActiveProductId(event.target.value); setSearchDiagnostic(null); if (query === DEFAULT_QUERY || query === activeProduct.ideal_customer) setQuery(nextProduct?.ideal_customer || DEFAULT_QUERY); }} disabled={isRunning}>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><Button variant="outline" size="sm" className="h-9 px-3 text-sm" type="button" onClick={() => openProfileDialog("new")} disabled={isRunning}><Plus size={15} /> Add product</Button><Button variant="ghost" size="sm" className="h-9 px-3 text-sm" type="button" onClick={() => openProfileDialog("edit")} disabled={isRunning}>Edit ICP</Button></div></div>
              <form onSubmit={startFinder}>
                <label className="sr-only" htmlFor="query-input">Finder query</label>
                <Textarea id="query-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Describe companies, roles, location, or signals…" rows={5} disabled={isRunning} className="query-input" />
                <div className="query-meta"><span><ShieldCheck size={14} /> {activeProduct.name} ICP applied</span><span>{query.length} characters</span></div>
                <div className="search-footer"><Button variant="ghost" size="lg" className="h-11 px-3 text-sm" type="button" onClick={testSearch} disabled={diagnosingSearch || !query.trim()}>{diagnosingSearch ? <LoaderCircle size={16} className="spin" /> : <Globe2 size={16} />} Test Google search</Button><Button size="lg" className="finder-submit h-12 px-6 text-base" type="submit" disabled={isRunning || !query.trim() || !apiReady}><Play size={17} fill="currentColor" /> {isRunning ? "Finder is running" : "Run finder"}</Button></div>
              </form>
              <div className="source-manager">
                <div className="source-manager-heading"><div><strong>Public sources for {activeProduct.name}</strong><span>Add directories, association member lists, or exhibitor pages to grow the local index.</span></div><Button type="button" size="sm" className="h-9 px-3 text-sm" onClick={harvestSources} disabled={!sources.length || isHarvestingSources || !apiReady}>{isHarvestingSources ? <><LoaderCircle size={14} className="spin" /> Harvesting</> : "Harvest sources"}</Button></div>
                <form className="source-add-form" onSubmit={addSource}><Input type="url" aria-label="Public source URL" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://example.org/member-directory" disabled={savingSource || isHarvestingSources} /><Button type="submit" variant="outline" disabled={savingSource || !sourceUrl.trim()}>{savingSource ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />} Add source</Button></form>
                {sources.length ? <ul className="source-list">{sources.map((source) => <li key={source.id}><div><a href={source.source_url} target="_blank" rel="noreferrer">{source.source_url}<ExternalLink size={11} /></a><span>{source.last_error ? `Last harvest issue: ${source.last_error}` : source.last_crawled_at ? `Last checked ${prettyDate(source.last_crawled_at)} · ${source.last_discovered_count} links found` : "Not harvested yet"}</span></div><button className="source-remove" type="button" onClick={() => removeSource(source.id)} aria-label={`Remove ${source.source_url}`} disabled={isHarvestingSources}><X size={15} /></button></li>)}</ul> : <p className="source-empty">No public sources added for this product yet.</p>}
                {isHarvestingSources && <p className="source-progress"><LoaderCircle size={13} className="spin" /> {sourceJob.progress?.detail || "Waiting for a worker…"}</p>}
              </div>
              {searchDiagnostic && <div className={`search-diagnostic ${searchDiagnostic.resultCount ? "diagnostic-ok" : "diagnostic-empty"}`}><div className="diagnostic-heading"><strong>{searchDiagnostic.resultCount} results</strong><span>Requested: {searchDiagnostic.requestedEngines.join(", ") || "default"} · Returned: {searchDiagnostic.enginesUsed.join(", ") || "none"}</span></div>{searchDiagnostic.unresponsiveEngines.length > 0 && <p>Unavailable engines: {searchDiagnostic.unresponsiveEngines.map((entry) => Array.isArray(entry) ? `${entry[0]} (${entry[1]})` : JSON.stringify(entry)).join("; ")}</p>}<ul>{searchDiagnostic.results.slice(0, 3).map((result) => <li key={result.url}><a href={result.url} target="_blank" rel="noreferrer">{result.title || result.url}<ExternalLink size={11} /></a><span>{result.engine}</span></li>)}</ul></div>}
            </Card>

            <Card className="run-card panel" id="activity">
              <div className="run-card-heading"><div><p className="eyebrow">CURRENT RUN</p><h2>{activeRun?.query ? "Finder activity" : "Ready when you are"}</h2></div><span className={`run-state ${isRunning ? "state-running" : activeRun?.state === "completed" ? "state-done" : activeRun?.state === "failed" ? "state-failed" : "state-idle"}`}>{isRunning ? <><LoaderCircle size={13} className="spin" /> In progress</> : activeRun?.state === "completed" ? <><Check size={13} /> Complete</> : activeRun?.state === "failed" ? <><X size={13} /> Failed</> : "Idle"}</span></div>
              {activeRun?.query ? <>
                <div className="run-query"><strong>{activeRun.productName || "Product"}:</strong> {activeRun.query}</div>
                <div className="pipeline-steps">
                  {["discovery", "crawl", "extraction"].map((stage, index) => {
                    const stages = ["discovery", "crawl", "extraction", "complete"];
                    const currentIndex = stages.indexOf(runStage);
                    const done = activeRun.state === "completed" || currentIndex > index;
                    const current = isRunning && runStage === stage;
                    return <div className={`pipeline-step ${done ? "step-done" : current ? "step-current" : ""}`} key={stage}><div className="step-indicator">{done ? <Check size={13} /> : current ? <LoaderCircle size={13} className="spin" /> : index + 1}</div><div><strong>{stage === "discovery" ? "Discover companies" : stage === "crawl" ? "Crawl websites" : "Extract and qualify"}</strong><span>{current ? activeRun.progress?.detail || "Working…" : done ? "Completed" : "Waiting"}</span></div></div>;
                  })}
                </div>
                {activeRun.result && <div className="run-summary">
                  <div><span>Targets</span><strong>{activeRun.result.discovery?.statistics?.targetsRelevant ?? 0}</strong></div>
                  <div><span>Pages crawled</span><strong>{activeRun.result.crawl?.pagesStored ?? 0}</strong></div>
                  <div><span>Companies extracted</span><strong>{activeRun.result.extraction?.companyRecords ?? 0}</strong></div>
                  <div><span>People extracted</span><strong>{activeRun.result.extraction?.contactRecords ?? 0}</strong></div>
                  {Object.keys(activeRun.result.discovery?.statistics?.searchEngines || {}).length > 0 && <details className="query-details engine-details"><summary>Search result sources</summary><ul>{Object.entries(activeRun.result.discovery.statistics.searchEngines).map(([engine, count]) => <li key={engine}>{engine}: {count}</li>)}</ul></details>}
                  <details className="query-details"><summary>Generated searches ({activeRun.result.discovery?.searchPlan?.search_queries?.length || 0})</summary><ul>{(activeRun.result.discovery?.searchPlan?.search_queries || []).map((searchQuery) => <li key={searchQuery}>{searchQuery}</li>)}</ul></details>
                </div>}
                <div className="run-footer"><span><Clock3 size={13} /> Started {prettyDate(activeRun.createdAt)}</span><button className="text-button" onClick={() => navigator.clipboard?.writeText(activeRun.jobId)}>Copy run ID <ArrowUpRight size={13} /></button></div>
              </> : <div className="empty-run"><div className="empty-run-icon"><Play size={18} /></div><p>Your search progress will appear here.</p><span>Each run goes through discovery, website crawling, and data extraction.</span></div>}
            </Card>
          </section>

          <section className="metrics-grid" aria-label="Prospect data summary">
            <Metric icon={<Building2 size={17} />} label="Companies found" value={dashboard?.summary?.companies} detail="Saved company records" color="blue" loading={loadingData} />
            <Metric icon={<ShieldCheck size={17} />} label="Qualified" value={dashboard?.summary?.qualified} detail="Fit their product ICP" color="green" loading={loadingData} />
            <Metric icon={<Users size={17} />} label="People found" value={dashboard?.summary?.contacts} detail="Contacts from company sites" color="violet" loading={loadingData} />
            <Metric icon={<Globe2 size={17} />} label="Sites crawled" value={dashboard?.targets?.done || 0} detail={`${dashboard?.targets?.failed || 0} crawl failures`} color="amber" loading={loadingData} />
          </section>

          <Card className="results-section panel" id="prospects">
            <div className="results-header">
              <div><p className="eyebrow">YOUR DATABASE</p><h2>Prospect records</h2><p className="results-subtitle">Latest saved companies and people from all finder runs.</p></div>
              <div className="results-actions"><Button variant="outline" size="lg" className="h-11 px-5 text-sm" onClick={() => exportCompanies(displayedCompanies)} disabled={!displayedCompanies.length}><ArrowDownToLine size={17} /> Export CSV</Button></div>
            </div>
              <div className="table-toolbar">
              <div className="tabs" role="tablist">
                <button className={tab === "companies" ? "tab active-tab" : "tab"} onClick={() => setTab("companies")}>Companies <span>{companies.length}</span></button>
                <button className={tab === "contacts" ? "tab active-tab" : "tab"} onClick={() => setTab("contacts")}>People <span>{contacts.length}</span></button>
                <button className={tab === "targets" ? "tab active-tab" : "tab"} onClick={() => setTab("targets")}>Crawl targets <span>{Object.values(dashboard?.targets || {}).reduce((sum, count) => sum + count, 0)}</span></button>
              </div>
              <div className="table-filters"><label className="filter-select"><span className="sr-only">Filter product</span><select value={productScope} onChange={(event) => { setProductScope(event.target.value); setIndexResults(null); }}><option value="all">All products</option>{productOptions.map(([id, name]) => <option value={id} key={id}>{name}</option>)}{(dashboard?.records || []).some((record) => !record.product_id) && <option value="__unassigned__">Unassigned legacy</option>}</select><ChevronDown size={14} /></label>{tab === "companies" && <label className="filter-select"><span className="sr-only">Filter companies</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All fits</option><option value="qualified">Qualified</option><option value="review">Needs review</option><option value="not_qualified">Not a fit</option></select><ChevronDown size={14} /></label>}</div>
            </div>

            {tab === "companies" && <><form className="local-index-search" onSubmit={searchLocalIndex}><Search size={16} /><Input aria-label="Search local company index" value={indexQuery} onChange={(event) => setIndexQuery(event.target.value)} placeholder="Search your saved company index…" /><Button type="submit" variant="outline" disabled={searchingIndex || indexQuery.trim().length < 2}>{searchingIndex ? <LoaderCircle size={15} className="spin" /> : "Search index"}</Button>{indexResults !== null && <Button type="button" variant="ghost" onClick={clearLocalIndexSearch}>Clear</Button>}</form><p className="index-caption">Search runs against company data already saved in your local Postgres database.</p></>}

            {tab === "companies" && <CompanyTable records={displayedCompanies} loading={loadingData || searchingIndex} />}
            {tab === "contacts" && <ContactTable records={contacts} loading={loadingData} />}
            {tab === "targets" && <TargetTable records={dashboard?.recentTargets || []} loading={loadingData} />}
            <div className="table-bottom"><span>{indexResults ? `Showing ${indexResults.length} local index matches` : "Showing up to 100 latest saved records"}</span><button className="text-button" onClick={() => setRefreshKey((value) => value + 1)}>Refresh <RefreshCw size={13} /></button></div>
          </Card>

          <footer className="page-footer"><span>Prospect Engine · Multi-product prospect research</span><a href="http://localhost:3000/ready" target="_blank" rel="noreferrer">API status <ExternalLink size={12} /></a></footer>
        </div>
      </main>
      <Dialog open={Boolean(profileDialog)} onOpenChange={(open) => { if (!open) setProfileDialog(null); }}><DialogContent className="w-[calc(100%-2rem)] max-w-[640px] gap-0 overflow-y-auto p-0"><form className="profile-modal" onSubmit={saveProfile}><div className="modal-heading"><div><p className="eyebrow">PRODUCT SETTINGS</p><DialogTitle className="dialog-title">{profileDialog === "new" ? "Add a product profile" : `Edit ${activeProduct.name} ICP`}</DialogTitle></div></div><label>Product or solution<Input autoFocus value={profileForm?.name || ""} onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })} placeholder="e.g. Product name" required /></label><label>What does it do?<Textarea value={profileForm?.product_description || ""} onChange={(event) => setProfileForm({ ...profileForm, product_description: event.target.value })} placeholder="Describe the product or service" rows={2} /></label><label>Ideal customer profile<Textarea value={profileForm?.ideal_customer || ""} onChange={(event) => setProfileForm({ ...profileForm, ideal_customer: event.target.value })} placeholder="Describe who benefits from this product" rows={3} required /></label><label>Target company types<Input value={profileForm?.companyTypesText || ""} onChange={(event) => setProfileForm({ ...profileForm, companyTypesText: event.target.value })} placeholder="SaaS companies, agencies, manufacturers" required /></label><div className="modal-two-col"><label>Industries<Input value={profileForm?.industriesText || ""} onChange={(event) => setProfileForm({ ...profileForm, industriesText: event.target.value })} placeholder="Software, healthcare, energy" /></label><label>Location<Input value={profileForm?.location || ""} onChange={(event) => setProfileForm({ ...profileForm, location: event.target.value })} placeholder="Any location" /></label></div><p className="modal-note">Profiles are saved in this browser and applied to discovery and company qualification.</p><div className="modal-actions"><Button variant="outline" size="lg" className="h-11 px-5 text-sm" type="button" onClick={() => setProfileDialog(null)}>Cancel</Button><Button size="lg" className="h-11 px-5 text-sm" type="submit">Save product profile</Button></div></form></DialogContent></Dialog>
    </div>
  );
}

function Metric({ icon, label, value, detail, color, loading }) {
  return <div className="metric-card panel"><div className={`metric-icon ${color}`}>{icon}</div><div className="metric-content"><span>{label}</span><strong>{loading ? "…" : Number(value || 0).toLocaleString("en-IN")}</strong><small>{detail}</small></div><ArrowUpRight className="metric-arrow" size={15} /></div>;
}

function CompanyTable({ records, loading }) {
  if (loading && !records.length) return <TableMessage>Loading company records…</TableMessage>;
  if (!records.length) return <TableMessage icon={<Building2 size={20} />} title="No company records yet">Run the finder to discover and qualify companies.</TableMessage>;
  return <div className="table-scroll"><table><thead><tr><th>COMPANY</th><th>PRODUCT</th><th>FIT STATUS</th><th>DESCRIPTION</th><th>CONFIDENCE</th><th>ADDED</th><th /></tr></thead><tbody>{records.map((record) => {
    const name = companyName(record);
    const domain = record.source_ref?.replace(/^https?:\/\//, "").split("/")[0] || "";
    return <tr key={record.id}><td><div className="company-cell"><div className="company-avatar">{initials(name)}</div><div><strong>{name}</strong><span>{domain}</span></div></div></td><td><Badge variant="secondary" className="product-badge">{record.product_name || "Unassigned"}</Badge></td><td><span className={`fit-badge fit-${record.qualification_status || "review"}`}><span />{qualificationLabel(record.qualification_status)}</span></td><td className="description-cell">{record.payload?.company_description || record.payload?.description || "No description extracted"}</td><td><span className="confidence-value">{record.confidence == null ? "—" : `${Math.round(Number(record.confidence) * 100)}%`}</span></td><td className="date-cell">{prettyDate(record.created_at)}</td><td><a className="row-link" href={record.source_ref} target="_blank" rel="noreferrer" aria-label={`Open ${name} source`}><ExternalLink size={14} /></a></td></tr>;
  })}</tbody></table></div>;
}

function ContactTable({ records, loading }) {
  if (loading && !records.length) return <TableMessage>Loading contact records…</TableMessage>;
  if (!records.length) return <TableMessage icon={<Users size={20} />} title="No people found yet">Qualified company websites are checked for public team and contact information.</TableMessage>;
  return <div className="table-scroll"><table><thead><tr><th>PERSON</th><th>PRODUCT</th><th>COMPANY / ROLE</th><th>EMAIL</th><th>CONFIDENCE</th><th>ADDED</th></tr></thead><tbody>{records.map((record) => {
    const person = record.payload?.full_name || "Unnamed person";
    return <tr key={record.id}><td><div className="company-cell"><div className="person-avatar">{initials(person)}</div><div><strong>{person}</strong><span>{record.payload?.role_category?.replaceAll("_", " ") || "Contact"}</span></div></div></td><td><Badge variant="secondary" className="product-badge">{record.product_name || "Unassigned"}</Badge></td><td><div className="role-cell"><strong>{record.payload?.title || "—"}</strong><span>{record.source_ref?.replace(/^https?:\/\//, "").split("/")[0]}</span></div></td><td>{record.payload?.email ? <a className="email-link" href={`mailto:${record.payload.email}`}><Mail size={13} />{record.payload.email}</a> : <span className="muted">Not found</span>}</td><td><span className="confidence-value">{record.confidence == null ? "—" : `${Math.round(Number(record.confidence) * 100)}%`}</span></td><td className="date-cell">{prettyDate(record.created_at)}</td></tr>;
  })}</tbody></table></div>;
}

function TargetTable({ records, loading }) {
  if (loading && !records.length) return <TableMessage>Loading crawl targets…</TableMessage>;
  if (!records.length) return <TableMessage icon={<Globe2 size={20} />} title="No crawl targets yet">Approved company domains appear here after discovery.</TableMessage>;
  return <div className="table-scroll"><table><thead><tr><th>DOMAIN</th><th>PAGE</th><th>STATE</th><th>HTTP</th><th>LAST UPDATED</th></tr></thead><tbody>{records.map((record) => <tr key={record.url}><td><div className="domain-cell"><Globe2 size={15} /><strong>{record.domain}</strong></div></td><td><a className="page-link" href={record.url} target="_blank" rel="noreferrer">{record.title || record.url}<ExternalLink size={12} /></a></td><td><span className={`target-state target-${record.state}`}>{record.state}</span>{record.last_error && <div className="target-error">{record.last_error}</div>}</td><td>{record.last_status_code || "—"}</td><td className="date-cell">{prettyDate(record.updated_at)}</td></tr>)}</tbody></table></div>;
}

function TableMessage({ icon, title, children }) {
  return <div className="table-message"><div className="table-message-icon">{icon || <LoaderCircle size={19} className="spin" />}</div>{title && <strong>{title}</strong>}<span>{children}</span></div>;
}

export default App;
