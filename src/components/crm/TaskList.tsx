import { useId, useState, type FormEvent } from "react";
import { Check, Pencil, Plus, Search } from "lucide-react";
import { today } from "../../types";
import type { NewTaskInput, Task } from "../../crm/types";
import { sortTasks, taskSummary } from "../../crm/taskManagement";
import "./crm.css";

type Filter = "open" | "overdue" | "today" | "done" | "all";
export interface TaskListProps {
  tasks: Task[];
  onAddTask: (input: NewTaskInput) => Promise<void>;
  onToggle: (taskId: string) => Promise<void>;
  onEditTask?: (task: Task, input: NewTaskInput) => Promise<void>;
  onLinkTask?: (task: Task) => Promise<void>;
  assignees?: string[];
  label?: string;
  defaultFilter?: Filter;
}

export default function TaskList({ tasks, onAddTask, onToggle, onEditTask, onLinkTask, assignees = [], label = "Tasks", defaultFilter = "all" }: TaskListProps) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignee, setAssignee] = useState("");
  const [editing, setEditing] = useState<Task>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>(defaultFilter);
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("");
  const date = today();
  const summary = taskSummary(tasks, date);
  const owners = [...new Set([...assignees, ...tasks.map(task => task.assignee || "")].filter(Boolean))].sort();
  const visible = sortTasks(tasks).filter(task => {
    if (filter === "open" && task.status !== "open") return false;
    if (filter === "done" && task.status !== "done") return false;
    if (filter === "overdue" && !(task.status === "open" && task.dueDate && task.dueDate < date)) return false;
    if (filter === "today" && !(task.status === "open" && task.dueDate === date)) return false;
    return (!owner || task.assignee === owner) && `${task.title} ${task.assignee || ""}`.toLowerCase().includes(search.toLowerCase());
  });

  function reset() { setTitle(""); setDueDate(""); setAssignee(""); setEditing(undefined); }
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    await perform(async () => {
      const input = { title: title.trim(), dueDate: dueDate || undefined, assignee: assignee.trim() || undefined };
      if (editing && onEditTask) await onEditTask(editing, input);
      else await onAddTask(input);
      reset();
    });
  }

  return <section className="crm-section task-manager" aria-label={label}>
    <div className="crm-section-head"><h2>{label} <span className="count">{summary.open} open</span></h2>
      <span className="task-completion">{summary.completed}/{tasks.length} complete</span></div>
    {error && <p className="notice danger" role="alert">{error}</p>}
    <form className="crm-task-form" onSubmit={submit}>
      <div className="crm-field task-title-field"><label htmlFor={`${id}-title`}>{editing ? "Edit task" : "Task"}</label>
        <input id={`${id}-title`} value={title} maxLength={1000} onChange={event => setTitle(event.target.value)} placeholder="What needs to happen next?" required /></div>
      <div className="crm-field"><label htmlFor={`${id}-owner`}>Assignee</label>
        <input id={`${id}-owner`} list={`${id}-people`} value={assignee} maxLength={300} onChange={event => setAssignee(event.target.value)} placeholder="Who owns it?" />
        <datalist id={`${id}-people`}>{owners.map(name => <option key={name} value={name} />)}</datalist></div>
      <div className="crm-field"><label htmlFor={`${id}-due`}>Due date</label>
        <input id={`${id}-due`} type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></div>
      <div className="button-row"><button className="button primary" disabled={busy || !title.trim()} type="submit"><Plus size={16} />{editing ? "Save task" : "Add task"}</button>
        {editing && <button className="button" disabled={busy} type="button" onClick={reset}>Cancel editing</button>}</div>
    </form>
    <div className="task-filter-row" aria-label="Task filters">
      {([["open", "Open", summary.open], ["overdue", "Overdue", summary.overdue], ["today", "Due today", summary.dueToday], ["done", "Completed", summary.completed], ["all", "All", tasks.length]] as const).map(([value, text, count]) =>
        <button type="button" key={value} className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{text} <span>{count}</span></button>)}
    </div>
    {tasks.length > 0 && <div className="task-search-row">
      <label className="task-search"><Search size={16} /><input aria-label={`Search ${label.toLowerCase()}`} placeholder="Search tasks" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <select aria-label="Filter tasks by assignee" value={owner} onChange={event => setOwner(event.target.value)}><option value="">All assignees</option>{owners.map(name => <option key={name}>{name}</option>)}</select>
    </div>}
    {visible.length ? <ul className="crm-task-list">{visible.map(task => {
      const overdue = task.status === "open" && !!task.dueDate && task.dueDate < date;
      return <li key={task.id} className={`crm-task${task.status === "done" ? " is-done" : ""}${overdue ? " is-overdue" : ""}`}>
        <input type="checkbox" className="crm-task-checkbox" checked={task.status === "done"} disabled={busy}
          onChange={() => void perform(() => onToggle(task.id))} aria-label={`Mark "${task.title}" ${task.status === "done" ? "not done" : "done"}`} />
        <div className="crm-task-main"><strong>{task.title}</strong><small>{task.assignee || "Unassigned"} · {task.dueDate ? `Due ${task.dueDate}` : "No due date"}{overdue ? " · Overdue" : ""}</small></div>
        {task.status === "done" && <span className="crm-task-done"><Check size={14} />Done</span>}
        {onLinkTask && <button className="button small" disabled={busy} onClick={() => void perform(() => onLinkTask(task))}>Link to this job</button>}
        {onEditTask && <button className="icon-button" type="button" disabled={busy} aria-label={`Edit task ${task.title}`} onClick={() => {
          setEditing(task); setTitle(task.title); setDueDate(task.dueDate || ""); setAssignee(task.assignee || "");
          document.getElementById(`${id}-title`)?.focus();
        }}><Pencil size={16} /></button>}
      </li>;
    })}</ul> : <p className="crm-empty">{tasks.length ? "No tasks match this view." : "No tasks yet. Add the next action, assign an owner, and set a deadline."}</p>}
  </section>;
}
