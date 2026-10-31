import { test } from "node:test";
import assert from "node:assert/strict";
import {
  refreshExpirations,
  createEvent,
  listPublicEvents,
  getEventById,
  cancelEvent,
  createDiscount,
  createOrder,
  payOrder,
  cancelOrder,
  getVisibleOrder,
  listCustomerOrders,
  joinWaitlist,
  listCustomerWaitlist,
  getEventReport,
} from "../src/boxOffice.js";
import { createStore } from "../src/store.js";

test("createEvent validates input, stores tiers, and returns available quantities", () => {
  const store = createStore();
  const now = new Date("2026-01-01T00:00:00.000Z");

  const event = createEvent(store, "org-1", {
    title: "Launch Night",
    venue: "Main Hall",
    startsAt: "2026-01-02T00:00:00.000Z",
    tiers: [
      { name: "General", priceCents: 2500, quantity: 3 },
      { name: "VIP", priceCents: 5000, quantity: 2 },
    ],
  }, now);

  assert.equal(event.status, "on_sale");
  assert.equal(event.organizerId, "org-1");
  assert.equal(event.tiers.length, 2);
  assert.deepEqual(event.tiers.map((tier) => tier.available), [3, 2]);
  assert.equal(store.events.length, 1);
  assert.deepEqual(store.events[0].tiers.map((tier) => tier.name), ["General", "VIP"]);

  assert.throws(() => createEvent(store, "org-1", {
    title: "",
    venue: "Main Hall",
    startsAt: "2026-01-02T00:00:00.000Z",
    tiers: [{ name: "A", priceCents: 0, quantity: 1 }],
  }, now), Error);

  assert.throws(() => createEvent(store, "org-1", {
    title: "X",
    venue: "Y",
    startsAt: "not-a-date",
    tiers: [{ name: "A", priceCents: 0, quantity: 1 }],
  }, now), Error);
});

test("listPublicEvents filters, sorts, paginates, and computes availability", () => {
  const store = createStore();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const early = createEvent(store, "org-1", {
    title: "Bravo",
    venue: "Arena",
    startsAt: "2026-01-05T10:00:00.000Z",
    tiers: [{ name: "T1", priceCents: 1000, quantity: 5 }],
  }, now);
  const sameTimeA = createEvent(store, "org-1", {
    title: "Alpha",
    venue: "Club",
    startsAt: "2026-01-05T10:00:00.000Z",
    tiers: [{ name: "T1", priceCents: 1000, quantity: 4 }],
  }, now);
  const later = createEvent(store, "org-1", {
    title: "Charlie",
    venue: "Theater",
    startsAt: "2026-01-06T10:00:00.000Z",
    tiers: [{ name: "T1", priceCents: 1000, quantity: 6 }],
  }, now);
  store.events[2].status = "cancelled";
  store.orders.push({
    id: "o-1",
    eventId: early.id,
    customerId: "c-1",
    status: "held",
    items: [{ tierId: early.tiers[0].id, quantity: 2, unitPriceCents: 1000 }],
    subtotalCents: 2000,
    discountCode: null,
    discountCents: 0,
    totalCents: 2000,
    createdAt: now.toISOString(),
    expiresAt: "2026-01-01T00:15:00.000Z",
    paidAt: null,
  });
  store.orders.push({
    id: "o-2",
    eventId: sameTimeA.id,
    customerId: "c-2",
    status: "paid",
    items: [{ tierId: sameTimeA.tiers[0].id, quantity: 1, unitPriceCents: 1000 }],
    subtotalCents: 1000,
    discountCode: null,
    discountCents: 0,
    totalCents: 1000,
    createdAt: now.toISOString(),
    expiresAt: "2026-01-01T00:15:00.000Z",
    paidAt: now.toISOString(),
  });

  const page1 = listPublicEvents(store, { q: "a", page: "1", pageSize: "1" });
  assert.equal(page1.total, 3);
  assert.equal(page1.items.length, 1);
  assert.equal(page1.items[0].title, "Alpha");
  assert.equal(page1.items[0].tiers[0].available, 3);

  const page2 = listPublicEvents(store, { q: "a", page: "2", pageSize: "1" });
  assert.equal(page2.items[0].title, "Bravo");

  assert.throws(() => listPublicEvents(store, { page: "0" }), Error);
  assert.throws(() => listPublicEvents(store, { pageSize: "51" }), Error);
  assert.throws(() => listPublicEvents(store, { from: "bad" }), Error);
});

test("getEventById returns cancelled events and throws when missing", () => {
  const store = createStore();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const event = createEvent(store, "org-1", {
    title: "Show",
    venue: "Hall",
    startsAt: "2026-01-02T00:00:00.000Z",
    tiers: [{ name: "A", priceCents: 1000, quantity: 2 }],
  }, now);
  store.events[0].status = "cancelled";

  const loaded = getEventById(store, event.id);
  assert.equal(loaded.status, "cancelled");
  assert.equal(loaded.tiers[0].available, 2);
  assert.throws(() => getEventById(store, "missing"), Error);
});

test("createDiscount and createOrder enforce validation, conflict, and discount rules", () => {
  const store = createStore();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const event = createEvent(store, "org-1", {
    title: "Sale Event",
    venue: "Venue",
    startsAt: "2026-01-02T12:00:00.000Z",
    tiers: [
      { name: "A", priceCents: 1000, quantity: 6 },
      { name: "B", priceCents: 2000, quantity: 6 },
    ],
  }, now);

  const discount = createDiscount(store, "org-1", event.id, { code: "save10", percentOff: 10 }, now);
  assert.deepEqual(discount, {
    code: "SAVE10",
    percentOff: 10,
    amountOffCents: null,
    maxUses: null,
    expiresAt: null,
    uses: 0,
  });
  assert.throws(() => createDiscount(store, "org-1", event.id, { code: "SAVE10", amountOffCents: 100 }, now), Error);
  assert.throws(() => createDiscount(store, "org-2", event.id, { code: "X1", percentOff: 10 }, now), Error);
  assert.throws(() => createDiscount(store, "org-1", event.id, { code: "bad code", percentOff: 10 }, now), Error);

  const order = createOrder(store, "cust-1", {
    eventId: event.id,
    items: [
      { tierId: event.tiers[0].id, quantity: 2 },
      { tierId: event.tiers[1].id, quantity: 1 },
    ],
    discountCode: "save10",
  }, now, 900);
  assert.equal(order.status, "held");
  assert.equal(order.discountCode, "SAVE10");
  assert.equal(order.subtotalCents, 4000);
  assert.equal(order.discountCents, 400);
  assert.equal(order.totalCents, 3600);
  assert.equal(order.items.length, 2);

  assert.throws(() => createOrder(store, "cust-1", { eventId: event.id, items: [] }, now, 900), Error);
  assert.throws(() => createOrder(store, "cust-1", { eventId: event.id, items: [{ tierId: "missing", quantity: 1 }] }, now, 900), Error);
});

test("createOrder enforces availability, time, customer limit, and discount usage", () => {
  const store = createStore();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const event = createEvent(store, "org-1", {
    title: "Sellout",
    venue: "Venue",
    startsAt: "2026-01-02T00:00:00.000Z",
    tiers: [{ name: "A", priceCents: 1000, quantity: 6 }],
  }, now);
  createOrder(store, "cust-1", { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 4 }] }, now, 900);
  assert.throws(() => createOrder(store, "cust-2", { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 3 }] }, now, 900), Error);

  const pastEvent = createEvent(store, "org-1", {
    title: "Past",
    venue: "Venue",
    startsAt: "2026-01-01T00:00:01.000Z",
    tiers: [{ name: "A", priceCents: 1000, quantity: 1 }],
  }, new Date("2026-01-01T00:00:00.000Z"));
  assert.throws(() => createOrder(store, "cust-1", { eventId: pastEvent.id, items: [{ tierId: pastEvent.tiers[0].id, quantity: 1 }] }, new Date("2026-01-01T00:00:02.000Z"), 900), Error);

  const limitEvent = createEvent(store, "org-1", {
    title: "Limit",
    venue: "Venue",
    startsAt: "2026-01-03T00:00:00.000Z",
    tiers: [{ name: "A", priceCents: 1000, quantity: 10 }],
  }, now);
  store.orders.push({
    id: "held-1",
    eventId: limitEvent.id,
    customerId: "cust-3",
    status: "held",
    items: [{ tierId: limitEvent.tiers[0].id, quantity: 6, unitPriceCents: 1000 }],
    subtotalCents: 6000,
    discountCode: null,
    discountCents: 0,
    totalCents: 6000,
    createdAt: now.toISOString(),
    expiresAt: "2026-01-01T00:15:00.000Z",
    paidAt: null,
  });
  assert.throws(() => createOrder(store, "cust-3", { eventId: limitEvent.id, items: [{ tierId: limitEvent.tiers[0].id, quantity: 1 }] }, now, 900), Error);

  const discEvent = createEvent(store, "org-1", {
    title: "Discounted",
    venue: "Venue",
    startsAt: "2026-01-04T00:00:00.000Z",
    tiers: [{ name: "A", priceCents: 1000, quantity: 4 }],
  }, now);
  createDiscount(store, "org-1", discEvent.id, { code: "LIMIT1", maxUses: 1, amountOffCents: 50 }, now);
  const paid = createOrder(store, "cust-4", { eventId: discEvent.id, items: [{ tierId: discEvent.tiers[0].id, quantity: 1 }], discountCode: "limit1" }, now, 900);
  payOrder(store, "cust-4", paid.id, now);
  assert.throws(() => createOrder(store, "cust-5", { eventId: discEvent.id, items: [{ tierId: discEvent.tiers[0].id, quantity: 1 }], discountCode: "LIMIT1" }, now, 900), Error);
});

test("payOrder, cancelOrder, getVisibleOrder, and listCustomerOrders follow ownership and status rules", () => {
  const store = createStore();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const event = createEvent(store, "org-1", {
    title: "Owned",
    venue: "Venue",
    startsAt: "2026-01-03T00:00:00.000Z",
    tiers: [{ name: "A", priceCents: 1000, quantity: 6 }],
  }, now);
  const held = createOrder(store, "cust-1", { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 2 }] }, now, 900);
  const paid = createOrder(store, "cust-1", { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] }, now, 900);
  payOrder(store, "cust-1", paid.id, now);

  const visible = getVisibleOrder(store, "org-1", paid.id);
  assert.equal(visible.id, paid.id);
  assert.equal(getVisibleOrder(store, "cust-1", held.id).id, held.id);
  assert.throws(() => getVisibleOrder(store, "other", paid.id), Error);

  const ordered = listCustomerOrders(store, "cust-1");
  assert.equal(ordered[0].id, held.id);
  assert.equal(ordered[1].id, paid.id);

  assert.equal(payOrder(store, "cust-1", held.id, now).status, "paid");
  assert.throws(() => payOrder(store, "cust-1", held.id, now), Error);
  assert.throws(() => payOrder(store, "other", paid.id, now), Error);

  const cancelable = createOrder(store, "cust-2", { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] }, now, 900);
  assert.equal(cancelOrder(store, "cust-2", cancelable.id, now, 900).status, "cancelled");
  assert.equal(cancelOrder(store, "cust-1", paid.id, new Date("2026-01-01T12:00:00.000Z"), 900).status, "refunded");
  assert.throws(() => cancelOrder(store, "cust-1", paid.id, new Date("2026-01-02T23:30:00.000Z"), 900), Error);
});

test("waitlist joins, visibility, serving, and refreshExpirations work in queue order", () => {
  const store = createStore();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const event = createEvent(store, "org-1", {
    title: "Queue",
    venue: "Venue",
    startsAt: "2026-01-02T00:00:00.000Z",
    tiers: [{ name: "A", priceCents: 1000, quantity: 1 }],
  }, now);
  const held = createOrder(store, "c1", { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] }, now, 1);
  const second = createEvent(store, "org-1", {
    title: "Queue 2",
    venue: "Venue",
    startsAt: "2026-01-02T00:00:00.000Z",
    tiers: [{ name: "A", priceCents: 1000, quantity: 2 }],
  }, now);
  const w1 = joinWaitlist(store, "c2", second.id, { tierId: second.tiers[0].id, quantity: 1 });
  const w2 = joinWaitlist(store, "c3", second.id, { tierId: second.tiers[0].id, quantity: 1 });
  assert.equal(w1.position, 1);
  assert.equal(w2.position, 2);
  assert.deepEqual(listCustomerWaitlist(store, "c2"), [w1]);

  held.expiresAt = now.toISOString();
  refreshExpirations(store, now, 900);
  assert.equal(store.orders.some((order) => order.customerId === "c2" && order.status === "held"), true);
  assert.equal(store.waitlistEntries.length, 0);

  const limitEvent = createEvent(store, "org-1", {
    title: "Limit Queue",
    venue: "Venue",
    startsAt: "2026-01-02T00:00:00.000Z",
    tiers: [{ name: "A", priceCents: 1000, quantity: 2 }],
  }, now);
  createOrder(store, "c4", { eventId: limitEvent.id, items: [{ tierId: limitEvent.tiers[0].id, quantity: 6 }] }, now, 900);
  const wait = joinWaitlist(store, "c4", limitEvent.id, { tierId: limitEvent.tiers[0].id, quantity: 1 });
  assert.equal(wait.position, 1);
  const paid = store.orders.find((order) => order.customerId === "c4" && order.eventId === limitEvent.id)!;
  paid.status = "expired";
  refreshExpirations(store, now, 900);
  assert.equal(store.waitlistEntries.length > 0, false);
});

test("cancelEvent changes order and waitlist state and enforces ownership", () => {
  const store = createStore();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const event = createEvent(store, "org-1", {
    title: "Cancel Me",
    venue: "Venue",
    startsAt: "2026-01-04T00:00:00.000Z",
    tiers: [{ name: "A", priceCents: 1000, quantity: 3 }],
  }, now);
  const paid = createOrder(store, "cust-1", { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] }, now, 900);
  payOrder(store, "cust-1", paid.id, now);
  const held = createOrder(store, "cust-2", { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] }, now, 900);
  const wait = joinWaitlist(store, "cust-3", event.id, { tierId: event.tiers[0].id, quantity: 1 });

  const cancelled = cancelEvent(store, "org-1", event.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(store.orders.find((order) => order.id === paid.id)?.status, "refunded");
  assert.equal(store.orders.find((order) => order.id === held.id)?.status, "cancelled");
  assert.equal(store.waitlistEntries.length, 0);
  assert.throws(() => cancelEvent(store, "other", event.id), Error);
  assert.throws(() => cancelEvent(store, "org-1", event.id), Error);
});

test("getEventReport summarizes paid, held, refunded, and available tickets", () => {
  const store = createStore();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const event = createEvent(store, "org-1", {
    title: "Report",
    venue: "Venue",
    startsAt: "2026-01-05T00:00:00.000Z",
    tiers: [
      { name: "A", priceCents: 1000, quantity: 5 },
      { name: "B", priceCents: 2000, quantity: 4 },
    ],
  }, now);
  const order1 = createOrder(store, "cust-1", { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 2 }] }, now, 900);
  const order2 = createOrder(store, "cust-2", { eventId: event.id, items: [{ tierId: event.tiers[1].id, quantity: 1 }] }, now, 900);
  payOrder(store, "cust-2", order2.id, now);
  const order3 = createOrder(store, "cust-3", { eventId: event.id, items: [{ tierId: event.tiers[1].id, quantity: 1 }] }, now, 900);
  payOrder(store, "cust-3", order3.id, now);
  cancelOrder(store, "cust-3", order3.id, new Date("2026-01-01T10:00:00.000Z"), 900);

  const report = getEventReport(store, "org-1", event.id);
  assert.deepEqual(report.tiers, [
    { tierId: event.tiers[0].id, name: "A", sold: 0, held: 2, available: 3 },
    { tierId: event.tiers[1].id, name: "B", sold: 1, held: 0, available: 3 },
  ]);
  assert.equal(report.grossCents, 2000);
  assert.equal(report.discountCents, 0);
  assert.equal(report.refundedCents, 2000);
  assert.equal(report.netCents, 2000);
  assert.throws(() => getEventReport(store, "other", event.id), Error);
});
