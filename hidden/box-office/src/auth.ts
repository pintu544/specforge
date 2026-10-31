import { HttpError } from "./http.js";
import { nextId, type Store, type UserRecord } from "./store.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: "organizer" | "customer";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeEmail(email: string): string {
  return email.toLowerCase();
}

function isValidEmail(email: string): boolean {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return false;
  const afterAt = email.slice(atIndex + 1);
  return afterAt.length > 0 && afterAt.includes(".");
}

function toAuthenticatedUser(user: UserRecord): AuthenticatedUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export function registerUser(store: Store, input: unknown): AuthenticatedUser {
  if (!isRecord(input)) throw new HttpError(400, "Invalid user");

  const { email, password, name, role } = input;
  if (typeof email !== "string" || typeof password !== "string" || typeof name !== "string") {
    throw new HttpError(400, "Invalid user");
  }
  if (role !== "organizer" && role !== "customer") throw new HttpError(400, "Invalid user");
  if (!isValidEmail(email) || password.length < 8 || name.length < 1 || name.length > 100) {
    throw new HttpError(400, "Invalid user");
  }

  const emailKey = normalizeEmail(email);
  if (store.users.some((user) => user.emailKey === emailKey)) {
    throw new HttpError(409, "Email already registered");
  }

  const user: UserRecord = { id: nextId(store), email, emailKey, password, name, role };
  store.users.push(user);
  return toAuthenticatedUser(user);
}

export function createSession(store: Store, input: unknown): { token: string } {
  if (!isRecord(input)) throw new HttpError(400, "Invalid session");
  const { email, password } = input;
  if (typeof email !== "string" || typeof password !== "string") {
    throw new HttpError(400, "Invalid session");
  }

  const user = store.users.find(
    (candidate) => candidate.emailKey === normalizeEmail(email) && candidate.password === password,
  );
  if (!user) throw new HttpError(401, "Invalid email or password");

  const token = `token_${nextId(store)}`;
  store.sessions.push({ token, userId: user.id });
  return { token };
}

export function authenticateToken(store: Store, authorizationHeader: string | undefined): AuthenticatedUser {
  if (typeof authorizationHeader !== "string") throw new HttpError(401, "Invalid token");
  if (!authorizationHeader.startsWith("Bearer ")) throw new HttpError(401, "Invalid token");
  const token = authorizationHeader.slice(7);
  if (token.length === 0) throw new HttpError(401, "Invalid token");

  const session = store.sessions.find((candidate) => candidate.token === token);
  if (!session) throw new HttpError(401, "Invalid token");
  const user = store.users.find((candidate) => candidate.id === session.userId);
  if (!user) throw new HttpError(401, "Invalid token");

  return toAuthenticatedUser(user);
}
