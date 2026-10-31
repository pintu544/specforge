import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createStore } from "../src/store.js";
import { registerUser, createSession } from "../src/auth.js";
import { createServer, startServerFromEnv } from "../src/server.js";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      resolve(address.port);
    });
  });
}

function request(port: number, options: http.RequestOptions & { body?: string }) {
  return new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request(
      { port, host: "127.0.0.1", path: options.path, method: options.method, headers: options.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) req.end(options.body);
    else req.end();
  });
}

test("createServer returns an unlistened server", () => {
  const server = createServer(createStore(), 600, () => new Date("2025-01-01T00:00:00.000Z"));
  assert.equal(server.listening, false);
  server.close();
});

test("createServer wires JSON routes and error handling", async () => {
  const store = createStore();
  const server = createServer(store, 600, () => new Date("2025-01-01T00:00:00.000Z"));
  const port = await listen(server);
  try {
    const userRes = await request(port, {
      method: "POST",
      path: "/users",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "organizer@example.com", password: "password123", name: "Org", role: "organizer" }),
    });
    assert.equal(userRes.statusCode, 201);
    assert.equal(JSON.parse(userRes.body).email, "organizer@example.com");

    const sessionRes = await request(port, {
      method: "POST",
      path: "/sessions",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "organizer@example.com", password: "password123" }),
    });
    const token = JSON.parse(sessionRes.body).token as string;

    const eventRes = await request(port, {
      method: "POST",
      path: "/events",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ title: "Show", venue: "Hall", startsAt: "2025-01-02T00:00:00.000Z", tiers: [{ name: "GA", priceCents: 1000, quantity: 2 }] }),
    });
    assert.equal(eventRes.statusCode, 201);
    const event = JSON.parse(eventRes.body);
    assert.equal(event.title, "Show");

    const listRes = await request(port, { method: "GET", path: "/events" });
    assert.equal(listRes.statusCode, 200);
    assert.equal(JSON.parse(listRes.body).total, 1);

    const unknownRes = await request(port, { method: "GET", path: "/unknown" });
    assert.equal(unknownRes.statusCode, 404);
    assert.deepEqual(JSON.parse(unknownRes.body), { error: "Not found" });

    const badJsonRes = await request(port, {
      method: "POST",
      path: "/users",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(badJsonRes.statusCode, 400);
    assert.deepEqual(JSON.parse(badJsonRes.body), { error: "Invalid JSON" });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("createServer returns Internal Server Error for unexpected thrown values", async () => {
  const store = createStore();
  const originalCreateStore = store;
  const server = createServer(originalCreateStore, 600, () => new Date("2025-01-01T00:00:00.000Z"));
  const port = await listen(server);
  try {
    const res = await request(port, { method: "GET", path: "/events/%zz" });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(JSON.parse(res.body), { error: "Internal Server Error" });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("startServerFromEnv validates environment and starts listening", async () => {
  const oldPort = process.env.PORT;
  const oldHold = process.env.HOLD_SECONDS;
  try {
    delete process.env.PORT;
    assert.throws(() => startServerFromEnv(), /Invalid PORT/);

    process.env.PORT = "0";
    assert.throws(() => startServerFromEnv(), /Invalid PORT/);

    process.env.PORT = "12345";
    process.env.HOLD_SECONDS = "0";
    assert.throws(() => startServerFromEnv(), /Invalid HOLD_SECONDS/);

    process.env.HOLD_SECONDS = "1";
    const server = startServerFromEnv();
    try {
      assert.equal(server.listening, true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    if (oldPort === undefined) delete process.env.PORT; else process.env.PORT = oldPort;
    if (oldHold === undefined) delete process.env.HOLD_SECONDS; else process.env.HOLD_SECONDS = oldHold;
  }
});
