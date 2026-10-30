import { readFile, writeFile } from "node:fs/promises";

export type Task = {
  id: string;
  title: string;
  done: boolean;
  tags: string[];
  createdAt: string;
};

function isTask(value: unknown): value is Task {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.done === "boolean" &&
    Array.isArray(record.tags) &&
    record.tags.every((tag) => typeof tag === "string") &&
    typeof record.createdAt === "string"
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function loadTasks(filePath: string): Promise<Task[]> {
  try {
    const text = await readFile(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Malformed tasks JSON");
    }

    if (!Array.isArray(parsed) || !parsed.every(isTask)) {
      throw new Error("Malformed tasks JSON");
    }

    return parsed;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err && typeof err === "object" && err.code === "ENOENT") {
      return [];
    }
    if (error instanceof Error && error.message === "Malformed tasks JSON") {
      throw error;
    }
    throw asError(error);
  }
}

export async function saveTasks(filePath: string, tasks: Task[]): Promise<void> {
  try {
    await writeFile(filePath, JSON.stringify(tasks, null, 2), "utf8");
  } catch (error) {
    throw asError(error);
  }
}
