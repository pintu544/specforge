import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, generateId } from "../src/store.js";
import type {
  Role,
  User,
  PublicUser,
  Session,
  EventStatus,
  StoredTier,
  EventRecord,
  EventTier,
  Event,
  OrderStatus,
  OrderItem,
  Order,
  DiscountRecord,
  Discount,
  WaitlistEntryRecord,
  WaitlistEntry,
  EventReportTier,
  EventReport,
  CreateUserInput,
  CreateSessionInput,
  CreateEventTierInput,
  CreateEventInput,
  ListEventsQuery,
  PaginatedEvents,
  CreateDiscountInput,
  CreateOrderItemInput,
  CreateOrderInput,
  JoinWaitlistInput,
  Store,
} from "../src/store.js";

test("createStore returns a fresh empty store", () => {
  const store = createStore();

  assert.deepEqual(store, {
    nextId: 1,
    users: [],
    sessions: [],
    events: [],
    orders: [],
    discounts: [],
    waitlistEntries: [],
  });

  const another = createStore();
  assert.notStrictEqual(store, another);
  assert.notStrictEqual(store.users, another.users);
  assert.notStrictEqual(store.sessions, another.sessions);
  assert.notStrictEqual(store.events, another.events);
  assert.notStrictEqual(store.orders, another.orders);
  assert.notStrictEqual(store.discounts, another.discounts);
  assert.notStrictEqual(store.waitlistEntries, another.waitlistEntries);
});

test("generateId increments per store and stays unique within the store", () => {
  const store = createStore();

  assert.equal(generateId(store), "id-1");
  assert.equal(store.nextId, 2);
  assert.equal(generateId(store), "id-2");
  assert.equal(generateId(store), "id-3");
  assert.equal(store.nextId, 4);

  const other = createStore();
  assert.equal(generateId(other), "id-1");
  assert.equal(generateId(other), "id-2");
  assert.equal(generateId(store), "id-4");
});

test("exported shared types accept and preserve the documented shapes", () => {
  const role: Role = "organizer";
  const user: User = {
    id: "u1",
    email: "a@example.com",
    password: "secret",
    name: "Ada",
    role,
  };
  const publicUser: PublicUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
  const session: Session = { token: "tok", userId: user.id };
  const eventStatus: EventStatus = "on_sale";
  const storedTier: StoredTier = { id: "t1", name: "VIP", priceCents: 5000, quantity: 10 };
  const eventRecord: EventRecord = {
    id: "e1",
    title: "Concert",
    venue: "Hall",
    startsAt: "2026-01-01T20:00:00.000Z",
    status: eventStatus,
    organizerId: user.id,
    tiers: [storedTier],
  };
  const eventTier: EventTier = { ...storedTier, available: 7 };
  const event: Event = { ...eventRecord, tiers: [eventTier] };
  const orderStatus: OrderStatus = "held";
  const orderItem: OrderItem = { tierId: storedTier.id, quantity: 2, unitPriceCents: 5000 };
  const order: Order = {
    id: "o1",
    eventId: event.id,
    customerId: publicUser.id,
    status: orderStatus,
    items: [orderItem],
    subtotalCents: 10000,
    discountCode: null,
    discountCents: 0,
    totalCents: 10000,
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:15:00.000Z",
    paidAt: null,
  };
  const discountRecord: DiscountRecord = {
    eventId: event.id,
    code: "SAVE10",
    percentOff: 10,
    amountOffCents: null,
    maxUses: 5,
    expiresAt: null,
  };
  const discount: Discount = { ...discountRecord, uses: 1 };
  const waitlistRecord: WaitlistEntryRecord = {
    id: "w1",
    eventId: event.id,
    tierId: storedTier.id,
    customerId: publicUser.id,
    quantity: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const waitlistEntry: WaitlistEntry = {
    id: waitlistRecord.id,
    eventId: waitlistRecord.eventId,
    tierId: waitlistRecord.tierId,
    quantity: waitlistRecord.quantity,
    position: 1,
  };
  const reportTier: EventReportTier = { tierId: storedTier.id, name: storedTier.name, sold: 2, held: 1, available: 7 };
  const report: EventReport = {
    eventId: event.id,
    tiers: [reportTier],
    grossCents: 10000,
    discountCents: 1000,
    refundedCents: 0,
    netCents: 9000,
  };
  const createUserInput: CreateUserInput = {
    email: user.email,
    password: user.password,
    name: user.name,
    role: user.role,
  };
  const createSessionInput: CreateSessionInput = { email: user.email, password: user.password };
  const createEventTierInput: CreateEventTierInput = {
    name: storedTier.name,
    priceCents: storedTier.priceCents,
    quantity: storedTier.quantity,
  };
  const createEventInput: CreateEventInput = {
    title: event.title,
    venue: event.venue,
    startsAt: event.startsAt,
    tiers: [createEventTierInput],
  };
  const listEventsQuery: ListEventsQuery = { from: event.startsAt, q: "concert", page: "1", pageSize: "20" };
  const paginatedEvents: PaginatedEvents = { items: [event], page: 1, pageSize: 20, total: 1 };
  const createDiscountInput: CreateDiscountInput = { code: discount.code, percentOff: 10, maxUses: 5 };
  const createOrderItemInput: CreateOrderItemInput = { tierId: storedTier.id, quantity: 2 };
  const createOrderInput: CreateOrderInput = { eventId: event.id, items: [createOrderItemInput], discountCode: discount.code };
  const joinWaitlistInput: JoinWaitlistInput = { tierId: storedTier.id, quantity: 1 };
  const store: Store = {
    nextId: 99,
    users: [user],
    sessions: [session],
    events: [eventRecord],
    orders: [order],
    discounts: [discountRecord],
    waitlistEntries: [waitlistRecord],
  };

  assert.deepEqual(publicUser, { id: "u1", email: "a@example.com", name: "Ada", role: "organizer" });
  assert.deepEqual(eventTier, { id: "t1", name: "VIP", priceCents: 5000, quantity: 10, available: 7 });
  assert.deepEqual(event, {
    id: "e1",
    title: "Concert",
    venue: "Hall",
    startsAt: "2026-01-01T20:00:00.000Z",
    status: "on_sale",
    organizerId: "u1",
    tiers: [{ id: "t1", name: "VIP", priceCents: 5000, quantity: 10, available: 7 }],
  });
  assert.deepEqual(discount, {
    eventId: "e1",
    code: "SAVE10",
    percentOff: 10,
    amountOffCents: null,
    maxUses: 5,
    expiresAt: null,
    uses: 1,
  });
  assert.deepEqual(waitlistEntry, {
    id: "w1",
    eventId: "e1",
    tierId: "t1",
    quantity: 1,
    position: 1,
  });
  assert.deepEqual(report, {
    eventId: "e1",
    tiers: [{ tierId: "t1", name: "VIP", sold: 2, held: 1, available: 7 }],
    grossCents: 10000,
    discountCents: 1000,
    refundedCents: 0,
    netCents: 9000,
  });
  assert.deepEqual(createEventInput, {
    title: "Concert",
    venue: "Hall",
    startsAt: "2026-01-01T20:00:00.000Z",
    tiers: [{ name: "VIP", priceCents: 5000, quantity: 10 }],
  });
  assert.deepEqual(listEventsQuery, { from: "2026-01-01T20:00:00.000Z", q: "concert", page: "1", pageSize: "20" });
  assert.deepEqual(paginatedEvents, { items: [event], page: 1, pageSize: 20, total: 1 });
  assert.deepEqual(createDiscountInput, { code: "SAVE10", percentOff: 10, maxUses: 5 });
  assert.deepEqual(createOrderInput, { eventId: "e1", items: [{ tierId: "t1", quantity: 2 }], discountCode: "SAVE10" });
  assert.deepEqual(joinWaitlistInput, { tierId: "t1", quantity: 1 });
  assert.deepEqual(store, {
    nextId: 99,
    users: [user],
    sessions: [session],
    events: [eventRecord],
    orders: [order],
    discounts: [discountRecord],
    waitlistEntries: [waitlistRecord],
  });
});
