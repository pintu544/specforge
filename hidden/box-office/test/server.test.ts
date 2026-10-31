import { test } from "node:test";
import assert from "node:assert/strict";
import type http from "node:http";
import { createServer, startServer } from "../src/server.js";
import { createStore } from "../src/store.js";

test("createServer returns an HTTP server", () => {
  const server = createServer(createStore(600));
  assert.equal(typeof server.listen, "function");
  assert.equal(typeof server.close, "function");
});

test("startServer validates PORT before creating a server", async () => {
  const originalPort = process.env.PORT;
  const originalHold = process.env.HOLD_SECONDS;
  try {
    delete process.env.PORT;
    process.env.HOLD_SECONDS = "120";
    await assert.rejects(() => startServer(), /Invalid PORT/);

    process.env.PORT = "-1";
    await assert.rejects(() => startServer(), /Invalid PORT/);

    process.env.PORT = "abc";
    await assert.rejects(() => startServer(), /Invalid PORT/);
  } finally {
    if (originalPort === undefined) delete process.env.PORT; else process.env.PORT = originalPort;
    if (originalHold === undefined) delete process.env.HOLD_SECONDS; else process.env.HOLD_SECONDS = originalHold;
  }
});

test("startServer listens on the requested port and uses HOLD_SECONDS when valid", async () => {
  const originalPort = process.env.PORT;
  const originalHold = process.env.HOLD_SECONDS;
  process.env.PORT = "0";
  process.env.HOLD_SECONDS = "123";
  let server: http.Server | undefined;
  try {
    server = await startServer();
    const address = server.address();
    assert.ok(address && typeof address === "object");
    assert.equal(address.port > 0, true);
  } finally {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    if (originalPort === undefined) delete process.env.PORT; else process.env.PORT = originalPort;
    if (originalHold === undefined) delete process.env.HOLD_SECONDS; else process.env.HOLD_SECONDS = originalHold;
  }
});

test("startServer falls back to 600 when HOLD_SECONDS is missing or invalid", async () => {
  const originalPort = process.env.PORT;
  const originalHold = process.env.HOLD_SECONDS;
  process.env.PORT = "0";
  try {
    delete process.env.HOLD_SECONDS;
    const server1 = await startServer();
    await new Promise<void>((resolve) => server1.close(() => resolve()));

    process.env.HOLD_SECONDS = "0";
    const server2 = await startServer();
    await new Promise<void>((resolve) => server2.close(() => resolve()));
  } finally {
    if (originalPort === undefined) delete process.env.PORT; else process.env.PORT = originalPort;
    if (originalHold === undefined) delete process.env.HOLD_SECONDS; else process.env.HOLD_SECONDS = originalHold;
  }
});
