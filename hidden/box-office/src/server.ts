import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createStore, type Store } from "./store.js";
import { HttpError, isHttpError, readJsonBody, sendError, sendJson } from "./http.js";
import { authenticateToken, createSession, registerUser, type AuthenticatedUser } from "./auth.js";
import {
  cancelEvent,
  cancelOrder,
  createDiscount,
  createEvent,
  createOrder,
  getEvent,
  getEventReport,
  getOrder,
  joinWaitlist,
  listEvents,
  listMyOrders,
  listMyWaitlist,
  payOrder,
  type ServiceContext,
} from "./service.js";

function getAuthorizationHeader(request: IncomingMessage): string | undefined {
  const value = request.headers.authorization;
  return Array.isArray(value) ? value[0] : value;
}

function pathParts(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

function isIntegerText(value: string): boolean {
  return /^[+-]?\d+$/.test(value);
}

function isOrganizer(actor: AuthenticatedUser): boolean {
  return actor.role === "organizer";
}

function isCustomer(actor: AuthenticatedUser): boolean {
  return actor.role === "customer";
}

function handleError(response: ServerResponse, error: unknown): void {
  if (isHttpError(error)) sendError(response, error.statusCode, error.message);
  else sendError(response, 500, "Internal Server Error");
}

export function createServer(store: Store, holdSeconds: number, nowProvider: () => Date): Server {
  return createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const parts = pathParts(url.pathname);
    const context: ServiceContext = { store, now: nowProvider(), holdSeconds };

    try {
      if (request.method === "POST" && parts.length === 1 && parts[0] === "users") {
        sendJson(response, 201, registerUser(store, await readJsonBody(request)));
        return;
      }
      if (request.method === "POST" && parts.length === 1 && parts[0] === "sessions") {
        sendJson(response, 200, createSession(store, await readJsonBody(request)));
        return;
      }
      if (request.method === "GET" && parts.length === 1 && parts[0] === "me") {
        sendJson(response, 200, authenticateToken(store, getAuthorizationHeader(request)));
        return;
      }
      if (request.method === "GET" && parts.length === 1 && parts[0] === "events") {
        sendJson(response, 200, listEvents(context, url.searchParams));
        return;
      }
      if (request.method === "GET" && parts.length === 2 && parts[0] === "events") {
        sendJson(response, 200, getEvent(context, parts[1]));
        return;
      }
      if (request.method === "POST" && parts.length === 1 && parts[0] === "events") {
        const actor = authenticateToken(store, getAuthorizationHeader(request));
        if (!isOrganizer(actor)) throw new HttpError(403, "Forbidden");
        sendJson(response, 201, createEvent(context, actor, await readJsonBody(request)));
        return;
      }
      if (request.method === "POST" && parts.length === 3 && parts[0] === "events" && parts[2] === "cancel") {
        const actor = authenticateToken(store, getAuthorizationHeader(request));
        if (!isOrganizer(actor)) throw new HttpError(403, "Forbidden");
        sendJson(response, 200, cancelEvent(context, actor, parts[1]));
        return;
      }
      if (request.method === "POST" && parts.length === 1 && parts[0] === "orders") {
        const actor = authenticateToken(store, getAuthorizationHeader(request));
        if (!isCustomer(actor)) throw new HttpError(403, "Forbidden");
        sendJson(response, 201, createOrder(context, actor, await readJsonBody(request)));
        return;
      }
      if (request.method === "POST" && parts.length === 3 && parts[0] === "orders" && parts[2] === "pay") {
        const actor = authenticateToken(store, getAuthorizationHeader(request));
        if (!isCustomer(actor)) throw new HttpError(403, "Forbidden");
        sendJson(response, 200, payOrder(context, actor, parts[1]));
        return;
      }
      if (request.method === "POST" && parts.length === 3 && parts[0] === "orders" && parts[2] === "cancel") {
        const actor = authenticateToken(store, getAuthorizationHeader(request));
        if (!isCustomer(actor)) throw new HttpError(403, "Forbidden");
        sendJson(response, 200, cancelOrder(context, actor, parts[1]));
        return;
      }
      if (request.method === "GET" && parts.length === 2 && parts[0] === "orders") {
        const actor = authenticateToken(store, getAuthorizationHeader(request));
        sendJson(response, 200, getOrder(context, actor, parts[1]));
        return;
      }
      if (request.method === "GET" && parts.length === 2 && parts[0] === "me" && parts[1] === "orders") {
        const actor = authenticateToken(store, getAuthorizationHeader(request));
        if (!isCustomer(actor)) throw new HttpError(403, "Forbidden");
        sendJson(response, 200, listMyOrders(context, actor));
        return;
      }
      if (request.method === "POST" && parts.length === 3 && parts[0] === "events" && parts[2] === "discounts") {
        const actor = authenticateToken(store, getAuthorizationHeader(request));
        if (!isOrganizer(actor)) throw new HttpError(403, "Forbidden");
        sendJson(response, 201, createDiscount(context, actor, parts[1], await readJsonBody(request)));
        return;
      }
      if (request.method === "POST" && parts.length === 3 && parts[0] === "events" && parts[2] === "waitlist") {
        const actor = authenticateToken(store, getAuthorizationHeader(request));
        if (!isCustomer(actor)) throw new HttpError(403, "Forbidden");
        sendJson(response, 201, joinWaitlist(context, actor, parts[1], await readJsonBody(request)));
        return;
      }
      if (request.method === "GET" && parts.length === 2 && parts[0] === "me" && parts[1] === "waitlist") {
        const actor = authenticateToken(store, getAuthorizationHeader(request));
        if (!isCustomer(actor)) throw new HttpError(403, "Forbidden");
        sendJson(response, 200, listMyWaitlist(context, actor));
        return;
      }
      if (request.method === "GET" && parts.length === 3 && parts[0] === "events" && parts[2] === "report") {
        const actor = authenticateToken(store, getAuthorizationHeader(request));
        if (!isOrganizer(actor)) throw new HttpError(403, "Forbidden");
        sendJson(response, 200, getEventReport(context, actor, parts[1]));
        return;
      }
      sendError(response, 404, "Not found");
    } catch (error) {
      handleError(response, error);
    }
  });
}

export function startServerFromEnv(): Server {
  const portRaw = process.env.PORT;
  if (!portRaw || !isIntegerText(portRaw)) throw new Error("Invalid PORT");
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");

  const holdRaw = process.env.HOLD_SECONDS;
  let holdSeconds = 600;
  if (holdRaw !== undefined) {
    if (!isIntegerText(holdRaw)) throw new Error("Invalid HOLD_SECONDS");
    holdSeconds = Number(holdRaw);
    if (!Number.isInteger(holdSeconds) || holdSeconds < 1) throw new Error("Invalid HOLD_SECONDS");
  }

  const server = createServer(createStore(), holdSeconds, () => new Date());
  server.listen(port);
  return server;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) startServerFromEnv();
