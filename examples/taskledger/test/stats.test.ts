import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStats } from "../src/stats.js";

test("computeStats returns zeros for an empty array", () => {
  assert.deepEqual(computeStats([]), { total: 0, done: 0, open: 0 });
});

test("computeStats counts total, done, and open tasks", () => {
  const tasks = [
    {
      id: "1",
      title: "first",
      done: true,
      tags: ["work"],
      createdAt: "2024-01-01T00:00:00.000Z",
    },
    {
      id: "2",
      title: "second",
      done: false,
      tags: [],
      createdAt: "2024-01-02T00:00:00.000Z",
    },
    {
      id: "3",
      title: "third",
      done: true,
      tags: ["home", "urgent"],
      createdAt: "2024-01-03T00:00:00.000Z",
    },
  ];

  assert.deepEqual(computeStats(tasks), { total: 3, done: 2, open: 1 });
});

test("computeStats does not mutate the input array or task objects", () => {
  const taskA = {
    id: "1",
    title: "alpha",
    done: false,
    tags: ["x", "y"],
    createdAt: "2024-02-01T00:00:00.000Z",
  };
  const taskB = {
    id: "2",
    title: "beta",
    done: true,
    tags: ["z"],
    createdAt: "2024-02-02T00:00:00.000Z",
  };
  const tasks = [taskA, taskB];
  const snapshot = structuredClone(tasks);

  const result = computeStats(tasks);

  assert.deepEqual(result, { total: 2, done: 1, open: 1 });
  assert.deepEqual(tasks, snapshot);
  assert.strictEqual(tasks[0], taskA);
  assert.strictEqual(tasks[1], taskB);
});
