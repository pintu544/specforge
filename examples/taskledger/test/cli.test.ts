import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.js";

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), "cli-test-"));
}

async function withCapturedIO<T>(fn: () => Promise<T>) {
  const stdout = process.stdout.write;
  const stderr = process.stderr.write;
  let out = "";
  let err = "";
  process.stdout.write = ((chunk: unknown) => {
    out += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    err += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  try {
    const value = await fn();
    return { value, out, err };
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
}

test("main prints usage for unknown commands", async () => {
  const { value, out, err } = await withCapturedIO(() => main(["unknown"]));
  assert.equal(value, 1);
  assert.equal(out, "");
  assert.equal(
    err,
    "Usage:\n  node dist/cli.js add <title> [--tag <tag>]...\n  node dist/cli.js list [--done | --open] [--tag <tag>]\n  node dist/cli.js done <id>\n  node dist/cli.js remove <id>\n  node dist/cli.js stats\n",
  );
});

test("main uses TASKLEDGER_FILE and supports add, list, done, remove, and stats", async () => {
  const dir = await makeTempDir();
  const filePath = join(dir, "tasks.json");
  process.env.TASKLEDGER_FILE = filePath;

  try {
    const addResult = await withCapturedIO(() => main(["add", "first task", "--tag", "work", "--tag", "urgent"]));
    assert.equal(addResult.value, 0);
    assert.match(addResult.out, /^Added .+\n$/);
    assert.equal(addResult.err, "");

    const storedAfterAdd = JSON.parse(await (await import("node:fs/promises")).readFile(filePath, "utf8"));
    assert.equal(storedAfterAdd.length, 1);
    assert.equal(storedAfterAdd[0].title, "first task");
    assert.deepEqual(storedAfterAdd[0].tags, ["work", "urgent"]);

    const listResult = await withCapturedIO(() => main(["list", "--tag", "work"]));
    assert.equal(listResult.value, 0);
    assert.match(listResult.out, /^.+  \[ \]  first task \(tags: work, urgent\)\n$/);
    assert.equal(listResult.err, "");

    const taskId = storedAfterAdd[0].id as string;
    const doneResult = await withCapturedIO(() => main(["done", taskId]));
    assert.equal(doneResult.value, 0);
    assert.equal(doneResult.out, `Done ${taskId}\n`);
    assert.equal(doneResult.err, "");

    const removedResult = await withCapturedIO(() => main(["remove", taskId]));
    assert.equal(removedResult.value, 0);
    assert.equal(removedResult.out, `Removed ${taskId}\n`);
    assert.equal(removedResult.err, "");

    await writeFile(filePath, JSON.stringify([
      {
        id: "a",
        title: "one",
        done: false,
        tags: [],
        createdAt: "2024-01-01T00:00:00.000Z",
      },
      {
        id: "b",
        title: "two",
        done: true,
        tags: ["x"],
        createdAt: "2024-01-02T00:00:00.000Z",
      },
    ]), "utf8");

    const statsResult = await withCapturedIO(() => main(["stats"]));
    assert.equal(statsResult.value, 0);
    assert.equal(statsResult.out, "total: 2\ndone: 1\nopen: 1\n");
    assert.equal(statsResult.err, "");
  } finally {
    delete process.env.TASKLEDGER_FILE;
  }
});

test("main reports service errors and invalid CLI input as specified", async () => {
  const dir = await makeTempDir();
  const filePath = join(dir, "tasks.json");
  process.env.TASKLEDGER_FILE = filePath;

  try {
    const invalidTitle = await withCapturedIO(() => main(["add", "   "]));
    assert.equal(invalidTitle.value, 1);
    assert.equal(invalidTitle.out, "");
    assert.equal(invalidTitle.err, "Invalid task title\n");

    const missingTagValue = await withCapturedIO(() => main(["list", "--tag"]));
    assert.equal(missingTagValue.value, 1);
    assert.equal(missingTagValue.out, "");
    assert.equal(
      missingTagValue.err,
      "Usage:\n  node dist/cli.js add <title> [--tag <tag>]...\n  node dist/cli.js list [--done | --open] [--tag <tag>]\n  node dist/cli.js done <id>\n  node dist/cli.js remove <id>\n  node dist/cli.js stats\n",
    );

    const bothStatuses = await withCapturedIO(() => main(["list", "--done", "--open"]));
    assert.equal(bothStatuses.value, 1);
    assert.equal(bothStatuses.out, "");
    assert.equal(
      bothStatuses.err,
      "Usage:\n  node dist/cli.js add <title> [--tag <tag>]...\n  node dist/cli.js list [--done | --open] [--tag <tag>]\n  node dist/cli.js done <id>\n  node dist/cli.js remove <id>\n  node dist/cli.js stats\n",
    );

    const doneMissingArg = await withCapturedIO(() => main(["done"]));
    assert.equal(doneMissingArg.value, 1);
    assert.equal(doneMissingArg.out, "");
    assert.equal(
      doneMissingArg.err,
      "Usage:\n  node dist/cli.js add <title> [--tag <tag>]...\n  node dist/cli.js list [--done | --open] [--tag <tag>]\n  node dist/cli.js done <id>\n  node dist/cli.js remove <id>\n  node dist/cli.js stats\n",
    );

    const statsExtra = await withCapturedIO(() => main(["stats", "extra"]));
    assert.equal(statsExtra.value, 1);
    assert.equal(statsExtra.out, "");
    assert.equal(
      statsExtra.err,
      "Usage:\n  node dist/cli.js add <title> [--tag <tag>]...\n  node dist/cli.js list [--done | --open] [--tag <tag>]\n  node dist/cli.js done <id>\n  node dist/cli.js remove <id>\n  node dist/cli.js stats\n",
    );
  } finally {
    delete process.env.TASKLEDGER_FILE;
  }
});
