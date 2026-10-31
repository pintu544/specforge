import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createStore,
  nextId,
} from "../src/store.js";

import type {
  UserRole,
  EventStatus,
  OrderStatus,
  UserRecord,
  SessionRecord,
  EventTierRecord,
  DiscountRecord,
  EventRecord,
  OrderItemRecord,
  OrderRecord,
  WaitlistEntryRecord,
  Store,
} from "../src/store.js";

test("createStore returns a fresh empty store", () => {
  const store = createStore();

  assert.deepEqual(store, {
    users: [],
    sessions: [],
    events: [],
    orders: [],
    waitlist: [],
    nextIdValue: 1,
  });
});

test("createStore returns independent stores", () => {
  const first = createStore();
  const second = createStore();

  first.users.push({
    id: "id_1",
    email: "a@example.com",
    emailKey: "a@example.com",
    password: "secret",
    name: "A",
    role: "customer",
  });

  assert.equal(second.users.length, 0);
  assert.equal(second.nextIdValue, 1);
});

test("nextId returns sequential unique ids and advances the store counter", () => {
  const store = createStore();

  assert.equal(nextId(store), "id_1");
  assert.equal(store.nextIdValue, 2);
  assert.equal(nextId(store), "id_2");
  assert.equal(store.nextIdValue, 3);
});

test("nextId continues from the current nextIdValue", () => {
  const store = createStore();
  store.nextIdValue = 41;

  assert.equal(nextId(store), "id_41");
  assert.equal(nextId(store), "id_42");
});

test("exported record and union types are assignable to valid values", () => {
  const role: UserRole = "organizer";
  const eventStatus: EventStatus = "on_sale";
  const orderStatus: OrderStatus = "paid";

  const user: UserRecord = {
    id: "id_1",
    email: "organizer@example.com",
    emailKey: "organizer@example.com",
    password: "pw",
    name: "Organizer",
    role,
  };

  const session: SessionRecord = {
    token: "token_1",
    userId: user.id,
  };

  const tier: EventTierRecord = {
    id: "id_2",
    name: "General Admission",
    priceCents: 2500,
    quantity: 100,
  };

  const discount: DiscountRecord = {
    code: "SAVE10",
    percentOff: 10,
    amountOffCents: null,
    maxUses: 50,
    expiresAt: null,
  };

  const event: EventRecord = {
    id: "id_3",
    title: "Showcase",
    venue: "Main Hall",
    startsAt: "2026-01-01T19:00:00.000Z",
    status: eventStatus,
    organizerId: user.id,
    tiers: [tier],
    discounts: [discount],
  };

  const item: OrderItemRecord = {
    tierId: tier.id,
    quantity: 2,
    unitPriceCents: tier.priceCents,
  };

  const order: OrderRecord = {
    id: "id_4",
    eventId: event.id,
    customerId: "id_5",
    status: orderStatus,
    items: [item],
    subtotalCents: 5000,
    discountCode: discount.code,
    discountCents: 500,
    totalCents: 4500,
    createdAt: "2025-01-01T00:00:00.000Z",
    expiresAt: "2025-01-01T00:15:00.000Z",
    paidAt: "2025-01-01T00:05:00.000Z",
  };

  const waitlistEntry: WaitlistEntryRecord = {
    id: "id_6",
    eventId: event.id,
    tierId: tier.id,
    customerId: "id_5",
    quantity: 1,
    createdAt: "2025-01-01T00:10:00.000Z",
  };

  const store: Store = {
    users: [user],
    sessions: [session],
    events: [event],
    orders: [order],
    waitlist: [waitlistEntry],
    nextIdValue: 7,
  };

  assert.equal(store.users[0].role, "organizer");
  assert.equal(store.events[0].status, "on_sale");
  assert.equal(store.orders[0].status, "paid");
  assert.equal(store.waitlist[0].quantity, 1);
});
