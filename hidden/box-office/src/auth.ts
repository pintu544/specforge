import { HttpError } from "./errors.js";
import type { Store, UserRecord } from "./store.js";
import { generateId } from "./store.js";

export type UserRole = "organizer" | "customer";
export type PublicUser = { id: string; email: string; name: string; role: UserRole };

function toPublicUser(user: UserRecord): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

function isValidEmail(email: string): boolean {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return false;
  const dotIndex = email.indexOf(".", atIndex + 1);
  return dotIndex !== -1;
}

export function createUser(
  store: Store,
  input: { email: string; password: string; name: string; role: UserRole }
): PublicUser {
  const { email, password, name, role } = input;

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    typeof name !== "string" ||
    (role !== "organizer" && role !== "customer") ||
    !isValidEmail(email) ||
    password.length < 8 ||
    name.length < 1 ||
    name.length > 100
  ) {
    throw new HttpError(400, "Invalid user input");
  }

  const emailLower = email.toLowerCase();
  if (store.usersByEmailLower.has(emailLower)) {
    throw new HttpError(409, "Email already registered");
  }

  const user: UserRecord = {
    id: generateId(store),
    email,
    emailLower,
    password,
    name,
    role,
  };
  store.users.set(user.id, user);
  store.usersByEmailLower.set(emailLower, user.id);
  return toPublicUser(user);
}

export function createSession(store: Store, input: { email: string; password: string }): { token: string } {
  if (typeof input.email !== "string" || typeof input.password !== "string") {
    throw new HttpError(400, "Invalid session input");
  }

  const userId = store.usersByEmailLower.get(input.email.toLowerCase());
  const user = userId ? store.users.get(userId) : undefined;
  if (!user || user.password !== input.password) {
    throw new HttpError(401, "Invalid email or password");
  }

  const token = generateId(store);
  store.sessions.set(token, user.id);
  return { token };
}

export function authenticateToken(store: Store, authorizationHeader: string | undefined): PublicUser {
  if (typeof authorizationHeader !== "string") {
    throw new HttpError(401, "Unauthorized");
  }
  if (!authorizationHeader.startsWith("Bearer ")) {
    throw new HttpError(401, "Unauthorized");
  }
  const token = authorizationHeader.slice("Bearer ".length);
  if (token.length === 0 || authorizationHeader !== `Bearer ${token}`) {
    throw new HttpError(401, "Unauthorized");
  }

  const userId = store.sessions.get(token);
  const user = userId ? store.users.get(userId) : undefined;
  if (!user) {
    throw new HttpError(401, "Unauthorized");
  }
  return toPublicUser(user);
}
