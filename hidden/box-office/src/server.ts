import http from "node:http";
import { createStore, type Store, type CreateUserInput, type CreateSessionInput, type Role, type User, type PublicUser, type CreateEventInput, type ListEventsQuery, type CreateDiscountInput, type CreateOrderInput, type JoinWaitlistInput } from "./store.js";
import { registerUser, createSession, requireUserByAuthorization, requireRole, toPublicUser } from "./auth.js";
import { refreshExpirations, createEvent, listPublicEvents, getEventById, cancelEvent, createDiscount, createOrder, payOrder, cancelOrder, getVisibleOrder, listCustomerOrders, joinWaitlist, listCustomerWaitlist, getEventReport } from "./boxOffice.js";
import type { Event, PaginatedEvents, Discount, Order, WaitlistEntry, EventReport } from "./store.js";

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function mapError(err: unknown): { status: number; body: { error: string } } {
  const message = err instanceof Error ? err.message : "Internal Server Error";
  switch (message) {
    case "Unauthorized":
    case "Invalid email or password":
      return { status: 401, body: { error: message } };
    case "Forbidden":
      return { status: 403, body: { error: message } };
    case "Invalid input":
      return { status: 400, body: { error: message } };
    case "Not found":
      return { status: 404, body: { error: message } };
    case "Conflict":
      return { status: 409, body: { error: message } };
    case "Unprocessable":
      return { status: 422, body: { error: message } };
    default:
      return { status: 500, body: { error: "Internal Server Error" } };
  }
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("Invalid input"));
      }
    });
    req.on("error", () => reject(new Error("Invalid input")));
  });
}

function getPathSegments(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}

export function createAppServer(store: Store, holdSeconds: number): http.Server {
  return http.createServer(async (req, res) => {
    const now = new Date();
    refreshExpirations(store, now, holdSeconds);

    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    const segments = getPathSegments(url);
    const authHeader = req.headers.authorization;

    try {
      if (method === "POST" && segments.length === 1 && segments[0] === "users") {
        const body = await readJsonBody(req);
        const result = registerUser(store, body as CreateUserInput);
        sendJson(res, 201, result);
        return;
      }

      if (method === "POST" && segments.length === 1 && segments[0] === "sessions") {
        const body = await readJsonBody(req);
        const result = createSession(store, body as CreateSessionInput);
        sendJson(res, 200, result);
        return;
      }

      if (method === "GET" && segments.length === 1 && segments[0] === "events") {
        const query: ListEventsQuery = {
          from: url.searchParams.get("from") ?? undefined,
          to: url.searchParams.get("to") ?? undefined,
          q: url.searchParams.get("q") ?? undefined,
          page: url.searchParams.get("page") ?? undefined,
          pageSize: url.searchParams.get("pageSize") ?? undefined,
        };
        const result = listPublicEvents(store, query);
        sendJson(res, 200, result);
        return;
      }

      if (method === "GET" && segments.length === 2 && segments[0] === "events") {
        const result = getEventById(store, segments[1]);
        sendJson(res, 200, result);
        return;
      }

      const protectedUser =
        method === "GET" && segments.length === 1 && segments[0] === "me" ||
        method === "POST" && segments.length >= 1 && segments[0] === "events" && segments[segments.length - 1] !== "cancel" && segments[segments.length - 1] !== "discounts" && segments[segments.length - 1] !== "waitlist" ||
        method === "POST" && segments.length >= 1 && segments[0] === "orders" ||
        method === "GET" && segments.length >= 1 && segments[0] === "orders" ||
        method === "GET" && segments.length >= 2 && segments[0] === "events" && segments[2] === "report";

      if (method === "GET" && segments.length === 1 && segments[0] === "me") {
        const user = requireUserByAuthorization(store, authHeader);
        sendJson(res, 200, toPublicUser(user));
        return;
      }

      if (method === "POST" && segments.length === 1 && segments[0] === "events") {
        const user = requireUserByAuthorization(store, authHeader);
        requireRole(user, "organizer");
        const body = await readJsonBody(req);
        const result = createEvent(store, user.id, body as CreateEventInput, now);
        sendJson(res, 201, result);
        return;
      }

      if (method === "POST" && segments.length === 3 && segments[0] === "events" && segments[2] === "cancel") {
        const user = requireUserByAuthorization(store, authHeader);
        requireRole(user, "organizer");
        const result = cancelEvent(store, user.id, segments[1]);
        sendJson(res, 200, result);
        return;
      }

      if (method === "POST" && segments.length === 3 && segments[0] === "events" && segments[2] === "discounts") {
        const user = requireUserByAuthorization(store, authHeader);
        requireRole(user, "organizer");
        const body = await readJsonBody(req);
        const result = createDiscount(store, user.id, segments[1], body as CreateDiscountInput, now);
        sendJson(res, 201, result);
        return;
      }

      if (method === "POST" && segments.length === 3 && segments[0] === "events" && segments[2] === "waitlist") {
        const user = requireUserByAuthorization(store, authHeader);
        requireRole(user, "customer");
        const body = await readJsonBody(req);
        const result = joinWaitlist(store, user.id, segments[1], body as JoinWaitlistInput);
        sendJson(res, 201, result);
        return;
      }

      if (method === "GET" && segments.length === 3 && segments[0] === "events" && segments[2] === "report") {
        const user = requireUserByAuthorization(store, authHeader);
        requireRole(user, "organizer");
        const result = getEventReport(store, user.id, segments[1]);
        sendJson(res, 200, result);
        return;
      }

      if (method === "POST" && segments.length === 1 && segments[0] === "orders") {
        const user = requireUserByAuthorization(store, authHeader);
        requireRole(user, "customer");
        const body = await readJsonBody(req);
        const result = createOrder(store, user.id, body as CreateOrderInput, now, holdSeconds);
        sendJson(res, 201, result);
        return;
      }

      if (method === "POST" && segments.length === 3 && segments[0] === "orders" && segments[2] === "pay") {
        const user = requireUserByAuthorization(store, authHeader);
        requireRole(user, "customer");
        const result = payOrder(store, user.id, segments[1], now);
        sendJson(res, 200, result);
        return;
      }

      if (method === "POST" && segments.length === 3 && segments[0] === "orders" && segments[2] === "cancel") {
        const user = requireUserByAuthorization(store, authHeader);
        requireRole(user, "customer");
        const result = cancelOrder(store, user.id, segments[1], now, holdSeconds);
        sendJson(res, 200, result);
        return;
      }

      if (method === "GET" && segments.length === 2 && segments[0] === "orders") {
        const user = requireUserByAuthorization(store, authHeader);
        const result = getVisibleOrder(store, user.id, segments[1]);
        sendJson(res, 200, result);
        return;
      }

      if (method === "GET" && segments.length === 2 && segments[0] === "me" && segments[1] === "orders") {
        const user = requireUserByAuthorization(store, authHeader);
        requireRole(user, "customer");
        const result = listCustomerOrders(store, user.id);
        sendJson(res, 200, result);
        return;
      }

      if (method === "GET" && segments.length === 2 && segments[0] === "me" && segments[1] === "waitlist") {
        const user = requireUserByAuthorization(store, authHeader);
        requireRole(user, "customer");
        const result = listCustomerWaitlist(store, user.id);
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      const mapped = mapError(err);
      sendJson(res, mapped.status, mapped.body);
    }
  });
}

export function startServer(): http.Server {
  const store = createStore();
  const holdSecondsRaw = process.env.HOLD_SECONDS;
  const holdSeconds = holdSecondsRaw === undefined ? 600 : Number.parseInt(holdSecondsRaw, 10);
  const portRaw = process.env.PORT;
  const port = portRaw === undefined ? 0 : Number.parseInt(portRaw, 10);
  const server = createAppServer(store, Number.isFinite(holdSeconds) ? holdSeconds : 600);
  server.listen(Number.isFinite(port) ? port : 0);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
