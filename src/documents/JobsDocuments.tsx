import { useEffect, useMemo, useState } from "react";
import { FileText, Plus, Search } from "lucide-react";
import type { ChangeRequest, JobEntry, RequestSummary } from "../types";
import type { RequestDraft } from "../services/requestDrafts";
import type { WorkspaceRow } from "../workspaces/types";
import { createWorkspace } from "../workspaces/model";
import {
  cachedWorkspaces,
  refreshWorkspaces,
  refreshWorkspacesInBackground,
  saveWorkspaceLocally,
  subscribeWorkspaces,
} from "../services/workspaces";
import { syncWorkspaces } from "../services/workspaces";
import { importWorkspaceLocally } from "../workspaces/importStore";
import {
  listCustomers,
  subscribeCrm,
  type CustomerSummary,
} from "../crm";
import { customerOptions } from "../services/customerDirectory";
import CustomerList from "../components/crm/CustomerList";
import JobWorkspace from "./JobWorkspace";
import { unifiedRecords, openUnifiedRecord, type UnifiedRecord } from "../services/unifiedRecords";
import { requestBelongsToRecord } from "../services/recordRequests";
import { CustomerImportPage } from "./components/CustomerImportPage";
import WorkspaceMigration from "./WorkspaceMigration";
import "./workspace.css";
import "./documents.css";

export default function JobsDocuments({
  workspaceId,
  initialTool,
  jobs,
  requests,
  onOpenWorkspace,
  onOpenCustomer,
  onResumeDraft,
  onNewRequest,
  onOpenRequest,
  onBack,
}: {
  workspaceId?: string;
  initialTool?: "migration" | "reference";
  jobs: JobEntry[];
  requests: RequestSummary[];
  onOpenWorkspace: (id: string) => void;
  onOpenCustomer: (id: string) => void;
  onResumeDraft: (draft: RequestDraft) => void;
  onNewRequest: (request: ChangeRequest) => void;
  onOpenRequest: (id: string) => void;
  onBack: () => void;
}) {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [limit, setLimit] = useState(50);
  const [tool, setTool] = useState<"jobs" | "migration" | "reference">("jobs");
  useEffect(() => setTool(initialTool || "jobs"), [initialTool]);
  useEffect(() => {
    let active = true;
    const read = () =>
      void listCustomers()
        .then((value) => {
          if (active) setCustomers(value);
        })
        .catch(() => undefined);
    read();
    const unsubscribe = subscribeCrm(read);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const directory = useMemo(() => [...jobs, ...customerOptions(jobs, customers)], [jobs, customers]);
  useEffect(() => {
    let active = true;
    const read = async () => {
      const cached = await cachedWorkspaces();
      if (active) setRows(cached);
    };
    void read().catch((value) => active && setError(String(value)));
    void refreshWorkspacesInBackground()
      .then(() => {
        if (active) setError("");
      })
      .catch(
        (value) =>
          active &&
          setError(value instanceof Error ? value.message : String(value)),
      );
    const unsubscribe = subscribeWorkspaces(
      () => void read().catch((value) => active && setError(String(value))),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const workspace = createWorkspace();
      await saveWorkspaceLocally(workspace);
      onOpenWorkspace(workspace.id);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally { setBusy(false); }
  }

  async function openRecord(record: UnifiedRecord) {
    setBusy(true);
    setError("");
    try { onOpenWorkspace((await openUnifiedRecord(record)).id); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  }

  const records = useMemo(() => unifiedRecords(rows, jobs, customers), [rows, jobs, customers]);
  useEffect(() => setLimit(50), [search]);
  if (workspaceId)
    return (
      <JobWorkspace
        key={workspaceId}
        id={workspaceId}
        requests={requests}
        jobs={directory}
        customers={customers}
        onNewRequest={onNewRequest}
        onOpenRequest={onOpenRequest}
        onResumeDraft={onResumeDraft}
        onBack={onBack}
      />
    );
  const query = search.trim().toLowerCase();
  const visible = records
    .filter((row) =>
      [
        row.name, row.jobNumber, row.address, row.phone, row.email,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className="documents-workspace jobs-documents">
      <div className="workspace-title">
        <div>
          <p className="workspace-eyebrow">Customer & job directory</p>
          <h1>Jobs & Customers</h1>
          <p>
            Open a dashboard for job details, changes, documents, and follow-ups.
          </p>
        </div>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void create()}
        >
          <Plus size={18} />
          New job
        </button>
      </div>
      {tool !== "jobs" && (
        <div className="workspace-tools">
          <button className="button" onClick={() => setTool("jobs")}>
            Back to saved jobs
          </button>
        </div>
      )}

      {error && (
        <div className="notice danger" role="alert">
          {error}
          <button
            className="button small"
            onClick={() =>
              void refreshWorkspaces()
                .then(() => setError(""))
                .catch((value) => setError(String(value)))
            }
          >
            Retry connection
          </button>
        </div>
      )}
      {tool === "migration" ? (
        <WorkspaceMigration
          workspaces={rows.map((row) => row.workspace)}
          onImport={async (workspace) => {
            await importWorkspaceLocally(
              workspace,
              rows.find((row) => row.workspace.id === workspace.id)?.workspace,
            );
            setRows(await cachedWorkspaces());
            void syncWorkspaces().catch(() => undefined);
          }}
          onDone={() => setTool("jobs")}
        />
      ) : tool === "reference" ? (
        <CustomerImportPage canImport onOpenIntake={() => setTool("jobs")} />
      ) : (
        <>
          <label className="workspace-search">
            <Search size={18} />
            <input
              aria-label="Search jobs and customers"
              placeholder="Search customer, job number, or address"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <section className="workspace-panel">
            <h2>
              All jobs &amp; customers <span className="workspace-count">{records.length}</span>
            </h2>
            {visible.length ? (
              visible.slice(0, limit).map(record => {
                const changes = requests.filter(request => requestBelongsToRecord(request, {
                  id: record.workspace?.workspace.id || "", jobNumber: record.jobNumber,
                  name: record.name, address: record.address,
                }));
                const row = record.workspace;
                return <button className="workspace-list-row" key={record.id} disabled={busy}
                  onClick={() => void openRecord(record)}>
                  <FileText size={22} /><span>
                    <strong>{record.name || "Untitled job"}</strong>
                    <small>{[record.jobNumber, record.address].filter(Boolean).join(" · ") || "Customer details in progress"}</small>
                    <small>{record.status} · {changes.length} change{changes.length === 1 ? "" : "s"}
                      {row?.conflict ? " · Conflicting edits need review" : row?.error ? " · Sync needs attention" : row?.dirty || row?.inFlight ? " · Saved on device" : ""}</small>
                  </span><span>Open dashboard →</span>
                </button>;
              })
            ) : (
              <p>
                {records.length
                  ? "No jobs or customers match your search."
                  : "Upload your customer/job CSV in Tools or create a job to start its dashboard."}
              </p>
            )}
          </section>
          {visible.length > limit && <button className="button" onClick={() => setLimit(value => value + 50)}>Show more jobs &amp; customers ({visible.length - limit} remaining)</button>}
          <details className="workspace-panel" onToggle={event => setContactsOpen(event.currentTarget.open)}>
            <summary>Manage customer contacts &amp; follow-ups</summary>
            {contactsOpen && <CustomerList onOpen={onOpenCustomer} />}
          </details>
        </>
      )}
    </div>
  );
}
