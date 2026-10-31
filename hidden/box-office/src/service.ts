import { HttpError } from "./http.js";
import { nextId, type DiscountRecord, type EventRecord, type EventTierRecord, type OrderItemRecord, type OrderRecord, type Store, type WaitlistEntryRecord } from "./store.js";
import type { AuthenticatedUser } from "./auth.js";

export interface ServiceContext {
  store: Store;
  now: Date;
  holdSeconds: number;
}

export interface EventView {
  id: string;
  title: string;
  venue: string;
  startsAt: string;
  status: "on_sale" | "cancelled";
  organizerId: string;
  tiers: {
    id: string;
    name: string;
    priceCents: number;
    quantity: number;
    available: number;
  }[];
}

export interface PaginatedEvents {
  items: EventView[];
  page: number;
  pageSize: number;
  total: number;
}

export interface OrderView {
  id: string;
  eventId: string;
  customerId: string;
  status: "held" | "paid" | "expired" | "cancelled" | "refunded";
  items: { tierId: string; quantity: number; unitPriceCents: number }[];
  subtotalCents: number;
  discountCode: string | null;
  discountCents: number;
  totalCents: number;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
}

export interface DiscountView {
  code: string;
  percentOff: number | null;
  amountOffCents: number | null;
  maxUses: number | null;
  expiresAt: string | null;
  uses: number;
}

export interface WaitlistEntryView {
  id: string;
  eventId: string;
  tierId: string;
  quantity: number;
  position: number;
}

export interface EventReport {
  eventId: string;
  tiers: { tierId: string; name: string; sold: number; held: number; available: number }[];
  grossCents: number;
  discountCents: number;
  refundedCents: number;
  netCents: number;
}

const iso = (d: Date) => d.toISOString();
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const eventById = (s: Store, id: string) => s.events.find((e) => e.id === id);
const tierById = (e: EventRecord, id: string) => e.tiers.find((t) => t.id === id);

function parseDateString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function orderView(o: OrderRecord): OrderView {
  return {
    id: o.id,
    eventId: o.eventId,
    customerId: o.customerId,
    status: o.status,
    items: o.items.map((i) => ({ ...i })),
    subtotalCents: o.subtotalCents,
    discountCode: o.discountCode,
    discountCents: o.discountCents,
    totalCents: o.totalCents,
    createdAt: o.createdAt,
    expiresAt: o.expiresAt,
    paidAt: o.paidAt,
  };
}

function ticketCounts(store: Store, eventId: string, tierId: string) {
  let held = 0;
  let paid = 0;
  for (const o of store.orders) {
    if (o.eventId !== eventId || (o.status !== "held" && o.status !== "paid")) continue;
    for (const i of o.items) {
      if (i.tierId !== tierId) continue;
      if (o.status === "held") held += i.quantity;
      else paid += i.quantity;
    }
  }
  return { held, paid };
}

function availableForTier(store: Store, eventId: string, tierId: string) {
  const e = eventById(store, eventId);
  const t = e && tierById(e, tierId);
  if (!e || !t) return 0;
  const c = ticketCounts(store, eventId, tierId);
  return t.quantity - c.held - c.paid;
}

function customerEventTickets(store: Store, eventId: string, customerId: string) {
  let total = 0;
  for (const o of store.orders) {
    if (o.eventId !== eventId || o.customerId !== customerId || (o.status !== "held" && o.status !== "paid")) continue;
    for (const i of o.items) total += i.quantity;
  }
  return total;
}

function discountUses(store: Store, eventId: string, code: string) {
  return store.orders.filter(
    (o) => o.eventId === eventId && (o.status === "held" || o.status === "paid") && o.discountCode === code,
  ).length;
}

function viewEvent(store: Store, e: EventRecord): EventView {
  return {
    id: e.id,
    title: e.title,
    venue: e.venue,
    startsAt: e.startsAt,
    status: e.status,
    organizerId: e.organizerId,
    tiers: e.tiers.map((t) => ({
      id: t.id,
      name: t.name,
      priceCents: t.priceCents,
      quantity: t.quantity,
      available: availableForTier(store, e.id, t.id),
    })),
  };
}

function serveWaitlist(context: ServiceContext, eventId: string): void {
  const event = eventById(context.store, eventId);
  if (!event) return;

  for (const tier of event.tiers) {
    while (true) {
      const queue = context.store.waitlist.filter((w) => w.eventId === eventId && w.tierId === tier.id);
      const first = queue[0];
      if (!first) break;
      if (first.quantity > availableForTier(context.store, eventId, tier.id)) break;

      if (customerEventTickets(context.store, eventId, first.customerId) + first.quantity > 6) {
        context.store.waitlist = context.store.waitlist.filter((w) => w.id !== first.id);
        continue;
      }

      const subtotal = first.quantity * tier.priceCents;
      context.store.orders.push({
        id: nextId(context.store),
        eventId,
        customerId: first.customerId,
        status: "held",
        items: [{ tierId: tier.id, quantity: first.quantity, unitPriceCents: tier.priceCents }],
        subtotalCents: subtotal,
        discountCode: null,
        discountCents: 0,
        totalCents: subtotal,
        createdAt: iso(context.now),
        expiresAt: new Date(context.now.getTime() + context.holdSeconds * 1000).toISOString(),
        paidAt: null,
      });
      context.store.waitlist = context.store.waitlist.filter((w) => w.id !== first.id);
    }
  }
}

function applyLazyExpiration(context: ServiceContext): void {
  const now = iso(context.now);
  const affected = new Set<string>();
  for (const o of context.store.orders) {
    if (o.status === "held" && o.expiresAt <= now) {
      o.status = "expired";
      affected.add(o.eventId);
    }
  }
  for (const eventId of affected) serveWaitlist(context, eventId);
}

export function listEvents(context: ServiceContext, query: URLSearchParams): PaginatedEvents {
  applyLazyExpiration(context);

  const parsePage = (value: string | null, defaultValue: number) => {
    if (value == null || value === "") return defaultValue;
    if (!/^-?\d+$/.test(value)) throw new HttpError(400, "Invalid query");
    return Number(value);
  };

  const page = parsePage(query.get("page"), 1);
  const pageSize = parsePage(query.get("pageSize"), 10);
  if (page < 1 || pageSize < 1 || pageSize > 50) throw new HttpError(400, "Invalid query");

  const fromRaw = query.get("from");
  const toRaw = query.get("to");
  const from = fromRaw ? parseDateString(fromRaw) : null;
  const to = toRaw ? parseDateString(toRaw) : null;
  if ((fromRaw && !from) || (toRaw && !to)) throw new HttpError(400, "Invalid query");

  const q = query.get("q")?.toLowerCase();
  let items = context.store.events.filter((e) => e.status === "on_sale");
  if (from) items = items.filter((e) => e.startsAt >= from);
  if (to) items = items.filter((e) => e.startsAt <= to);
  if (q) items = items.filter((e) => e.title.toLowerCase().includes(q) || e.venue.toLowerCase().includes(q));
  items = [...items].sort((a, b) => (a.startsAt === b.startsAt ? a.title.localeCompare(b.title) : a.startsAt.localeCompare(b.startsAt)));

  const total = items.length;
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize).map((e) => viewEvent(context.store, e)), page, pageSize, total };
}

export function getEvent(context: ServiceContext, eventId: string): EventView {
  applyLazyExpiration(context);
  const e = eventById(context.store, eventId);
  if (!e) throw new HttpError(404, "Event not found");
  return viewEvent(context.store, e);
}

export function createEvent(context: ServiceContext, actor: AuthenticatedUser, input: unknown): EventView {
  applyLazyExpiration(context);
  if (actor.role !== "organizer") throw new HttpError(403, "Forbidden");
  if (!input || typeof input !== "object") throw new HttpError(400, "Invalid event");

  const obj = input as Record<string, unknown>;
  if (
    typeof obj.title !== "string" ||
    obj.title.length < 1 ||
    obj.title.length > 100 ||
    typeof obj.venue !== "string" ||
    obj.venue.length < 1 ||
    obj.venue.length > 100 ||
    typeof obj.startsAt !== "string" ||
    parseDateString(obj.startsAt) == null ||
    Date.parse(obj.startsAt) <= context.now.getTime() ||
    !Array.isArray(obj.tiers) ||
    obj.tiers.length < 1 ||
    obj.tiers.length > 5
  ) {
    throw new HttpError(400, "Invalid event");
  }

  const seen = new Set<string>();
  const tiers: EventTierRecord[] = [];
  for (const t of obj.tiers) {
    if (!t || typeof t !== "object") throw new HttpError(400, "Invalid event");
    const r = t as Record<string, unknown>;
    if (
      typeof r.name !== "string" ||
      seen.has(r.name) ||
      !isInt(r.priceCents) ||
      r.priceCents < 0 ||
      !isInt(r.quantity) ||
      r.quantity < 1 ||
      r.quantity > 10000
    ) {
      throw new HttpError(400, "Invalid event");
    }
    seen.add(r.name);
    tiers.push({ id: nextId(context.store), name: r.name, priceCents: r.priceCents, quantity: r.quantity });
  }

  const e: EventRecord = {
    id: nextId(context.store),
    title: obj.title,
    venue: obj.venue,
    startsAt: new Date(Date.parse(obj.startsAt)).toISOString(),
    status: "on_sale",
    organizerId: actor.id,
    tiers,
    discounts: [],
  };
  context.store.events.push(e);
  return viewEvent(context.store, e);
}

export function cancelEvent(context: ServiceContext, actor: AuthenticatedUser, eventId: string): EventView {
  applyLazyExpiration(context);
  if (actor.role !== "organizer") throw new HttpError(403, "Forbidden");
  const e = eventById(context.store, eventId);
  if (!e) throw new HttpError(404, "Event not found");
  if (e.organizerId !== actor.id) throw new HttpError(403, "Forbidden");
  if (e.status === "cancelled") throw new HttpError(409, "Event already cancelled");

  e.status = "cancelled";
  for (const o of context.store.orders) {
    if (o.eventId !== eventId) continue;
    if (o.status === "paid") o.status = "refunded";
    else if (o.status === "held") o.status = "cancelled";
  }
  context.store.waitlist = context.store.waitlist.filter((w) => w.eventId !== eventId);
  return viewEvent(context.store, e);
}

export function createOrder(context: ServiceContext, actor: AuthenticatedUser, input: unknown): OrderView {
  applyLazyExpiration(context);
  if (actor.role !== "customer") throw new HttpError(403, "Forbidden");
  if (!input || typeof input !== "object") throw new HttpError(400, "Invalid order");

  const obj = input as Record<string, unknown>;
  if (typeof obj.eventId !== "string" || !Array.isArray(obj.items) || obj.items.length < 1) {
    throw new HttpError(400, "Invalid order");
  }

  const e = eventById(context.store, obj.eventId);
  if (!e) throw new HttpError(404, "Event not found");
  if (e.status !== "on_sale" || Date.parse(e.startsAt) <= context.now.getTime()) throw new HttpError(409, "Event is not on sale");

  const seen = new Set<string>();
  const items: OrderItemRecord[] = [];
  for (const it of obj.items) {
    if (!it || typeof it !== "object") throw new HttpError(400, "Invalid order");
    const r = it as Record<string, unknown>;
    if (typeof r.tierId !== "string" || seen.has(r.tierId) || !isInt(r.quantity) || r.quantity < 1) {
      throw new HttpError(400, "Invalid order");
    }
    const tier = tierById(e, r.tierId);
    if (!tier) throw new HttpError(400, "Invalid order");
    seen.add(r.tierId);
    items.push({ tierId: r.tierId, quantity: r.quantity, unitPriceCents: tier.priceCents });
  }

  const requested = items.reduce((sum, item) => sum + item.quantity, 0);
  if (customerEventTickets(context.store, e.id, actor.id) + requested > 6) throw new HttpError(422, "Ticket limit exceeded");
  if (items.some((i) => availableForTier(context.store, e.id, i.tierId) < i.quantity)) throw new HttpError(409, "Not enough tickets");

  const subtotalCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  let discountCode: string | null = null;
  let discountCents = 0;

  if (obj.discountCode != null) {
    if (typeof obj.discountCode !== "string") throw new HttpError(400, "Invalid order");
    const code = obj.discountCode.toUpperCase();
    const d = e.discounts.find((x) => x.code === code);
    if (!d || (d.expiresAt != null && d.expiresAt <= iso(context.now)) || (d.maxUses != null && discountUses(context.store, e.id, code) >= d.maxUses)) {
      throw new HttpError(422, "Discount code cannot be used");
    }
    discountCode = code;
    discountCents = d.percentOff != null ? Math.floor((subtotalCents * d.percentOff) / 100) : Math.min(d.amountOffCents ?? 0, subtotalCents);
  }

  const order: OrderRecord = {
    id: nextId(context.store),
    eventId: e.id,
    customerId: actor.id,
    status: "held",
    items,
    subtotalCents,
    discountCode,
    discountCents,
    totalCents: subtotalCents - discountCents,
    createdAt: iso(context.now),
    expiresAt: new Date(context.now.getTime() + context.holdSeconds * 1000).toISOString(),
    paidAt: null,
  };
  context.store.orders.push(order);
  return orderView(order);
}

export function payOrder(context: ServiceContext, actor: AuthenticatedUser, orderId: string): OrderView {
  applyLazyExpiration(context);
  if (actor.role !== "customer") throw new HttpError(403, "Forbidden");
  const o = context.store.orders.find((x) => x.id === orderId);
  if (!o || o.customerId !== actor.id) throw new HttpError(404, "Order not found");
  if (o.status !== "held") throw new HttpError(409, "Order cannot be paid");
  o.status = "paid";
  o.paidAt = iso(context.now);
  return orderView(o);
}

export function cancelOrder(context: ServiceContext, actor: AuthenticatedUser, orderId: string): OrderView {
  applyLazyExpiration(context);
  if (actor.role !== "customer") throw new HttpError(403, "Forbidden");
  const o = context.store.orders.find((x) => x.id === orderId);
  if (!o || o.customerId !== actor.id) throw new HttpError(404, "Order not found");
  const e = eventById(context.store, o.eventId);

  if (o.status === "held") {
    o.status = "cancelled";
    if (e) serveWaitlist(context, e.id);
    return orderView(o);
  }

  if (o.status === "paid" && e && Date.parse(e.startsAt) - context.now.getTime() > 24 * 60 * 60 * 1000) {
    o.status = "refunded";
    serveWaitlist(context, e.id);
    return orderView(o);
  }

  throw new HttpError(409, "Order cannot be cancelled");
}

export function getOrder(context: ServiceContext, actor: AuthenticatedUser, orderId: string): OrderView {
  applyLazyExpiration(context);
  const o = context.store.orders.find((x) => x.id === orderId);
  if (!o) throw new HttpError(404, "Order not found");
  const e = eventById(context.store, o.eventId);
  if (!e) throw new HttpError(404, "Order not found");
  if (actor.role === "customer" && actor.id !== o.customerId) throw new HttpError(404, "Order not found");
  if (actor.role === "organizer" && actor.id !== e.organizerId) throw new HttpError(404, "Order not found");
  return orderView(o);
}

export function listMyOrders(context: ServiceContext, actor: AuthenticatedUser): OrderView[] {
  applyLazyExpiration(context);
  if (actor.role !== "customer") throw new HttpError(403, "Forbidden");
  return context.store.orders.filter((o) => o.customerId === actor.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(orderView);
}

export function createDiscount(context: ServiceContext, actor: AuthenticatedUser, eventId: string, input: unknown): DiscountView {
  applyLazyExpiration(context);
  if (actor.role !== "organizer") throw new HttpError(403, "Forbidden");
  const e = eventById(context.store, eventId);
  if (!e) throw new HttpError(404, "Event not found");
  if (e.organizerId !== actor.id) throw new HttpError(403, "Forbidden");
  if (!input || typeof input !== "object") throw new HttpError(400, "Invalid discount");

  const obj = input as Record<string, unknown>;
  const hasPercent = obj.percentOff != null;
  const hasAmount = obj.amountOffCents != null;
  if (typeof obj.code !== "string" || !/^[A-Za-z0-9]{3,20}$/.test(obj.code) || hasPercent === hasAmount) throw new HttpError(400, "Invalid discount");

  const code = obj.code.toUpperCase();
  if (e.discounts.some((d) => d.code === code)) throw new HttpError(409, "Discount code already exists");

  let percentOff: number | null = null;
  let amountOffCents: number | null = null;
  if (hasPercent) {
    if (!isInt(obj.percentOff) || obj.percentOff < 1 || obj.percentOff > 100) throw new HttpError(400, "Invalid discount");
    percentOff = obj.percentOff;
  } else {
    if (!isInt(obj.amountOffCents) || obj.amountOffCents < 1) throw new HttpError(400, "Invalid discount");
    amountOffCents = obj.amountOffCents;
  }

  let maxUses: number | null = null;
  if (obj.maxUses != null) {
    if (!isInt(obj.maxUses) || obj.maxUses < 1) throw new HttpError(400, "Invalid discount");
    maxUses = obj.maxUses;
  }

  const expiresAt = obj.expiresAt == null ? null : parseDateString(obj.expiresAt);
  if (obj.expiresAt != null && !expiresAt) throw new HttpError(400, "Invalid discount");

  const d: DiscountRecord = { code, percentOff, amountOffCents, maxUses, expiresAt };
  e.discounts.push(d);
  return { ...d, uses: discountUses(context.store, e.id, code) };
}

export function joinWaitlist(context: ServiceContext, actor: AuthenticatedUser, eventId: string, input: unknown): WaitlistEntryView {
  applyLazyExpiration(context);
  if (actor.role !== "customer") throw new HttpError(403, "Forbidden");
  const e = eventById(context.store, eventId);
  if (!e) throw new HttpError(404, "Event not found");
  if (!input || typeof input !== "object") throw new HttpError(400, "Invalid waitlist entry");

  const obj = input as Record<string, unknown>;
  if (typeof obj.tierId !== "string" || !isInt(obj.quantity) || obj.quantity < 1 || obj.quantity > 6 || !tierById(e, obj.tierId)) {
    throw new HttpError(400, "Invalid waitlist entry");
  }
  if (context.store.waitlist.some((w) => w.eventId === eventId && w.tierId === obj.tierId && w.customerId === actor.id)) {
    throw new HttpError(409, "Already waitlisted");
  }
  if (availableForTier(context.store, eventId, obj.tierId) >= obj.quantity) throw new HttpError(409, "Tickets are available");

  const entry: WaitlistEntryRecord = {
    id: nextId(context.store),
    eventId,
    tierId: obj.tierId,
    customerId: actor.id,
    quantity: obj.quantity,
    createdAt: iso(context.now),
  };
  context.store.waitlist.push(entry);
  const position = context.store.waitlist.filter((w) => w.eventId === eventId && w.tierId === obj.tierId).findIndex((w) => w.id === entry.id) + 1;
  return { id: entry.id, eventId, tierId: obj.tierId, quantity: obj.quantity, position };
}

export function listMyWaitlist(context: ServiceContext, actor: AuthenticatedUser): WaitlistEntryView[] {
  applyLazyExpiration(context);
  if (actor.role !== "customer") throw new HttpError(403, "Forbidden");
  return context.store.waitlist
    .filter((w) => w.customerId === actor.id)
    .map((w) => ({
      id: w.id,
      eventId: w.eventId,
      tierId: w.tierId,
      quantity: w.quantity,
      position: context.store.waitlist.filter((x) => x.eventId === w.eventId && x.tierId === w.tierId).findIndex((x) => x.id === w.id) + 1,
    }));
}

export function getEventReport(context: ServiceContext, actor: AuthenticatedUser, eventId: string): EventReport {
  applyLazyExpiration(context);
  if (actor.role !== "organizer") throw new HttpError(403, "Forbidden");
  const e = eventById(context.store, eventId);
  if (!e) throw new HttpError(404, "Event not found");
  if (e.organizerId !== actor.id) throw new HttpError(403, "Forbidden");

  const tiers = e.tiers.map((t) => {
    let sold = 0;
    let held = 0;
    for (const o of context.store.orders) {
      if (o.eventId !== e.id || (o.status !== "paid" && o.status !== "held")) continue;
      for (const i of o.items) {
        if (i.tierId !== t.id) continue;
        if (o.status === "paid") sold += i.quantity;
        else held += i.quantity;
      }
    }
    return { tierId: t.id, name: t.name, sold, held, available: t.quantity - sold - held };
  });

  let grossCents = 0;
  let discountCents = 0;
  let refundedCents = 0;
  let netCents = 0;
  for (const o of context.store.orders) {
    if (o.eventId !== e.id) continue;
    if (o.status === "paid") {
      grossCents += o.subtotalCents;
      discountCents += o.discountCents;
      netCents += o.totalCents;
    } else if (o.status === "refunded") {
      refundedCents += o.totalCents;
    }
  }

  return { eventId, tiers, grossCents, discountCents, refundedCents, netCents };
}
