import http from "node:http";
import { HttpError } from "./errors.js";
import { createStore, type Store } from "./store.js";
import { authenticateToken, createSession, createUser, type PublicUser, type UserRole } from "./auth.js";
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
  listCustomerOrders,
  listCustomerWaitlist,
  listEvents,
  payOrder,
} from "./boxOffice.js";

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, "Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function getPathAndQuery(req: http.IncomingMessage): { pathname: string; searchParams: URLSearchParams } {
  const url = new URL(req.url ?? "/", "http://localhost");
  return { pathname: url.pathname, searchParams: url.searchParams };
}

function requireRole(user: PublicUser, role: UserRole): void {
  if (user.role !== role) throw new HttpError(403, "Forbidden");
}

function isEntryPoint(): boolean {
  return process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const { pathname, searchParams } = getPathAndQuery(req);

      if (method === "POST" && pathname === "/users") {
        const body = await parseJsonBody(req);
        return sendJson(res, 201, createUser(store, body));
      }

      if (method === "POST" && pathname === "/sessions") {
        const body = await parseJsonBody(req);
        return sendJson(res, 200, createSession(store, body));
      }

      if (method === "GET" && pathname === "/me") {
        const user = authenticateToken(store, req.headers.authorization);
        return sendJson(res, 200, user);
      }

      if (method === "POST" && pathname === "/events") {
        const user = authenticateToken(store, req.headers.authorization);
        requireRole(user, "organizer");
        const body = await parseJsonBody(req);
        return sendJson(res, 201, createEvent(store, user, body));
      }

      if (method === "GET" && pathname === "/events") {
        return sendJson(
          res,
          200,
          listEvents(store, {
            from: searchParams.get("from") ?? undefined,
            to: searchParams.get("to") ?? undefined,
            q: searchParams.get("q") ?? undefined,
            page: searchParams.get("page") ?? undefined,
            pageSize: searchParams.get("pageSize") ?? undefined,
          })
        );
      }

      const eventMatch = pathname.match(/^\/events\/([^/]+)(?:\/(cancel|discounts|waitlist|report))?$/);
      if (method === "GET" && eventMatch && !eventMatch[2]) return sendJson(res, 200, getEvent(store, eventMatch[1]));
      if (method === "POST" && eventMatch?.[2] === "cancel") {
        const user = authenticateToken(store, req.headers.authorization);
        requireRole(user, "organizer");
        return sendJson(res, 200, cancelEvent(store, user, eventMatch[1]));
      }
      if (method === "POST" && eventMatch?.[2] === "discounts") {
        const user = authenticateToken(store, req.headers.authorization);
        requireRole(user, "organizer");
        const body = await parseJsonBody(req);
        return sendJson(res, 201, createDiscount(store, user, eventMatch[1], body));
      }
      if (method === "POST" && eventMatch?.[2] === "waitlist") {
        const user = authenticateToken(store, req.headers.authorization);
        requireRole(user, "customer");
        const body = await parseJsonBody(req);
        return sendJson(res, 201, joinWaitlist(store, user, eventMatch[1], body));
      }
      if (method === "GET" && eventMatch?.[2] === "report") {
        const user = authenticateToken(store, req.headers.authorization);
        requireRole(user, "organizer");
        return sendJson(res, 200, getEventReport(store, user, eventMatch[1]));
      }

      if (method === "POST" && pathname === "/orders") {
        const user = authenticateToken(store, req.headers.authorization);
        requireRole(user, "customer");
        const body = await parseJsonBody(req);
        return sendJson(res, 201, createOrder(store, user, body));
      }

      const orderMatch = pathname.match(/^\/orders\/([^/]+)(?:\/(pay|cancel))?$/);
      if (method === "POST" && orderMatch?.[2] === "pay") {
        const user = authenticateToken(store, req.headers.authorization);
        requireRole(user, "customer");
        return sendJson(res, 200, payOrder(store, user, orderMatch[1]));
      }
      if (method === "POST" && orderMatch?.[2] === "cancel") {
        const user = authenticateToken(store, req.headers.authorization);
        requireRole(user, "customer");
        return sendJson(res, 200, cancelOrder(store, user, orderMatch[1]));
      }
      if (method === "GET" && orderMatch && !orderMatch[2]) {
        const user = authenticateToken(store, req.headers.authorization);
        return sendJson(res, 200, getOrder(store, user, orderMatch[1]));
      }

      if (method === "GET" && pathname === "/me/orders") {
        const user = authenticateToken(store, req.headers.authorization);
        requireRole(user, "customer");
        return sendJson(res, 200, listCustomerOrders(store, user));
      }
      if (method === "GET" && pathname === "/me/waitlist") {
        const user = authenticateToken(store, req.headers.authorization);
        requireRole(user, "customer");
        return sendJson(res, 200, listCustomerWaitlist(store, user));
      }

      return sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message });
      if (error instanceof SyntaxError) return sendJson(res, 400, { error: "Invalid JSON" });
      return sendJson(res, 500, { error: "Internal Server Error" });
    }
  });
}

export async function startServer(): Promise<http.Server> {
  const portRaw = process.env.PORT;
  if (portRaw === undefined || !/^(0|[1-9]\d*)$/.test(portRaw)) throw new Error("Invalid PORT");
  const holdRaw = process.env.HOLD_SECONDS;
  const holdSeconds = holdRaw === undefined || !/^(0|[1-9]\d*)$/.test(holdRaw) || Number(holdRaw) < 1 ? 600 : Number(holdRaw);
  const server = createServer(createStore(holdSeconds));
  await new Promise<void>((resolve) => server.listen(Number(portRaw), resolve));
  return server;
}

if (isEntryPoint()) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
