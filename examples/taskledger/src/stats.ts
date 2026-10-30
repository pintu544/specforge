export type Task = {
  id: string;
  title: string;
  done: boolean;
  tags: string[];
  createdAt: string;
};

export type TaskStats = {
  total: number;
  done: number;
  open: number;
};

export function computeStats(tasks: Task[]): TaskStats {
  const total = tasks.length;
  let done = 0;

  for (const task of tasks) {
    if (task.done) {
      done += 1;
    }
  }

  return {
    total,
    done,
    open: total - done,
  };
}
