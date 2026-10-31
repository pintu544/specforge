import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createAppServer, startServer } from "../src/server.js";
import { createStore } from "../src/store.js";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("No address"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function request(port: number, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string; json: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        port,
        method,
        path,
        hostname: "127.0.0.1",
        headers: {
          ...headers,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: text.length ? JSON.parse(text) : undefined });
        });
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.end(JSON.stringify(body));
    else req.end();
  });
}

test("createAppServer serves JSON and maps unknown routes to 404", async () => {
  const server = createAppServer(createStore(), 600);
  const port = await listen(server);
  try {
    const res = await request(port, "GET", "/does-not-exist");
    assert.equal(res.status, 404);
    assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
    assert.deepEqual(res.json, { error: "Not found" });
  } finally {
    await close(server);
  }
});

test("createAppServer can create users and sessions and rejects invalid JSON before business logic", async () => {
  const server = createAppServer(createStore(), 600);
  const port = await listen(server);
  try {
    const createdUser = await request(port, "POST", "/users", { email: "a@example.com", password: "pw", name: "Ada", role: "customer" });
    assert.equal(createdUser.status, 201);
    assert.equal(createdUser.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(createdUser.json.email, "a@example.com");

    const createdSession = await request(port, "POST", "/sessions", { email: "a@example.com", password: "pw" });
    assert.equal(createdSession.status, 200);
    assert.equal(createdSession.json.token, createdSession.json.token);

    const badJson = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = http.request({ port, method: "POST", path: "/users", hostname: "127.0.0.1", headers: { "content-type": "application/json" } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.end("not-json");
    });
    assert.equal(badJson.status, 400);
    assert.deepEqual(JSON.parse(badJson.text), { error: "Invalid input" });
  } finally {
    await close(server);
  }
});

test("createAppServer protects routes before parsing body and returns mapped auth errors", async () => {
  const server = createAppServer(createStore(), 600);
  const port = await listen(server);
  try {
    const unauthorized = await request(port, "POST", "/events", { title: "x" });
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(unauthorized.json, { error: "Unauthorized" });

    const forbidden = await request(port, "POST", "/orders", { eventId: "e1", items: [] }, { authorization: "Bearer bad" });
    assert.equal(forbidden.status, 401);

    const me = await request(port, "GET", "/me", undefined, { authorization: "Bearer bad" });
    assert.equal(me.status, 401);
  } finally {
    await close(server);
  }
});

test("startServer reads environment variables, listens, and returns the server", async () => {
  const originalPort = process.env.PORT;
  const originalHold = process.env.HOLD_SECONDS;
  process.env.PORT = "0";
  process.env.HOLD_SECONDS = "123";
  try {
    const server = startServer();
    assert.ok(server.listening);
    await close(server);
  } finally {
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
    if (originalHold === undefined) delete process.env.HOLD_SECONDS;
    else process.env.HOLD_SECONDS = originalHold;
  }
});
