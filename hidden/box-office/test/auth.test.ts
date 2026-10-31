import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";
import { HttpError } from "../src/http.js";
import { registerUser, createSession, authenticateToken } from "../src/auth.js";
import type { AuthenticatedUser } from "../src/auth.js";

function makeStore() {
  return createStore();
}

test("AuthenticatedUser is a public user shape", () => {
  const user: AuthenticatedUser = {
    id: "id_1",
    email: "person@example.com",
    name: "Person",
    role: "customer",
  };

  assert.deepEqual(user, {
    id: "id_1",
    email: "person@example.com",
    name: "Person",
    role: "customer",
  });
});

test("registerUser creates a user, stores the password only in memory, and returns no password", () => {
  const store = makeStore();

  const result = registerUser(store, {
    email: "Person@Example.com",
    password: "password123",
    name: "Person",
    role: "customer",
  });

  assert.deepEqual(result, {
    id: "id_1",
    email: "Person@Example.com",
    name: "Person",
    role: "customer",
  });
  assert.equal(store.users.length, 1);
  assert.deepEqual(store.users[0], {
    id: "id_1",
    email: "Person@Example.com",
    emailKey: "person@example.com",
    password: "password123",
    name: "Person",
    role: "customer",
  });
});

test("registerUser accepts organizers too", () => {
  const store = makeStore();

  const result = registerUser(store, {
    email: "Org@example.com",
    password: "password123",
    name: "Org",
    role: "organizer",
  });

  assert.equal(result.role, "organizer");
  assert.equal(store.users[0].role, "organizer");
});

test("registerUser rejects invalid shape or invalid values with Invalid user", () => {
  const store = makeStore();
  const invalidInputs = [
    undefined,
    null,
    1,
    "x",
    {},
    { email: "a@example.com" },
    { email: 1, password: "password123", name: "A", role: "customer" },
    { email: "a@example.com", password: 1, name: "A", role: "customer" },
    { email: "a@example.com", password: "password123", name: 1, role: "customer" },
    { email: "a@example.com", password: "password123", name: "A", role: "admin" },
    { email: "no-at.example.com", password: "password123", name: "A", role: "customer" },
    { email: "a@b", password: "password123", name: "A", role: "customer" },
    { email: "a@example.com", password: "short", name: "A", role: "customer" },
    { email: "a@example.com", password: "password123", name: "", role: "customer" },
    { email: "a@example.com", password: "password123", name: "a".repeat(101), role: "customer" },
  ];

  for (const input of invalidInputs) {
    assert.throws(() => registerUser(store, input), (error: unknown) => error instanceof HttpError && error.statusCode === 400 && error.message === "Invalid user");
  }
});

test("registerUser rejects duplicate email case-insensitively", () => {
  const store = makeStore();
  registerUser(store, {
    email: "person@example.com",
    password: "password123",
    name: "Person",
    role: "customer",
  });

  assert.throws(
    () => registerUser(store, {
      email: "PERSON@example.com",
      password: "password456",
      name: "Other",
      role: "customer",
    }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409 && error.message === "Email already registered",
  );
});

test("createSession creates token_<id> and stores the session", () => {
  const store = makeStore();
  registerUser(store, {
    email: "person@example.com",
    password: "password123",
    name: "Person",
    role: "customer",
  });

  const result = createSession(store, {
    email: "PERSON@example.com",
    password: "password123",
  });

  assert.deepEqual(result, { token: "token_id_2" });
  assert.deepEqual(store.sessions, [{ token: "token_id_2", userId: "id_1" }]);
});

test("createSession rejects invalid shape with Invalid session", () => {
  const store = makeStore();

  for (const input of [undefined, null, {}, { email: "a@example.com" }, { password: "x" }, { email: 1, password: "x" }, { email: "a@example.com", password: 1 }]) {
    assert.throws(() => createSession(store, input), (error: unknown) => error instanceof HttpError && error.statusCode === 400 && error.message === "Invalid session");
  }
});

test("createSession rejects unknown credentials with Invalid email or password", () => {
  const store = makeStore();
  registerUser(store, {
    email: "person@example.com",
    password: "password123",
    name: "Person",
    role: "customer",
  });

  assert.throws(
    () => createSession(store, { email: "person@example.com", password: "wrongpass" }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 401 && error.message === "Invalid email or password",
  );
  assert.throws(
    () => createSession(store, { email: "missing@example.com", password: "password123" }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 401 && error.message === "Invalid email or password",
  );
});

test("authenticateToken returns the authenticated user for a valid bearer token", () => {
  const store = makeStore();
  const created = registerUser(store, {
    email: "person@example.com",
    password: "password123",
    name: "Person",
    role: "customer",
  });
  const { token } = createSession(store, { email: "person@example.com", password: "password123" });

  const authenticated = authenticateToken(store, `Bearer ${token}`);
  assert.deepEqual(authenticated, created);
});

test("authenticateToken rejects missing or malformed headers with Invalid token", () => {
  const store = makeStore();
  for (const header of [undefined, "", "Bearer", "Bearer ", "Token abc", "Bearer abc def", "bearer token"]) {
    assert.throws(() => authenticateToken(store, header as string | undefined), (error: unknown) => error instanceof HttpError && error.statusCode === 401 && error.message === "Invalid token");
  }
});

test("authenticateToken rejects unknown tokens and missing users with Invalid token", () => {
  const store = makeStore();
  const user = registerUser(store, {
    email: "person@example.com",
    password: "password123",
    name: "Person",
    role: "customer",
  });
  const { token } = createSession(store, { email: "person@example.com", password: "password123" });

  assert.throws(
    () => authenticateToken(store, "Bearer missing"),
    (error: unknown) => error instanceof HttpError && error.statusCode === 401 && error.message === "Invalid token",
  );

  store.users = store.users.filter((candidate) => candidate.id !== user.id);
  assert.throws(
    () => authenticateToken(store, `Bearer ${token}`),
    (error: unknown) => error instanceof HttpError && error.statusCode === 401 && error.message === "Invalid token",
  );
});
