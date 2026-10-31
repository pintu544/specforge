import { HttpError } from "./errors.js";
import type { PublicUser } from "./auth.js";
import {
  generateId,
  type DiscountRecord,
  type EventRecord,
  type OrderRecord,
  type Store,
  type WaitlistRecord,
} from "./store.js";

export type EventTierView = { id: string; name: string; priceCents: number; quantity: number; available: number };
export type EventView = { id: string; title: string; venue: string; startsAt: string; status: "on_sale" | "cancelled"; organizerId: string; tiers: EventTierView[] };
export type DiscountView = { code: string; percentOff: number | null; amountOffCents: number | null; maxUses: number | null; expiresAt: string | null; uses: number };
export type OrderItemView = { tierId: string; quantity: number; unitPriceCents: number };
export type OrderView = { id: string; eventId: string; customerId: string; status: "held" | "paid" | "expired" | "cancelled" | "refunded"; items: OrderItemView[]; subtotalCents: number; discountCode: string | null; discountCents: number; totalCents: number; createdAt: string; expiresAt: string; paidAt: string | null };
export type WaitlistView = { id: string; eventId: string; tierId: string; quantity: number; position: number };
export type ReportView = { eventId: string; tiers: { tierId: string; name: string; sold: number; held: number; available: number }[]; grossCents: number; discountCents: number; refundedCents: number; netCents: number };

const MAX_TICKETS_PER_CUSTOMER = 6;

function nowMs(): number { return Date.now(); }
function iso(ms: number): string { return new Date(ms).toISOString(); }
function parseMs(value: string): number { return Date.parse(value); }
function isValidParsedTime(value: string): boolean { return !Number.isNaN(parseMs(value)); }

function reconcileExpiredHeldOrders(store: Store): void {
  const now = nowMs();
  const affected = new Set<string>();
  for (const order of store.orders.values()) {
    if (order.status === "held" && parseMs(order.expiresAt) <= now) {
      order.status = "expired";
      affected.add(order.eventId);
    }
  }
  for (const eventId of affected) serveWaitlistsForEvent(store, eventId);
}

function eventAvailability(store: Store, event: EventRecord, tierId: string): number {
  const tier = event.tiers.find((t) => t.id === tierId)!;
  let held = 0;
  let paid = 0;
  for (const order of store.orders.values()) {
    if (order.eventId !== event.id) continue;
    if (order.status !== "held" && order.status !== "paid") continue;
    for (const item of order.items) {
      if (item.tierId !== tierId) continue;
      if (order.status === "held") held += item.quantity; else paid += item.quantity;
    }
  }
  return tier.quantity - held - paid;
}

function eventToView(store: Store, event: EventRecord): EventView {
  return {
    id: event.id,
    title: event.title,
    venue: event.venue,
    startsAt: iso(parseMs(event.startsAt)),
    status: event.status,
    organizerId: event.organizerId,
    tiers: event.tiers.map((tier) => ({ id: tier.id, name: tier.name, priceCents: tier.priceCents, quantity: tier.quantity, available: eventAvailability(store, event, tier.id) })),
  };
}

function orderToView(order: OrderRecord): OrderView {
  return {
    id: order.id,
    eventId: order.eventId,
    customerId: order.customerId,
    status: order.status,
    items: order.items.map((item) => ({ ...item })),
    subtotalCents: order.subtotalCents,
    discountCode: order.discountCode,
    discountCents: order.discountCents,
    totalCents: order.totalCents,
    createdAt: iso(parseMs(order.createdAt)),
    expiresAt: iso(parseMs(order.expiresAt)),
    paidAt: order.paidAt ? iso(parseMs(order.paidAt)) : null,
  };
}

function discountUses(store: Store, discount: DiscountRecord): number {
  let uses = 0;
  for (const order of store.orders.values()) if (order.eventId === discount.eventId && order.discountCode === discount.code && (order.status === "held" || order.status === "paid")) uses++;
  return uses;
}

function discountToView(store: Store, discount: DiscountRecord): DiscountView {
  return { code: discount.code, percentOff: discount.percentOff, amountOffCents: discount.amountOffCents, maxUses: discount.maxUses, expiresAt: discount.expiresAt ? iso(parseMs(discount.expiresAt)) : null, uses: discountUses(store, discount) };
}

function customerLiveTicketCount(store: Store, eventId: string, customerId: string): number {
  let count = 0;
  for (const order of store.orders.values()) {
    if (order.eventId !== eventId || order.customerId !== customerId) continue;
    if (order.status !== "held" && order.status !== "paid") continue;
    for (const item of order.items) count += item.quantity;
  }
  return count;
}

function serveWaitlistsForEvent(store: Store, eventId: string): void {
  const event = store.events.get(eventId);
  if (!event) return;
  for (const tier of event.tiers) {
    const key = `${eventId}:${tier.id}`;
    const queue = store.waitlistsByTierKey.get(key);
    if (!queue || queue.length === 0) continue;
    while (queue.length > 0) {
      const first = queue[0];
      if (eventAvailability(store, event, tier.id) < first.quantity) break;
      if (customerLiveTicketCount(store, eventId, first.customerId) + first.quantity > MAX_TICKETS_PER_CUSTOMER) { queue.shift(); continue; }
      queue.shift();
      const createdAt = nowMs();
      const order: OrderRecord = { id: generateId(store), eventId, customerId: first.customerId, status: "held", items: [{ tierId: tier.id, quantity: first.quantity, unitPriceCents: tier.priceCents }], subtotalCents: first.quantity * tier.priceCents, discountCode: null, discountCents: 0, totalCents: first.quantity * tier.priceCents, createdAt: iso(createdAt), expiresAt: iso(createdAt + store.holdSeconds * 1000), paidAt: null };
      store.orders.set(order.id, order);
    }
    if (queue.length === 0) store.waitlistsByTierKey.delete(key);
  }
}

function requireEvent(store: Store, eventId: string): EventRecord { const event = store.events.get(eventId); if (!event) throw new HttpError(404, "Event not found"); return event; }

export function createEvent(store: Store, organizer: PublicUser, input: { title: string; venue: string; startsAt: string; tiers: { name: string; priceCents: number; quantity: number }[] }): EventView {
  if (typeof input.title !== "string" || input.title.length < 1 || input.title.length > 100 || typeof input.venue !== "string" || input.venue.length < 1 || input.venue.length > 100 || typeof input.startsAt !== "string" || !isValidParsedTime(input.startsAt) || parseMs(input.startsAt) <= nowMs() || !Array.isArray(input.tiers) || input.tiers.length < 1 || input.tiers.length > 5) throw new HttpError(400, "Invalid event input");
  const names = new Set<string>();
  for (const tier of input.tiers) if (typeof tier.name !== "string" || names.has(tier.name) || !Number.isInteger(tier.priceCents) || tier.priceCents < 0 || !Number.isInteger(tier.quantity) || tier.quantity < 1 || tier.quantity > 10000) throw new HttpError(400, "Invalid event input"); else names.add(tier.name);
  const event: EventRecord = { id: generateId(store), title: input.title, venue: input.venue, startsAt: iso(parseMs(input.startsAt)), status: "on_sale", organizerId: organizer.id, tiers: input.tiers.map((tier) => ({ id: generateId(store), name: tier.name, priceCents: tier.priceCents, quantity: tier.quantity })) };
  store.events.set(event.id, event);
  return eventToView(store, event);
}

export function listEvents(store: Store, query: { from?: string; to?: string; q?: string; page?: string; pageSize?: string }): { items: EventView[]; page: number; pageSize: number; total: number } {
  reconcileExpiredHeldOrders(store);
  if ((query.from !== undefined && !isValidParsedTime(query.from)) || (query.to !== undefined && !isValidParsedTime(query.to)) || (query.page !== undefined && !/^[0-9]+$/.test(query.page)) || (query.pageSize !== undefined && (!/^[0-9]+$/.test(query.pageSize) || Number(query.pageSize) > 50))) throw new HttpError(400, "Invalid query");
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? 10 : Number(query.pageSize);
  if (page < 1 || pageSize < 1 || pageSize > 50) throw new HttpError(400, "Invalid query");
  const from = query.from === undefined ? undefined : parseMs(query.from);
  const to = query.to === undefined ? undefined : parseMs(query.to);
  const q = query.q?.toLowerCase();
  const items = Array.from(store.events.values()).filter((e) => e.status === "on_sale").filter((e) => (from === undefined || parseMs(e.startsAt) >= from) && (to === undefined || parseMs(e.startsAt) <= to) && (!q || e.title.toLowerCase().includes(q) || e.venue.toLowerCase().includes(q))).sort((a, b) => parseMs(a.startsAt) - parseMs(b.startsAt) || a.title.localeCompare(b.title));
  const total = items.length;
  return { items: items.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((e) => eventToView(store, e)), page, pageSize, total };
}

export function getEvent(store: Store, eventId: string): EventView { reconcileExpiredHeldOrders(store); return eventToView(store, requireEvent(store, eventId)); }

export function cancelEvent(store: Store, organizer: PublicUser, eventId: string): EventView {
  reconcileExpiredHeldOrders(store);
  const event = requireEvent(store, eventId);
  if (event.organizerId !== organizer.id) throw new HttpError(403, "Forbidden");
  if (event.status === "cancelled") throw new HttpError(409, "Event already cancelled");
  event.status = "cancelled";
  for (const order of store.orders.values()) if (order.eventId === event.id) { if (order.status === "paid") order.status = "refunded"; else if (order.status === "held") order.status = "cancelled"; }
  for (const tier of event.tiers) store.waitlistsByTierKey.delete(`${event.id}:${tier.id}`);
  return eventToView(store, event);
}

export function createDiscount(store: Store, organizer: PublicUser, eventId: string, input: { code: string; percentOff?: number; amountOffCents?: number; maxUses?: number; expiresAt?: string }): DiscountView {
  if (typeof input.code !== "string" || input.code.length < 3 || input.code.length > 20 || !/^[A-Za-z0-9]+$/.test(input.code) || ((input.percentOff === undefined) === (input.amountOffCents === undefined)) || (input.percentOff !== undefined && (!Number.isInteger(input.percentOff) || input.percentOff < 1 || input.percentOff > 100)) || (input.amountOffCents !== undefined && (!Number.isInteger(input.amountOffCents) || input.amountOffCents < 1)) || (input.maxUses !== undefined && (!Number.isInteger(input.maxUses) || input.maxUses < 1)) || (input.expiresAt !== undefined && !isValidParsedTime(input.expiresAt))) throw new HttpError(400, "Invalid discount input");
  const event = requireEvent(store, eventId);
  if (event.organizerId !== organizer.id) throw new HttpError(403, "Forbidden");
  const code = input.code.toUpperCase();
  const map = store.discountsByEventId.get(eventId) ?? new Map<string, DiscountRecord>();
  if (map.has(code)) throw new HttpError(409, "Discount code already exists");
  const discount: DiscountRecord = { eventId, code, percentOff: input.percentOff ?? null, amountOffCents: input.amountOffCents ?? null, maxUses: input.maxUses ?? null, expiresAt: input.expiresAt ? iso(parseMs(input.expiresAt)) : null };
  map.set(code, discount);
  store.discountsByEventId.set(eventId, map);
  return discountToView(store, discount);
}

export function createOrder(store: Store, customer: PublicUser, input: { eventId: string; items: { tierId: string; quantity: number }[]; discountCode?: string }): OrderView {
  reconcileExpiredHeldOrders(store);
  if (typeof input.eventId !== "string" || !Array.isArray(input.items) || input.items.length < 1) throw new HttpError(400, "Invalid order input");
  const seen = new Set<string>();
  for (const item of input.items) if (typeof item.tierId !== "string" || !Number.isInteger(item.quantity) || item.quantity < 1 || seen.has(item.tierId)) throw new HttpError(400, "Invalid order input"); else seen.add(item.tierId);
  const event = requireEvent(store, input.eventId);
  const tierMap = new Map(event.tiers.map((tier) => [tier.id, tier]));
  for (const item of input.items) if (!tierMap.has(item.tierId)) throw new HttpError(400, "Invalid order input");
  if (event.status !== "on_sale" || parseMs(event.startsAt) <= nowMs()) throw new HttpError(409, "Event not available for ordering");
  for (const item of input.items) if (eventAvailability(store, event, item.tierId) < item.quantity) throw new HttpError(409, "Not enough tickets available");
  const requested = input.items.reduce((sum, item) => sum + item.quantity, 0);
  if (customerLiveTicketCount(store, event.id, customer.id) + requested > MAX_TICKETS_PER_CUSTOMER) throw new HttpError(422, "Ticket limit exceeded");
  let discount: DiscountRecord | null = null;
  if (input.discountCode !== undefined) {
    const candidate = store.discountsByEventId.get(event.id)?.get(input.discountCode.toUpperCase());
    if (!candidate || (candidate.expiresAt !== null && parseMs(candidate.expiresAt) <= nowMs()) || (candidate.maxUses !== null && discountUses(store, candidate) >= candidate.maxUses)) throw new HttpError(422, "Discount code unusable");
    discount = candidate;
  }
  const items = input.items.map((item) => ({ tierId: item.tierId, quantity: item.quantity, unitPriceCents: tierMap.get(item.tierId)!.priceCents }));
  const subtotalCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const discountCents = discount ? (discount.percentOff !== null ? Math.floor((subtotalCents * discount.percentOff) / 100) : Math.min(discount.amountOffCents!, subtotalCents)) : 0;
  const createdAt = nowMs();
  const order: OrderRecord = { id: generateId(store), eventId: event.id, customerId: customer.id, status: "held", items, subtotalCents, discountCode: discount ? discount.code : null, discountCents, totalCents: subtotalCents - discountCents, createdAt: iso(createdAt), expiresAt: iso(createdAt + store.holdSeconds * 1000), paidAt: null };
  store.orders.set(order.id, order);
  return orderToView(order);
}

export function payOrder(store: Store, customer: PublicUser, orderId: string): OrderView {
  reconcileExpiredHeldOrders(store);
  const order = store.orders.get(orderId);
  if (!order || order.customerId !== customer.id) throw new HttpError(404, "Order not found");
  if (order.status !== "held") throw new HttpError(409, "Order not payable");
  order.status = "paid";
  order.paidAt = iso(nowMs());
  return orderToView(order);
}

export function cancelOrder(store: Store, customer: PublicUser, orderId: string): OrderView {
  reconcileExpiredHeldOrders(store);
  const order = store.orders.get(orderId);
  if (!order || order.customerId !== customer.id) throw new HttpError(404, "Order not found");
  if (order.status === "held") { order.status = "cancelled"; serveWaitlistsForEvent(store, order.eventId); return orderToView(order); }
  if (order.status === "paid") { const event = requireEvent(store, order.eventId); if (parseMs(event.startsAt) - nowMs() <= 24 * 60 * 60 * 1000) throw new HttpError(409, "Order not cancellable"); order.status = "refunded"; serveWaitlistsForEvent(store, order.eventId); return orderToView(order); }
  throw new HttpError(409, "Order not cancellable");
}

export function getOrder(store: Store, caller: PublicUser, orderId: string): OrderView {
  reconcileExpiredHeldOrders(store);
  const order = store.orders.get(orderId);
  if (!order) throw new HttpError(404, "Order not found");
  if (caller.role === "customer" && order.customerId === caller.id) return orderToView(order);
  if (caller.role === "organizer") { const event = store.events.get(order.eventId); if (event && event.organizerId === caller.id) return orderToView(order); }
  throw new HttpError(404, "Order not found");
}

export function listCustomerOrders(store: Store, customer: PublicUser): OrderView[] {
  reconcileExpiredHeldOrders(store);
  return Array.from(store.orders.values()).filter((order) => order.customerId === customer.id).sort((a, b) => parseMs(b.createdAt) - parseMs(a.createdAt) || b.id.localeCompare(a.id)).map(orderToView);
}

export function joinWaitlist(store: Store, customer: PublicUser, eventId: string, input: { tierId: string; quantity: number }): WaitlistView {
  reconcileExpiredHeldOrders(store);
  if (typeof input.tierId !== "string" || !Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 6) throw new HttpError(400, "Invalid waitlist input");
  const event = requireEvent(store, eventId);
  const tier = event.tiers.find((t) => t.id === input.tierId);
  if (!tier) throw new HttpError(400, "Invalid waitlist input");
  if (eventAvailability(store, event, tier.id) >= input.quantity) throw new HttpError(409, "Tickets available");
  const key = `${eventId}:${tier.id}`;
  const queue = store.waitlistsByTierKey.get(key) ?? [];
  if (queue.some((entry) => entry.customerId === customer.id)) throw new HttpError(409, "Already waitlisted");
  const entry: WaitlistRecord = { id: generateId(store), eventId, tierId: tier.id, quantity: input.quantity, customerId: customer.id };
  queue.push(entry);
  store.waitlistsByTierKey.set(key, queue);
  return { id: entry.id, eventId, tierId: tier.id, quantity: entry.quantity, position: queue.length };
}

export function listCustomerWaitlist(store: Store, customer: PublicUser): WaitlistView[] {
  reconcileExpiredHeldOrders(store);
  const result: WaitlistView[] = [];
  for (const queue of store.waitlistsByTierKey.values()) queue.forEach((entry, index) => { if (entry.customerId === customer.id) result.push({ id: entry.id, eventId: entry.eventId, tierId: entry.tierId, quantity: entry.quantity, position: index + 1 }); });
  return result;
}

export function getEventReport(store: Store, organizer: PublicUser, eventId: string): ReportView {
  reconcileExpiredHeldOrders(store);
  const event = requireEvent(store, eventId);
  if (event.organizerId !== organizer.id) throw new HttpError(403, "Forbidden");
  const tiers = event.tiers.map((tier) => { let sold = 0; let held = 0; for (const order of store.orders.values()) { if (order.eventId !== event.id) continue; const qty = order.items.filter((item) => item.tierId === tier.id).reduce((sum, item) => sum + item.quantity, 0); if (order.status === "paid") sold += qty; else if (order.status === "held") held += qty; } return { tierId: tier.id, name: tier.name, sold, held, available: tier.quantity - sold - held }; });
  let grossCents = 0; let discountCents = 0; let refundedCents = 0; let netCents = 0;
  for (const order of store.orders.values()) { if (order.eventId !== event.id) continue; if (order.status === "paid") { grossCents += order.subtotalCents; discountCents += order.discountCents; netCents += order.totalCents; } else if (order.status === "refunded") refundedCents += order.totalCents; }
  return { eventId, tiers, grossCents, discountCents, refundedCents, netCents };
}
