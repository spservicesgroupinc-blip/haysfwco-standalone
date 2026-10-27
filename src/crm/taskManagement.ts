import type { Activity, Task } from "./types";

/** Customer-wide follow-ups remain separate from this job's assigned work. */
export function tasksForJob(tasks: Task[], workspaceId: string): Task[] {
  return tasks.filter(task => task.workspaceId === workspaceId);
}

export function activitiesForJob(activities: Activity[], workspaceId: string): Activity[] {
  return activities.filter(activity => activity.workspaceId === workspaceId);
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => Number(a.status === "done") - Number(b.status === "done") ||
    (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.createdAt.localeCompare(b.createdAt));
}

export function taskSummary(tasks: Task[], date: string) {
  const open = sortTasks(tasks.filter(task => task.status === "open"));
  const completed = tasks.filter(task => task.status === "done").length;
  return {
    open: open.length,
    overdue: open.filter(task => task.dueDate && task.dueDate < date).length,
    dueToday: open.filter(task => task.dueDate === date).length,
    completed,
    percent: tasks.length ? Math.round(completed / tasks.length * 100) : 0,
    next: open[0],
  };
}
