import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addTask,
  listTasks,
  completeTask,
  removeTask,
  getStats,
} from "../src/task-service.js";

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), "task-service-test-"));
}

async function writeTasks(filePath: string, tasks: unknown) {
  await (await import("node:fs/promises")).writeFile(filePath, JSON.stringify(tasks), "utf8");
}

test("addTask validates title, appends a copied task, and saves it", async () => {
  const dir = await makeTempDir();
  const filePath = join(dir, "tasks.json");
  const existing = [
    {
      id: "1",
      title: "existing",
      done: false,
      tags: ["old"],
      createdAt: "2024-01-01T00:00:00.000Z",
    },
  ];
  await writeTasks(filePath, existing);

  const tags = ["work", "urgent"];
  const before = tags.slice();
  const now = "2024-04-05T06:07:08.000Z";
  const originalDate = Date;
  class FakeDate extends Date {
    override toISOString() {
      return now;
    }
  }
  // Use a local binding to avoid mutating globals outside the test scope.
  const RealDate = Date;
  (globalThis as typeof globalThis & { Date: typeof Date }).Date = FakeDate as unknown as typeof Date;

  try {
    const task = await addTask(filePath, "new task", tags);
    assert.match(task.id, /.+/);
    assert.equal(task.title, "new task");
    assert.equal(task.done, false);
    assert.deepEqual(task.tags, tags);
    assert.notStrictEqual(task.tags, tags);
    assert.equal(task.createdAt, now);
    assert.deepEqual(tags, before);

    const saved = JSON.parse(await readFile(filePath, "utf8"));
    assert.deepEqual(saved, [...existing, task]);
  } finally {
    (globalThis as typeof globalThis & { Date: typeof Date }).Date = RealDate;
    void originalDate;
  }
});

test("addTask rejects an empty trimmed title and propagates storage errors", async () => {
  const dir = await makeTempDir();
  const filePath = join(dir, "tasks.json");

  await assert.rejects(() => addTask(filePath, "   ", []), Error);

  await writeTasks(filePath, "not-json");
  await assert.rejects(() => addTask(filePath, "valid", []), Error);
});

test("listTasks filters by status and tag without mutating stored tasks", async () => {
  const dir = await makeTempDir();
  const filePath = join(dir, "tasks.json");
  const tasks = [
    {
      id: "1",
      title: "first",
      done: false,
      tags: ["work"],
      createdAt: "2024-01-01T00:00:00.000Z",
    },
    {
      id: "2",
      title: "second",
      done: true,
      tags: ["work", "home"],
      createdAt: "2024-01-02T00:00:00.000Z",
    },
    {
      id: "3",
      title: "third",
      done: false,
      tags: ["home"],
      createdAt: "2024-01-03T00:00:00.000Z",
    },
  ];
  await writeTasks(filePath, tasks);

  assert.deepEqual(await listTasks(filePath, { status: "all" }), tasks);
  assert.deepEqual(await listTasks(filePath, { status: "done" }), [tasks[1]]);
  assert.deepEqual(await listTasks(filePath, { status: "open" }), [tasks[0], tasks[2]]);
  assert.deepEqual(await listTasks(filePath, { tag: "home" }), [tasks[1], tasks[2]]);
  assert.deepEqual(await listTasks(filePath, { status: "open", tag: "work" }), [tasks[0]]);
  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), tasks);
});

test("completeTask marks a task done, preserves already-done tasks, and errors when not found", async () => {
  const dir = await makeTempDir();
  const filePath = join(dir, "tasks.json");
  const tasks = [
    {
      id: "1",
      title: "first",
      done: false,
      tags: [],
      createdAt: "2024-01-01T00:00:00.000Z",
    },
    {
      id: "2",
      title: "second",
      done: true,
      tags: ["x"],
      createdAt: "2024-01-02T00:00:00.000Z",
    },
  ];
  await writeTasks(filePath, tasks);

  const updated = await completeTask(filePath, "1");
  assert.deepEqual(updated, { ...tasks[0], done: true });
  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), [{ ...tasks[0], done: true }, tasks[1]]);

  const doneAgain = await completeTask(filePath, "2");
  assert.deepEqual(doneAgain, tasks[1]);

  await assert.rejects(() => completeTask(filePath, "missing"), Error);
});

test("removeTask removes and returns the matching task and errors when not found", async () => {
  const dir = await makeTempDir();
  const filePath = join(dir, "tasks.json");
  const tasks = [
    {
      id: "1",
      title: "first",
      done: false,
      tags: [],
      createdAt: "2024-01-01T00:00:00.000Z",
    },
    {
      id: "2",
      title: "second",
      done: true,
      tags: ["x"],
      createdAt: "2024-01-02T00:00:00.000Z",
    },
    {
      id: "3",
      title: "third",
      done: false,
      tags: ["y"],
      createdAt: "2024-01-03T00:00:00.000Z",
    },
  ];
  await writeTasks(filePath, tasks);

  const removed = await removeTask(filePath, "2");
  assert.deepEqual(removed, tasks[1]);
  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), [tasks[0], tasks[2]]);

  await assert.rejects(() => removeTask(filePath, "missing"), Error);
});

test("getStats returns computed stats for the current stored list and propagates errors", async () => {
  const dir = await makeTempDir();
  const filePath = join(dir, "tasks.json");
  const tasks = [
    {
      id: "1",
      title: "first",
      done: false,
      tags: [],
      createdAt: "2024-01-01T00:00:00.000Z",
    },
    {
      id: "2",
      title: "second",
      done: true,
      tags: [],
      createdAt: "2024-01-02T00:00:00.000Z",
    },
  ];
  await writeTasks(filePath, tasks);

  assert.deepEqual(await getStats(filePath), { total: 2, done: 1, open: 1 });

  const badPath = join(dir, "bad.json");
  await writeTasks(badPath, "not-json");
  await assert.rejects(() => getStats(badPath), Error);
});
