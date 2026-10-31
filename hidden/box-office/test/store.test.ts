import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, generateId } from "../src/store.js";

test("createStore returns a fresh empty store with the provided holdSeconds", () => {
  const store = createStore(900);

  assert.equal(store.holdSeconds, 900);
  assert.equal(store.nextId, 1);
  assert.deepEqual(Array.from(store.users.entries()), []);
  assert.deepEqual(Array.from(store.usersByEmailLower.entries()), []);
  assert.deepEqual(Array.from(store.sessions.entries()), []);
  assert.deepEqual(Array.from(store.events.entries()), []);
  assert.deepEqual(Array.from(store.discountsByEventId.entries()), []);
  assert.deepEqual(Array.from(store.orders.entries()), []);
  assert.deepEqual(Array.from(store.waitlistsByTierKey.entries()), []);
});

test("createStore creates independent maps for each store", () => {
  const first = createStore(10);
  const second = createStore(20);

  first.users.set("u1", {
    id: "u1",
    email: "a@example.com",
    emailLower: "a@example.com",
    password: "password1",
    name: "A",
    role: "customer",
  });

  assert.equal(second.users.size, 0);
  assert.equal(first.holdSeconds, 10);
  assert.equal(second.holdSeconds, 20);
  assert.notStrictEqual(first.users, second.users);
  assert.notStrictEqual(first.orders, second.orders);
});

test("generateId increments sequentially on a single store", () => {
  const store = createStore(60);

  assert.equal(generateId(store), "id-1");
  assert.equal(generateId(store), "id-2");
  assert.equal(generateId(store), "id-3");
  assert.equal(store.nextId, 4);
});

test("generateId continues from the store state and is shared across callers", () => {
  const store = createStore(30);
  store.nextId = 7;

  assert.equal(generateId(store), "id-7");
  assert.equal(generateId(store), "id-8");
});
