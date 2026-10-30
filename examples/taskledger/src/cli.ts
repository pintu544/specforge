import {
  addTask,
  completeTask,
  getStats,
  listTasks,
  removeTask,
  type ListOptions,
  type Task,
  type TaskStats,
} from "./task-service.js";

export type { ListOptions, Task, TaskStats };

const USAGE = `Usage:
  node dist/cli.js add <title> [--tag <tag>]...
  node dist/cli.js list [--done | --open] [--tag <tag>]
  node dist/cli.js done <id>
  node dist/cli.js remove <id>
  node dist/cli.js stats`;

function writeUsage(): void {
  process.stderr.write(`${USAGE}\n`);
}

function writeError(message: string): void {
  process.stderr.write(`${message}\n`);
}

function isError(value: unknown): value is Error {
  return value instanceof Error;
}

function getFilePath(): string {
  return process.env.TASKLEDGER_FILE ?? "./tasks.json";
}

function formatTask(task: Task): string {
  const base = `${task.id}  [${task.done ? "x" : " "}]  ${task.title}`;
  return task.tags.length > 0 ? `${base} (tags: ${task.tags.join(", ")})` : base;
}

async function handleAdd(filePath: string, argv: string[]): Promise<number> {
  if (argv.length < 1) {
    writeError("Invalid task title");
    return 1;
  }

  const title = argv[0];
  const tags: string[] = [];

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg !== "--tag" || i + 1 >= argv.length) {
      writeUsage();
      return 1;
    }
    tags.push(argv[i + 1]);
    i += 1;
  }

  try {
    const task = await addTask(filePath, title, tags);
    process.stdout.write(`Added ${task.id}\n`);
    return 0;
  } catch (error) {
    if (isError(error)) {
      writeError(error.message);
    } else {
      writeError(String(error));
    }
    return 1;
  }
}

async function handleList(filePath: string, argv: string[]): Promise<number> {
  let status: ListOptions["status"] = "all";
  let tag: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--done") {
      if (status === "open") {
        writeUsage();
        return 1;
      }
      status = "done";
    } else if (arg === "--open") {
      if (status === "done") {
        writeUsage();
        return 1;
      }
      status = "open";
    } else if (arg === "--tag") {
      if (i + 1 >= argv.length) {
        writeUsage();
        return 1;
      }
      tag = argv[i + 1];
      i += 1;
    } else {
      writeUsage();
      return 1;
    }
  }

  try {
    const tasks = await listTasks(filePath, { status, tag });
    for (const task of tasks) {
      process.stdout.write(`${formatTask(task)}\n`);
    }
    return 0;
  } catch (error) {
    if (isError(error)) {
      writeError(error.message);
    } else {
      writeError(String(error));
    }
    return 1;
  }
}

async function handleIdCommand(
  filePath: string,
  argv: string[],
  command: "done" | "remove",
): Promise<number> {
  if (argv.length !== 1) {
    writeUsage();
    return 1;
  }

  try {
    if (command === "done") {
      const task = await completeTask(filePath, argv[0]);
      process.stdout.write(`Done ${task.id}\n`);
    } else {
      const task = await removeTask(filePath, argv[0]);
      process.stdout.write(`Removed ${task.id}\n`);
    }
    return 0;
  } catch (error) {
    if (isError(error)) {
      writeError(error.message);
    } else {
      writeError(String(error));
    }
    return 1;
  }
}

async function handleStats(filePath: string, argv: string[]): Promise<number> {
  if (argv.length !== 0) {
    writeUsage();
    return 1;
  }

  try {
    const stats = await getStats(filePath);
    process.stdout.write(`total: ${stats.total}\n`);
    process.stdout.write(`done: ${stats.done}\n`);
    process.stdout.write(`open: ${stats.open}\n`);
    return 0;
  } catch (error) {
    if (isError(error)) {
      writeError(error.message);
    } else {
      writeError(String(error));
    }
    return 1;
  }
}

export async function main(argv: string[]): Promise<number> {
  const filePath = getFilePath();
  const [command, ...rest] = argv;

  try {
    switch (command) {
      case "add":
        return await handleAdd(filePath, rest);
      case "list":
        return await handleList(filePath, rest);
      case "done":
        return await handleIdCommand(filePath, rest, "done");
      case "remove":
        return await handleIdCommand(filePath, rest, "remove");
      case "stats":
        return await handleStats(filePath, rest);
      default:
        writeUsage();
        return 1;
    }
  } catch (error) {
    if (isError(error)) {
      writeError(error.message);
    } else {
      writeError(String(error));
    }
    return 1;
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("/cli.js")) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
