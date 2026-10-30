import { loadTasks, saveTasks } from "./storage.js";
import { computeStats } from "./stats.js";

export type Task = {
  id: string;
  title: string;
  done: boolean;
  tags: string[];
  createdAt: string;
};

export type ListOptions = {
  status?: "all" | "done" | "open";
  tag?: string;
};

export type TaskStats = {
  total: number;
  done: number;
  open: number;
};

function createTaskId(): string {
  const cryptoModule = globalThis.crypto;
  if (cryptoModule && typeof cryptoModule.randomUUID === "function") {
    return cryptoModule.randomUUID();
  }

  const crypto = require("node:crypto") as typeof import("node:crypto");
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function addTask(filePath: string, title: string, tags: string[]): Promise<Task> {
  if (title.trim().length === 0) {
    throw new Error("Invalid task title");
  }

  const tasks = await loadTasks(filePath);
  const task: Task = {
    id: createTaskId(),
    title,
    done: false,
    tags: [...tags],
    createdAt: new Date().toISOString(),
  };
  const updated = [...tasks, task];
  await saveTasks(filePath, updated);
  return task;
}

export async function listTasks(filePath: string, options: ListOptions): Promise<Task[]> {
  const tasks = await loadTasks(filePath);
  return tasks.filter((task) => {
    const statusOk =
      options.status === undefined ||
      options.status === "all" ||
      (options.status === "done" ? task.done : !task.done);
    const tagOk = options.tag === undefined || task.tags.includes(options.tag);
    return statusOk && tagOk;
  });
}

export async function completeTask(filePath: string, id: string): Promise<Task> {
  const tasks = await loadTasks(filePath);
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) {
    throw new Error("Task not found");
  }
  const updatedTask: Task = { ...tasks[index], done: true };
  const updated = tasks.slice();
  updated[index] = updatedTask;
  await saveTasks(filePath, updated);
  return updatedTask;
}

export async function removeTask(filePath: string, id: string): Promise<Task> {
  const tasks = await loadTasks(filePath);
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) {
    throw new Error("Task not found");
  }
  const removed = tasks[index];
  const updated = tasks.slice(0, index).concat(tasks.slice(index + 1));
  await saveTasks(filePath, updated);
  return removed;
}

export async function getStats(filePath: string): Promise<TaskStats> {
  const tasks = await loadTasks(filePath);
  return computeStats(tasks);
}
