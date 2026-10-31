import { test } from "node:test";
import assert from "node:assert/strict";
import { authenticateToken, createSession, createUser } from "../src/auth.js";
import { HttpError } from "../src/errors.js";
import { createStore } from "../src/store.js";

test("createUser creates and returns a public user", () => {
  const store = createStore(600);

  const user = createUser(store, {
    email: "Alice@Example.com",
    password: "password1",
    name: "Alice",
    role: "organizer",
  });

  assert.deepEqual(user, {
    id: "id-1",
    email: "Alice@Example.com",
    name: "Alice",
    role: "organizer",
  });
  assert.equal(store.users.get("id-1")?.password, "password1");
  assert.equal(store.usersByEmailLower.get("alice@example.com"), "id-1");
});

test("createUser rejects invalid input and duplicate email case-insensitively", () => {
  const store = createStore(600);

  assert.throws(() => createUser(store, { email: "aliceexample.com", password: "password1", name: "Alice", role: "organizer" }), HttpError);
  assert.throws(() => createUser(store, { email: "alice@examplecom", password: "password1", name: "Alice", role: "organizer" }), HttpError);
  assert.throws(() => createUser(store, { email: "alice@example.com", password: "short", name: "Alice", role: "organizer" }), HttpError);
  assert.throws(() => createUser(store, { email: "alice@example.com", password: "password1", name: "", role: "organizer" }), HttpError);
  assert.throws(() => createUser(store, { email: "alice@example.com", password: "password1", name: "Alice", role: "admin" as "organizer" }), HttpError);

  createUser(store, {
    email: "alice@example.com",
    password: "password1",
    name: "Alice",
    role: "customer",
  });

  assert.throws(
    () =>
      createUser(store, {
        email: "ALICE@EXAMPLE.COM",
        password: "password2",
        name: "Alice 2",
        role: "organizer",
      }),
    (error: unknown) => error instanceof HttpError && error.status === 409 && error.message === "Email already registered"
  );
});

test("createSession creates a token and stores the session", () => {
  const store = createStore(600);
  createUser(store, {
    email: "alice@example.com",
    password: "password1",
    name: "Alice",
    role: "customer",
  });

  const session = createSession(store, { email: "ALICE@example.com", password: "password1" });

  assert.deepEqual(session, { token: "id-2" });
  assert.equal(store.sessions.get("id-2"), "id-1");
});

test("createSession rejects invalid credentials and invalid input", () => {
  const store = createStore(600);
  createUser(store, {
    email: "alice@example.com",
    password: "password1",
    name: "Alice",
    role: "customer",
  });

  assert.throws(() => createSession(store, { email: 123 as unknown as string, password: "password1" }), (error: unknown) => error instanceof HttpError && error.status === 400 && error.message === "Invalid session input");
  assert.throws(() => createSession(store, { email: "alice@example.com", password: 123 as unknown as string }), (error: unknown) => error instanceof HttpError && error.status === 400 && error.message === "Invalid session input");
  assert.throws(() => createSession(store, { email: "missing@example.com", password: "password1" }), (error: unknown) => error instanceof HttpError && error.status === 401 && error.message === "Invalid email or password");
  assert.throws(() => createSession(store, { email: "alice@example.com", password: "wrongpass" }), (error: unknown) => error instanceof HttpError && error.status === 401 && error.message === "Invalid email or password");
});

test("authenticateToken returns the authenticated public user", () => {
  const store = createStore(600);
  const created = createUser(store, {
    email: "alice@example.com",
    password: "password1",
    name: "Alice",
    role: "customer",
  });
  const { token } = createSession(store, { email: "alice@example.com", password: "password1" });

  assert.deepEqual(authenticateToken(store, `Bearer ${token}`), created);
});

test("authenticateToken rejects missing, malformed, unknown, and orphaned bearer tokens", () => {
  const store = createStore(600);
  createUser(store, {
    email: "alice@example.com",
    password: "password1",
    name: "Alice",
    role: "customer",
  });
  const { token } = createSession(store, { email: "alice@example.com", password: "password1" });

  for (const header of [undefined, "", "Token abc", "Bearer", "Bearer "]) {
    assert.throws(() => authenticateToken(store, header), (error: unknown) => error instanceof HttpError && error.status === 401 && error.message === "Unauthorized");
  }

  assert.throws(() => authenticateToken(store, "Bearer missing"), (error: unknown) => error instanceof HttpError && error.status === 401 && error.message === "Unauthorized");

  store.sessions.delete(token);
  assert.throws(() => authenticateToken(store, `Bearer ${token}`), (error: unknown) => error instanceof HttpError && error.status === 401 && error.message === "Unauthorized");
});
