/** Task groups in display order. */
export const TASK_GROUPS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today',   label: 'Due today' },
  { key: 'week',    label: 'This week' },
  { key: 'later',   label: 'Later' },
  { key: 'none',    label: 'No date' },
];

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Groups open tasks by due date in the viewer's local time:
 * overdue (before today), today, the rest of this week (through Sunday), later, no date.
 * @returns {Record<'overdue'|'today'|'week'|'later'|'none', object[]>}
 */
export function groupTasks(tasks, now = new Date()) {
  const today = startOfDay(now);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + (7 - ((today.getDay() + 6) % 7)));

  const groups = { overdue: [], today: [], week: [], later: [], none: [] };
  for (const task of tasks) {
    if (!task.dueDate) { groups.none.push(task); continue; }
    const due = new Date(task.dueDate);
    if (due < today) groups.overdue.push(task);
    else if (due < tomorrow) groups.today.push(task);
    else if (due < weekEnd) groups.week.push(task);
    else groups.later.push(task);
  }
  return groups;
}

/** 6×7 grid of dates covering `month` (weeks start on Monday). */
export function monthGrid(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
