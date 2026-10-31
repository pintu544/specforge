import { generateId, type CreateSessionInput, type CreateUserInput, type PublicUser, type Role, type Store, type User } from "./store.js";

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isValidEmail(email: string): boolean {
  const atIndex = email.indexOf("@");
  if (atIndex < 0) return false;
  const dotIndex = email.indexOf(".", atIndex + 1);
  return dotIndex > atIndex + 1;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

export function registerUser(store: Store, input: CreateUserInput): PublicUser {
  if (!isString(input.email) || !isString(input.password) || !isString(input.name) || !isString(input.role)) {
    throw new Error("Invalid input");
  }

  if (!isValidEmail(input.email) || input.password.length < 8 || input.name.length < 1 || input.name.length > 100 || (input.role !== "organizer" && input.role !== "customer")) {
    throw new Error("Invalid input");
  }

  const existing = store.users.find((user) => user.email.toLowerCase() === input.email.toLowerCase());
  if (existing) {
    throw new Error("Conflict");
  }

  const user: User = {
    id: generateId(store),
    email: input.email,
    password: input.password,
    name: input.name,
    role: input.role as Role,
  };
  store.users.push(user);
  return toPublicUser(user);
}

export function createSession(store: Store, input: CreateSessionInput): { token: string } {
  if (!isString(input.email) || !isString(input.password)) {
    throw new Error("Invalid input");
  }

  const user = store.users.find((candidate) => candidate.email.toLowerCase() === input.email.toLowerCase() && candidate.password === input.password);
  if (!user) {
    throw new Error("Invalid email or password");
  }

  const token = generateId(store);
  store.sessions.push({ token, userId: user.id });
  return { token };
}

export function requireUserByAuthorization(store: Store, authorizationHeader: string | undefined): User {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }

  const token = authorizationHeader.slice("Bearer ".length);
  if (!token) {
    throw new Error("Unauthorized");
  }

  const session = store.sessions.find((candidate) => candidate.token === token);
  if (!session) {
    throw new Error("Unauthorized");
  }

  const user = store.users.find((candidate) => candidate.id === session.userId);
  if (!user) {
    throw new Error("Unauthorized");
  }

  return user;
}

export function requireRole(user: User, role: Role): void {
  if (user.role !== role) {
    throw new Error("Forbidden");
  }
}
