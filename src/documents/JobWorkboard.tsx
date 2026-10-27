import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, CalendarClock, CheckCircle2, Clock3, Mail, Phone, UserRound } from "lucide-react";
import type { Workspace } from "../workspaces/types";
import { today, type JobStage } from "../types";
import { addNote, createCustomer, createTask, listActivities, listTasks, logCommunication, subscribeCrm, toggleTask, updateTask } from "../crm";
import type { Activity, NewTaskInput, Task } from "../crm/types";
import { activitiesForJob, taskSummary, tasksForJob } from "../crm/taskManagement";
import { pendingCrmMutations } from "../crm/store";
import { syncCrm } from "../crm/sync";
import TaskList from "../components/crm/TaskList";
import ActivityTimeline from "../components/crm/ActivityTimeline";
import "./job-workboard.css";

const stages: { value: JobStage; label: string }[] = [
  { value: "lead", label: "Lead / planning" }, { value: "in_progress", label: "In progress" },
  { value: "complete", label: "Complete" }, { value: "closed", label: "Closed" },
];
const planOf = (job: Workspace) => ({ stage: job.stage || "lead", manager: job.record.team.projectManager,
  start: job.record.checklist.startDate, finish: job.record.checklist.finishDate });

export default function JobWorkboard({ workspace, customerId, onSaveWorkspace, onOpenCustomer, onEditContact }: {
  workspace: Workspace;
  customerId?: string;
  onSaveWorkspace: (update: (latest: Workspace) => Workspace) => Promise<void>;
  onOpenCustomer: (id: string) => void;
  onEditContact: () => void;
}) {
  const id = workspace.customerId || customerId;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [sync, setSync] = useState({ count: 0, error: "" });
  const [plan, setPlan] = useState(() => planOf(workspace));
  const [editingPlan, setEditingPlan] = useState(false);
  const [linkingTask, setLinkingTask] = useState("");
  const [savingPlan, setSavingPlan] = useState(false);
  const [error, setError] = useState("");
  const creatingCustomer = useRef<Promise<string> | null>(null);
  useEffect(() => { if (!editingPlan) setPlan(planOf(workspace)); }, [workspace, editingPlan]);
  useEffect(() => {
    if (!id) return;
    let active = true;
    let generation = 0;
    const read = async () => {
      const current = ++generation;
      const [nextTasks, nextActivities, pending] = await Promise.all([listTasks(id), listActivities(id), pendingCrmMutations()]);
      if (!active || current !== generation) return;
      setTasks(nextTasks); setActivities(nextActivities);
      const related = pending.filter(row => row.kind === "customer" ? row.entity.id === id :
        row.entity.customerId === id && (!row.entity.workspaceId || row.entity.workspaceId === workspace.id));
      setSync({ count: related.length, error: related.find(row => row.error)?.error || "" });
    };
    const refresh = () => { void read().catch(value => active && setError(value instanceof Error ? value.message : String(value))); };
    refresh();
    const unsubscribe = subscribeCrm(refresh);
    return () => { active = false; unsubscribe(); };
  }, [id, workspace.id]);

  async function ensureCustomer(): Promise<string> {
    if (id) return id;
    if (creatingCustomer.current) return creatingCustomer.current;
    creatingCustomer.current = (async () => {
      const { customer } = workspace.record;
      if (!customer.customerName.trim()) throw new Error("Add a customer name in Job Details before assigning work.");
      const saved = await createCustomer({ name: customer.customerName, phone: customer.mainPhone || customer.mobilePhone,
        email: customer.email, address: customer.lossAddress });
      await onSaveWorkspace(latest => ({ ...latest, customerId: saved.id }));
      return saved.id;
    })().finally(() => { creatingCustomer.current = null; });
    return creatingCustomer.current;
  }
  function keepTask(task: Task) { setTasks(current => [...current.filter(row => row.id !== task.id), task]); }
  async function addTask(input: NewTaskInput) { keepTask(await createTask(await ensureCustomer(), { ...input, workspaceId: workspace.id })); }
  async function editTask(task: Task, input: NewTaskInput) { keepTask(await updateTask(task, { ...input, workspaceId: task.workspaceId })); }
  async function complete(taskId: string) {
    const task = tasks.find(row => row.id === taskId);
    if (task) keepTask(await toggleTask(task));
  }
  async function linkTask(task: Task) {
    if (linkingTask) return;
    setLinkingTask(task.id); setError("");
    try { keepTask(await updateTask(task, { title: task.title, dueDate: task.dueDate, assignee: task.assignee, workspaceId: workspace.id })); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setLinkingTask(""); }
  }
  async function savePlan(event: FormEvent) {
    event.preventDefault();
    if (plan.start && plan.finish && plan.finish < plan.start) { setError("The target finish must be on or after the start date."); return; }
    setSavingPlan(true); setError("");
    try {
      await onSaveWorkspace(latest => ({ ...latest, stage: plan.stage,
        record: { ...latest.record, team: { ...latest.record.team, projectManager: plan.manager.trim() },
          checklist: { ...latest.record.checklist, startDate: plan.start, finishDate: plan.finish } } }));
      setEditingPlan(false);
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setSavingPlan(false); }
  }
  const jobTasks = tasksForJob(tasks, workspace.id);
  const summary = taskSummary(jobTasks, today());
  const customerTasks = tasks.filter(task => !task.workspaceId);
  const customerNotes = activities.filter(activity => !activity.workspaceId);
  const team = Object.values(workspace.record.team).filter((name): name is string => typeof name === "string" && !!name.trim());
  const customer = workspace.record.customer;
  const phone = customer.mainPhone || customer.mobilePhone || customer.homePhone;
  const late = !!workspace.record.checklist.finishDate && workspace.record.checklist.finishDate < today() && !["complete", "closed"].includes(workspace.stage || "lead");

  return <section className="job-workboard" aria-label="Job management">
    <header className="job-workboard-head"><div><p className="workspace-eyebrow">The work ahead</p><h2>Job progress & next steps</h2></div>
      <span className={`job-work-sync${sync.error ? " needs-attention" : ""}`} role="status">{sync.error ? "Sync needs attention · saved on this device" : sync.count ? "Saved on device · syncing in background" : "Updates saved"}</span></header>
    {error && <p className="notice danger" role="alert">{error}</p>}
    {sync.error && <p className="notice danger">{sync.error} <button className="button small" onClick={() => void syncCrm().catch(value => setError(value instanceof Error ? value.message : String(value)))}>Retry sync</button></p>}
    <div className="job-work-metrics" aria-label="Task progress">
      <div><Clock3 size={18} /><strong>{summary.open}</strong><span>Open tasks</span></div>
      <div className={summary.overdue ? "is-overdue" : ""}><CalendarClock size={18} /><strong>{summary.overdue}</strong><span>Overdue</span></div>
      <div><CalendarClock size={18} /><strong>{summary.dueToday}</strong><span>Due today</span></div>
      <div><CheckCircle2 size={18} /><strong>{summary.completed}/{jobTasks.length}</strong><span>Tasks complete</span></div>
    </div>
    <div className="job-next-action"><div><p className="workspace-eyebrow">Next action</p><h3>{summary.next?.title || "Set the next step for this job"}</h3>
      <p>{summary.next ? `${summary.next.assignee || "Unassigned"} · ${summary.next.dueDate ? `Due ${summary.next.dueDate}` : "Set a due date"}` : "Add a task below, assign an owner, and give it a due date."}</p></div>
      <span className="job-stage-badge">{stages.find(stage => stage.value === (workspace.stage || "lead"))?.label}</span>
    </div>
    <div className="job-work-grid"><div className="job-work-main">
      <TaskList tasks={jobTasks} label="Job tasks" defaultFilter="open" assignees={team} onAddTask={addTask} onEditTask={editTask} onToggle={complete} />
      <ActivityTimeline label="Job notes & updates" activities={activitiesForJob(activities, workspace.id)}
        onAddNote={async body => { const note = await addNote(await ensureCustomer(), body, undefined, workspace.id); setActivities(current => [...current.filter(row => row.id !== note.id), note]); }}
        onLogCommunication={async input => { const note = await logCommunication(await ensureCustomer(), { ...input, workspaceId: workspace.id }); setActivities(current => [...current.filter(row => row.id !== note.id), note]); }} />
      {(customerTasks.length > 0 || customerNotes.length > 0) && <details className="workspace-panel job-customer-followups"><summary>Customer-wide follow-ups & notes</summary>
        <p>These belong to the customer. Link a follow-up to this job when it is part of this job's work.</p>
        {customerTasks.map(task => <div className="crm-task" key={task.id}><div className="crm-task-main"><strong>{task.title}</strong><small>{task.status === "done" ? "Completed" : "Open"} · {task.assignee || "Unassigned"}</small></div>
          <button className="button small" disabled={!!linkingTask} onClick={() => void linkTask(task)}>Link to this job</button></div>)}
        {customerNotes.slice(0, 5).map(note => <p key={note.id}>{note.body}</p>)}
        {id && <button className="text-button" onClick={() => onOpenCustomer(id)}>Open customer history <ArrowRight size={15} /></button>}
      </details>}
    </div><aside className="job-work-sidebar">
      <section className="crm-section" aria-label="Job plan"><div className="crm-section-head"><h2>Job plan</h2></div>
        <form className="job-plan-form" onSubmit={savePlan}>
          <label>Job status<select value={plan.stage} onChange={event => { setEditingPlan(true); setPlan({ ...plan, stage: event.target.value as JobStage }); }}>{stages.map(stage => <option key={stage.value} value={stage.value}>{stage.label}</option>)}</select></label>
          <label>Project manager<input value={plan.manager} maxLength={300} onChange={event => { setEditingPlan(true); setPlan({ ...plan, manager: event.target.value }); }} /></label>
          <label>Planned start<input type="date" value={plan.start} onChange={event => { setEditingPlan(true); setPlan({ ...plan, start: event.target.value }); }} /></label>
          <label>Target finish<input type="date" value={plan.finish} min={plan.start || undefined} onChange={event => { setEditingPlan(true); setPlan({ ...plan, finish: event.target.value }); }} /></label>
          {late && <p className="job-deadline-warning">Target finish is overdue. Review the remaining tasks and dates.</p>}
          {editingPlan && <div className="button-row"><button className="button primary" disabled={savingPlan}>{savingPlan ? "Saving…" : "Save job plan"}</button><button type="button" className="button" disabled={savingPlan} onClick={() => { setEditingPlan(false); setPlan(planOf(workspace)); }}>Cancel</button></div>}
        </form>
        <div className="job-task-progress"><label htmlFor={`progress-${workspace.id}`}>Task completion <strong>{summary.percent}%</strong></label><progress id={`progress-${workspace.id}`} value={summary.percent} max={100} />
          <small>Based on completed tasks. Job status is managed separately.</small></div>
      </section>
      <section className="crm-section job-work-contact" aria-label="Job contact"><div className="crm-section-head"><h2>Customer & team</h2><UserRound size={17} /></div>
        <strong>{customer.customerName || "Add customer details"}</strong><p>{customer.lossAddress || "No property address added"}</p>
        {phone && <a href={`tel:${phone.replace(/[^+0-9]/g, "")}`}><Phone size={15} />{phone}</a>}
        {customer.email && <a href={`mailto:${customer.email}`}><Mail size={15} />{customer.email}</a>}
        {workspace.record.team.estimator && <p>Estimator · {workspace.record.team.estimator}</p>}
        <button className="text-button" onClick={onEditContact}>Edit contact & job details <ArrowRight size={15} /></button>
        {id && <button className="text-button" onClick={() => onOpenCustomer(id)}>Customer history <ArrowRight size={15} /></button>}
      </section>
    </aside></div>
  </section>;
}
