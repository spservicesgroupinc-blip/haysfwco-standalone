import { useMemo, useRef, useState } from "react";
import { ArrowRight, ClipboardCheck, RefreshCw, Search, X } from "lucide-react";
import type { RequestStatus, RequestSummary } from "../types";
import "./EstimatorDashboard.css";

type QueueFilter = "open" | "all" | RequestStatus;
const FILTERS: { key: QueueFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "submitted", label: "Submitted" },
  { key: "in_review", label: "In review" },
  { key: "needs_information", label: "Needs info" },
  { key: "completed", label: "Completed" },
  { key: "all", label: "All" },
];
const STATUS_LABELS: Record<RequestStatus, string> = {
  submitted: "Submitted",
  in_review: "In review",
  needs_information: "Needs info",
  completed: "Completed",
};
const STATUS_ORDER: Record<RequestStatus, number> = {
  submitted: 0,
  in_review: 1,
  needs_information: 2,
  completed: 3,
};
const receivedTime = (request: RequestSummary) =>
  Date.parse(request.createdAt || request.updatedAt) || 0;

export default function EstimatorDashboard({
  requests,
  onOpen,
  onRefresh,
}: {
  requests: RequestSummary[];
  onOpen: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<QueueFilter>("open");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const refreshingRef = useRef(false);
  const counts = { all: requests.length, open: 0, submitted: 0, in_review: 0, needs_information: 0, completed: 0 };
  for (const request of requests) {
    counts[request.status]++;
    if (request.status !== "completed") counts.open++;
  }
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return requests.filter((request) => {
      const matchesStatus = filter === "all" || (filter === "open" ? request.status !== "completed" : request.status === filter);
      const text = [request.job.customer, request.job.jobNumber, request.job.projectManager, request.job.orderNumber, request.job.address, request.estimatorName].join(" ").toLocaleLowerCase();
      return matchesStatus && (!query || text.includes(query));
    }).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || receivedTime(a) - receivedTime(b) || a.id.localeCompare(b.id));
  }, [requests, filter, search]);

  async function refresh() {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setRefreshMessage("");
    setRefreshError("");
    try {
      await onRefresh();
      setRefreshMessage("Refresh finished.");
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Could not refresh requests. Try again.");
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }

  return (
    <div className="estimator-dashboard">
      <header className="estimator-head">
        <div>
          <p className="workspace-eyebrow">Estimating</p>
          <h1>Estimator dashboard</h1>
          <p>Open a submitted request, review the details, and complete the change order.</p>
        </div>
        <button className="button" disabled={refreshing} onClick={() => void refresh()}>
          <RefreshCw size={16} aria-hidden="true" />
          {refreshing ? "Refreshing…" : "Refresh requests"}
        </button>
      </header>

      <div className="estimator-filters" role="group" aria-label="Filter estimator requests">
        {FILTERS.map(({ key, label }) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label}<span>{counts[key]}</span>
          </button>
        ))}
      </div>

      <div className="estimator-toolbar">
        <label className="search estimator-search">
          <Search size={17} aria-hidden="true" />
          <input type="search" aria-label="Search estimator requests" placeholder="Search customer, job, PM, or estimator…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <p role="status">{visible.length} {visible.length === 1 ? "request" : "requests"} · Submitted first, oldest first</p>
      </div>
      <p className="estimator-refresh-message" role="status">{refreshing ? "Refreshing requests…" : refreshMessage}</p>
      {refreshError && <p className="notice danger" role="alert">{refreshError}</p>}

      <section className="estimator-queue" aria-label="Estimator request queue" aria-busy={refreshing}>
        {visible.length ? (
          <>
            <div className="estimator-columns" aria-hidden="true"><span>Customer / job</span><span>Status</span><span>Request details</span><span>Received</span><span /></div>
            <ul className="estimator-request-list">
              {visible.map((request) => {
                const customer = request.job.customer || "Untitled request";
                const timestamp = receivedTime(request);
                const action = request.status === "completed" ? "View request" : "Review request";
                return (
                  <li key={request.id}>
                    <button className="estimator-request" aria-label={`${request.status === "completed" ? "View completed request" : "Review request"} for ${customer} ${request.job.jobNumber}`} onClick={() => onOpen(request.id)}>
                      <span className="estimator-request-job">
                        <strong>{customer}</strong>
                        <span>{request.job.jobNumber || "Job number not provided"}{request.job.orderNumber ? ` · CO ${request.job.orderNumber}` : ""}</span>
                        <span>PM: {request.job.projectManager || "Not provided"}</span>
                      </span>
                      <span className={`request-status status-${request.status}`}>{STATUS_LABELS[request.status]}</span>
                      <span className="estimator-request-details">
                        <span>{request.changesCount} {request.changesCount === 1 ? "change" : "changes"} · {request.attachmentsCount} {request.attachmentsCount === 1 ? "file" : "files"}</span>
                        <span>{request.estimatorName || "Unassigned"}</span>
                      </span>
                      {timestamp ? <time dateTime={new Date(timestamp).toISOString()}>{new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time> : <span className="estimator-request-date">Date unavailable</span>}
                      <span className="estimator-request-action">{action}<ArrowRight size={16} aria-hidden="true" /></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className="estimator-empty">
            <ClipboardCheck size={30} aria-hidden="true" />
            <h2>{!requests.length ? "No submitted requests yet" : filter === "open" && !search && !counts.open ? "All requests are complete" : "No matching requests"}</h2>
            <p>{!requests.length ? "Requests sent from New request appear here for the estimating team." : "Choose another status or clear your search to see more requests."}</p>
            {(search || filter !== "all") && requests.length > 0 && <button className="button" onClick={() => { setSearch(""); setFilter("all"); }}><X size={16} aria-hidden="true" />Show all requests</button>}
          </div>
        )}
      </section>
    </div>
  );
}
