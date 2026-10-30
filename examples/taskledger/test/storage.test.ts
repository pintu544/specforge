import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTasks, saveTasks } from "../src/storage.js";

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), "storage-test-"));
}

test("loadTasks returns an empty array when the file does not exist", async () => {
  const dir = await makeTempDir();
  const filePath = join(dir, "missing.json");

  await assert.doesNotReject(async () => {
    const tasks = await loadTasks(filePath);
    assert.deepEqual(tasks, []);
  });
});

test("loadTasks parses tasks and preserves order and values", async () => {
  const dir = await makeTempDir();
  const filePath = join(dir, "tasks.json");
  const tasks = [
    {
      id: "a",
      title: "first",
      done: false,
      tags: ["work", "urgent"],
      createdAt: "2024-01-01T00:00:00.000Z",
    },
    {
      id: "b",
      title: "second",
      done: true,
      tags: [],
      createdAt: "2024-01-02T00:00:00.000Z",
    },
  ];

  await writeFile(filePath, JSON.stringify(tasks), "utf8");

  const loaded = await loadTasks(filePath);
  assert.deepEqual(loaded, tasks);
});

test("loadTasks throws Malformed tasks JSON for invalid JSON and invalid task shapes", async () => {
  const dir = await makeTempDir();
  const badJsonPath = join(dir, "bad-json.json");
  const badShapePath = join(dir, "bad-shape.json");

  await writeFile(badJsonPath, "not json", "utf8");
  await writeFile(
    badShapePath,
    JSON.stringify([
      {
        id: "a",
        title: "first",
        done: "nope",
        tags: ["work"],
        createdAt: "2024-01-01T00:00:00.000Z",
      },
    ]),
    "utf8",
  );

  await assert.rejects(() => loadTasks(badJsonPath), Error);
  await assert.rejects(() => loadTasks(badShapePath), Error);
});

test("loadTasks rethrows non-ENOENT filesystem errors as an Error", async () => {
  const dir = await makeTempDir();
  const filePath = join(dir, "dir-as-file");

  // Create a directory at the path so reading it fails with a filesystem error.
  await (await import("node:fs/promises")).mkdir(filePath);

  await assert.rejects(() => loadTasks(filePath), Error);
});

test("saveTasks writes the full array in the provided order", async () => {
  const dir = await makeTempDir();
  const filePath = join(dir, "tasks.json");
  const tasks = [
    {
      id: "2",
      title: "second",
      done: true,
      tags: ["b"],
      createdAt: "2024-02-02T00:00:00.000Z",
    },
    {
      id: "1",
      title: "first",
      done: false,
      tags: ["a", "c"],
      createdAt: "2024-02-01T00:00:00.000Z",
    },
  ];

  await saveTasks(filePath, tasks);

  const text = await readFile(filePath, "utf8");
  assert.deepEqual(JSON.parse(text), tasks);
});

test("saveTasks overwrites an existing file and rethrows filesystem write errors as an Error", async () => {
  const dir = await makeTempDir();
  const filePath = join(dir, "tasks.json");
  await writeFile(filePath, JSON.stringify([{ old: true }]), "utf8");

  const tasks = [
    {
      id: "1",
      title: "updated",
      done: true,
      tags: [],
      createdAt: "2024-03-01T00:00:00.000Z",
    },
  ];

  await saveTasks(filePath, tasks);
  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), tasks);

  const dirPath = join(dir, "existing-dir");
  await (await import("node:fs/promises")).mkdir(dirPath);
  await assert.rejects(() => saveTasks(dirPath, tasks), Error);
});
