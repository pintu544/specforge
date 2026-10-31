import type {
  CreateDiscountInput,
  CreateEventInput,
  CreateOrderInput,
  Discount,
  DiscountRecord,
  Event,
  EventReport,
  EventRecord,
  EventStatus,
  EventTier,
  JoinWaitlistInput,
  ListEventsQuery,
  Order,
  OrderItem,
  OrderStatus,
  PaginatedEvents,
  Store,
  StoredTier,
  WaitlistEntry,
} from "./store.js";
import { generateId } from "./store.js";

function isIntegerString(value: string): boolean {
  return /^-?\d+$/.test(value);
}

function computeEventView(store: Store, event: EventRecord): Event {
  const tiers: EventTier[] = event.tiers.map((tier) => ({
    id: tier.id,
    name: tier.name,
    priceCents: tier.priceCents,
    quantity: tier.quantity,
    available: tier.quantity - countTickets(store, event.id, tier.id, ["held", "paid"]),
  }));
  return { ...event, tiers };
}

function countTickets(store: Store, eventId: string, tierId: string, statuses: OrderStatus[]): number {
  let total = 0;
  for (const order of store.orders) {
    if (order.eventId !== eventId || !statuses.includes(order.status)) continue;
    for (const item of order.items) {
      if (item.tierId === tierId) total += item.quantity;
    }
  }
  return total;
}

function orderTotalTickets(order: Order): number {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

function getEventRecord(store: Store, eventId: string): EventRecord | undefined {
  return store.events.find((event) => event.id === eventId);
}

function getTierRecord(event: EventRecord, tierId: string): StoredTier | undefined {
  return event.tiers.find((tier) => tier.id === tierId);
}

function availableForTier(store: Store, eventId: string, tierId: string): number {
  const event = getEventRecord(store, eventId);
  if (!event) return 0;
  const tier = getTierRecord(event, tierId);
  if (!tier) return 0;
  return tier.quantity - countTickets(store, eventId, tierId, ["held", "paid"]);
}

function discountUses(store: Store, eventId: string, code: string): number {
  const normalized = code.toUpperCase();
  let uses = 0;
  for (const order of store.orders) {
    if (order.eventId !== eventId) continue;
    if (order.discountCode !== normalized) continue;
    if (order.status === "held" || order.status === "paid") uses += 1;
  }
  return uses;
}

function serveWaitlistForEventTier(store: Store, eventId: string, tierId: string, now: Date, holdSeconds: number): void {
  while (true) {
    const index = store.waitlistEntries.findIndex((entry) => entry.eventId === eventId && entry.tierId === tierId);
    if (index === -1) return;
    const entry = store.waitlistEntries[index];
    const event = getEventRecord(store, eventId);
    if (!event) return;
    const tier = getTierRecord(event, tierId);
    if (!tier) return;
    const currentAvailable = availableForTier(store, eventId, tierId);
    if (currentAvailable < entry.quantity) return;
    const customerTotal = store.orders.reduce((sum, order) => {
      if (order.eventId !== eventId) return sum;
      if (order.customerId !== entry.customerId) return sum;
      if (order.status !== "held" && order.status !== "paid") return sum;
      return sum + orderTotalTickets(order);
    }, 0);
    if (customerTotal + entry.quantity > 6) {
      store.waitlistEntries.splice(index, 1);
      continue;
    }
    const orderId = generateId(store);
    const item: OrderItem = { tierId, quantity: entry.quantity, unitPriceCents: tier.priceCents };
    const subtotalCents = item.quantity * item.unitPriceCents;
    const order: Order = {
      id: orderId,
      eventId,
      customerId: entry.customerId,
      status: "held",
      items: [item],
      subtotalCents,
      discountCode: null,
      discountCents: 0,
      totalCents: subtotalCents,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + holdSeconds * 1000).toISOString(),
      paidAt: null,
    };
    store.orders.push(order);
    store.waitlistEntries.splice(index, 1);
  }
}

export function refreshExpirations(store: Store, now: Date, holdSeconds: number): void {
  const affected: Array<{ eventId: string; tierId: string }> = [];
  for (const order of store.orders) {
    if (order.status !== "held") continue;
    if (Date.parse(order.expiresAt) <= now.getTime()) {
      order.status = "expired";
      for (const item of order.items) {
        affected.push({ eventId: order.eventId, tierId: item.tierId });
      }
    }
  }
  for (const pair of affected) {
    serveWaitlistForEventTier(store, pair.eventId, pair.tierId, now, holdSeconds);
  }
}

export function createEvent(store: Store, organizerId: string, input: CreateEventInput, now: Date): Event {
  if (
    typeof input.title !== "string" ||
    input.title.length < 1 ||
    input.title.length > 100 ||
    typeof input.venue !== "string" ||
    input.venue.length < 1 ||
    input.venue.length > 100 ||
    typeof input.startsAt !== "string" ||
    Number.isNaN(Date.parse(input.startsAt)) ||
    Date.parse(input.startsAt) <= now.getTime() ||
    !Array.isArray(input.tiers) ||
    input.tiers.length < 1 ||
    input.tiers.length > 5
  ) {
    throw new Error("Invalid input");
  }
  const names = new Set<string>();
  const tiers: StoredTier[] = [];
  for (const tier of input.tiers) {
    if (
      typeof tier.name !== "string" ||
      names.has(tier.name) ||
      !Number.isInteger(tier.priceCents) ||
      tier.priceCents < 0 ||
      !Number.isInteger(tier.quantity) ||
      tier.quantity < 1 ||
      tier.quantity > 10000
    ) {
      throw new Error("Invalid input");
    }
    names.add(tier.name);
    tiers.push({ id: generateId(store), name: tier.name, priceCents: tier.priceCents, quantity: tier.quantity });
  }
  const event: EventRecord = {
    id: generateId(store),
    title: input.title,
    venue: input.venue,
    startsAt: input.startsAt,
    status: "on_sale",
    organizerId,
    tiers,
  };
  store.events.push(event);
  return computeEventView(store, event);
}

export function listPublicEvents(store: Store, query: ListEventsQuery): PaginatedEvents {
  const fromMs = query.from !== undefined ? Date.parse(query.from) : undefined;
  const toMs = query.to !== undefined ? Date.parse(query.to) : undefined;
  if ((query.from !== undefined && Number.isNaN(fromMs)) || (query.to !== undefined && Number.isNaN(toMs))) {
    throw new Error("Invalid input");
  }
  let page = 1;
  let pageSize = 10;
  if (query.page !== undefined) {
    if (!isIntegerString(query.page) || parseInt(query.page, 10) < 1) throw new Error("Invalid input");
    page = parseInt(query.page, 10);
  }
  if (query.pageSize !== undefined) {
    if (!isIntegerString(query.pageSize)) throw new Error("Invalid input");
    pageSize = parseInt(query.pageSize, 10);
    if (pageSize < 1 || pageSize > 50) throw new Error("Invalid input");
  }
  const q = query.q?.toLowerCase();
  const items = store.events
    .filter((event) => event.status === "on_sale")
    .filter((event) => (fromMs === undefined ? true : Date.parse(event.startsAt) >= fromMs))
    .filter((event) => (toMs === undefined ? true : Date.parse(event.startsAt) <= toMs))
    .filter((event) =>
      q === undefined ? true : event.title.toLowerCase().includes(q) || event.venue.toLowerCase().includes(q),
    )
    .slice()
    .sort((a, b) => {
      const at = Date.parse(a.startsAt) - Date.parse(b.startsAt);
      if (at !== 0) return at;
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    })
    .map((event) => computeEventView(store, event));
  const total = items.length;
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page, pageSize, total };
}

export function getEventById(store: Store, eventId: string): Event {
  const event = getEventRecord(store, eventId);
  if (!event) throw new Error("Not found");
  return computeEventView(store, event);
}

export function cancelEvent(store: Store, organizerId: string, eventId: string): Event {
  const event = getEventRecord(store, eventId);
  if (!event) throw new Error("Not found");
  if (event.organizerId !== organizerId) throw new Error("Forbidden");
  if (event.status === "cancelled") throw new Error("Conflict");
  event.status = "cancelled";
  for (const order of store.orders) {
    if (order.eventId !== eventId) continue;
    if (order.status === "paid") order.status = "refunded";
    else if (order.status === "held") order.status = "cancelled";
  }
  store.waitlistEntries = store.waitlistEntries.filter((entry) => entry.eventId !== eventId);
  return computeEventView(store, event);
}

export function createDiscount(store: Store, organizerId: string, eventId: string, input: CreateDiscountInput, now: Date): Discount {
  const hasPercent = Object.prototype.hasOwnProperty.call(input, "percentOff");
  const hasAmount = Object.prototype.hasOwnProperty.call(input, "amountOffCents");
  if (
    typeof input.code !== "string" ||
    !/^[A-Za-z0-9]{3,20}$/.test(input.code) ||
    hasPercent === hasAmount ||
    (hasPercent && (!Number.isInteger(input.percentOff ?? NaN) || (input.percentOff ?? 0) < 1 || (input.percentOff ?? 0) > 100)) ||
    (hasAmount && (!Number.isInteger(input.amountOffCents ?? NaN) || (input.amountOffCents ?? 0) < 1)) ||
    (input.maxUses !== undefined && (!Number.isInteger(input.maxUses) || input.maxUses < 1)) ||
    (input.expiresAt !== undefined && (typeof input.expiresAt !== "string" || Number.isNaN(Date.parse(input.expiresAt))))
  ) {
    throw new Error("Invalid input");
  }
  const event = getEventRecord(store, eventId);
  if (!event) throw new Error("Not found");
  if (event.organizerId !== organizerId) throw new Error("Forbidden");
  const code = input.code.toUpperCase();
  if (store.discounts.some((d) => d.eventId === eventId && d.code.toUpperCase() === code)) {
    throw new Error("Conflict");
  }
  const record: DiscountRecord = {
    eventId,
    code,
    percentOff: hasPercent ? input.percentOff! : null,
    amountOffCents: hasAmount ? input.amountOffCents! : null,
    maxUses: input.maxUses ?? null,
    expiresAt: input.expiresAt ?? null,
  };
  store.discounts.push(record);
  return { ...record, uses: discountUses(store, eventId, code) };
}

export function createOrder(store: Store, customerId: string, input: CreateOrderInput, now: Date, holdSeconds: number): Order {
  if (typeof input.eventId !== "string" || !Array.isArray(input.items) || input.items.length < 1) {
    throw new Error("Invalid input");
  }
  const seen = new Set<string>();
  for (const item of input.items) {
    if (typeof item.tierId !== "string" || !Number.isInteger(item.quantity) || item.quantity < 1 || seen.has(item.tierId)) {
      throw new Error("Invalid input");
    }
    seen.add(item.tierId);
  }
  const event = getEventRecord(store, input.eventId);
  if (!event) throw new Error("Not found");
  const tiersById = new Map(event.tiers.map((tier) => [tier.id, tier]));
  for (const item of input.items) {
    if (!tiersById.has(item.tierId)) throw new Error("Invalid input");
  }
  if (event.status !== "on_sale" || Date.parse(event.startsAt) <= now.getTime()) throw new Error("Conflict");
  for (const item of input.items) {
    if (availableForTier(store, event.id, item.tierId) < item.quantity) throw new Error("Conflict");
  }
  const requested = input.items.reduce((sum, item) => sum + item.quantity, 0);
  const existing = store.orders.reduce((sum, order) => {
    if (order.eventId !== event.id || order.customerId !== customerId) return sum;
    if (order.status !== "held" && order.status !== "paid") return sum;
    return sum + orderTotalTickets(order);
  }, 0);
  if (existing + requested > 6) throw new Error("Unprocessable");
  let discountRecord: DiscountRecord | undefined;
  let discountCode: string | null = null;
  if (input.discountCode !== undefined) {
    discountCode = input.discountCode.toUpperCase();
    discountRecord = store.discounts.find((d) => d.eventId === event.id && d.code.toUpperCase() === discountCode);
    if (!discountRecord) throw new Error("Unprocessable");
    if (discountRecord.expiresAt !== null && Date.parse(discountRecord.expiresAt) <= now.getTime()) throw new Error("Unprocessable");
    if (discountRecord.maxUses !== null && discountUses(store, event.id, discountCode) >= discountRecord.maxUses) {
      throw new Error("Unprocessable");
    }
  }
  const items: OrderItem[] = input.items.map((item) => ({
    tierId: item.tierId,
    quantity: item.quantity,
    unitPriceCents: tiersById.get(item.tierId)!.priceCents,
  }));
  const subtotalCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const discountCents =
    discountRecord === undefined
      ? 0
      : discountRecord.percentOff !== null
        ? Math.floor((subtotalCents * discountRecord.percentOff) / 100)
        : Math.min(discountRecord.amountOffCents!, subtotalCents);
  const order: Order = {
    id: generateId(store),
    eventId: event.id,
    customerId,
    status: "held",
    items,
    subtotalCents,
    discountCode,
    discountCents,
    totalCents: subtotalCents - discountCents,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + holdSeconds * 1000).toISOString(),
    paidAt: null,
  };
  store.orders.push(order);
  return order;
}

export function payOrder(store: Store, customerId: string, orderId: string, now: Date): Order {
  const order = store.orders.find((o) => o.id === orderId);
  if (!order || order.customerId !== customerId) throw new Error("Not found");
  if (order.status !== "held") throw new Error("Conflict");
  order.status = "paid";
  order.paidAt = now.toISOString();
  return order;
}

export function cancelOrder(store: Store, customerId: string, orderId: string, now: Date, holdSeconds: number): Order {
  const order = store.orders.find((o) => o.id === orderId);
  if (!order || order.customerId !== customerId) throw new Error("Not found");
  if (order.status === "held") {
    order.status = "cancelled";
    for (const item of order.items) serveWaitlistForEventTier(store, order.eventId, item.tierId, now, holdSeconds);
    return order;
  }
  if (order.status === "paid") {
    const event = getEventRecord(store, order.eventId);
    if (!event) throw new Error("Not found");
    if (Date.parse(event.startsAt) - now.getTime() <= 24 * 60 * 60 * 1000) throw new Error("Conflict");
    order.status = "refunded";
    for (const item of order.items) serveWaitlistForEventTier(store, order.eventId, item.tierId, now, holdSeconds);
    return order;
  }
  throw new Error("Conflict");
}

export function getVisibleOrder(store: Store, userId: string, orderId: string): Order {
  const order = store.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Not found");
  const event = getEventRecord(store, order.eventId);
  if (!event) throw new Error("Not found");
  if (order.customerId === userId || event.organizerId === userId) return order;
  throw new Error("Not found");
}

export function listCustomerOrders(store: Store, customerId: string): Order[] {
  return store.orders
    .map((order, index) => ({ order, index }))
    .filter(({ order }) => order.customerId === customerId)
    .sort((a, b) => {
      const diff = Date.parse(b.order.createdAt) - Date.parse(a.order.createdAt);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ order }) => order);
}

export function joinWaitlist(store: Store, customerId: string, eventId: string, input: JoinWaitlistInput): WaitlistEntry {
  if (typeof input.tierId !== "string" || !Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 6) {
    throw new Error("Invalid input");
  }
  const event = getEventRecord(store, eventId);
  if (!event) throw new Error("Not found");
  if (!getTierRecord(event, input.tierId)) throw new Error("Invalid input");
  if (store.waitlistEntries.some((e) => e.eventId === eventId && e.tierId === input.tierId && e.customerId === customerId)) {
    throw new Error("Conflict");
  }
  if (availableForTier(store, eventId, input.tierId) >= input.quantity) throw new Error("Conflict");
  const entry: WaitlistEntry = {
    id: generateId(store),
    eventId,
    tierId: input.tierId,
    quantity: input.quantity,
    position: 1,
  };
  store.waitlistEntries.push({ ...entry, customerId, createdAt: new Date().toISOString() });
  entry.position = store.waitlistEntries.filter((e) => e.eventId === eventId && e.tierId === input.tierId).length;
  return entry;
}

export function listCustomerWaitlist(store: Store, customerId: string): WaitlistEntry[] {
  return store.waitlistEntries
    .filter((entry) => entry.customerId === customerId)
    .map((entry) => ({
      id: entry.id,
      eventId: entry.eventId,
      tierId: entry.tierId,
      quantity: entry.quantity,
      position: store.waitlistEntries.filter((e) => e.eventId === entry.eventId && e.tierId === entry.tierId).findIndex((e) => e.id === entry.id) + 1,
    }));
}

export function getEventReport(store: Store, organizerId: string, eventId: string): EventReport {
  const event = getEventRecord(store, eventId);
  if (!event) throw new Error("Not found");
  if (event.organizerId !== organizerId) throw new Error("Forbidden");
  const tiers = event.tiers.map((tier) => {
    const sold = countTickets(store, eventId, tier.id, ["paid"]);
    const held = countTickets(store, eventId, tier.id, ["held"]);
    return { tierId: tier.id, name: tier.name, sold, held, available: tier.quantity - sold - held };
  });
  let grossCents = 0;
  let discountCents = 0;
  let netCents = 0;
  let refundedCents = 0;
  for (const order of store.orders) {
    if (order.eventId !== eventId) continue;
    if (order.status === "paid") {
      grossCents += order.subtotalCents;
      discountCents += order.discountCents;
      netCents += order.totalCents;
    } else if (order.status === "refunded") {
      refundedCents += order.totalCents;
    }
  }
  return { eventId, tiers, grossCents, discountCents, refundedCents, netCents };
}
