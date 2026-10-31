import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";
import { HttpError } from "../src/http.js";
import { registerUser } from "../src/auth.js";
import {
  listEvents,
  getEvent,
  createEvent,
  cancelEvent,
  createOrder,
  payOrder,
  cancelOrder,
  getOrder,
  listMyOrders,
  createDiscount,
  joinWaitlist,
  listMyWaitlist,
  getEventReport,
} from "../src/service.js";

function makeContext(nowIso = "2025-01-01T12:00:00.000Z", holdSeconds = 900) {
  return { store: createStore(), now: new Date(nowIso), holdSeconds };
}

function makeOrganizer(store, email = "organizer@example.com") {
  return registerUser(store, {
    email,
    password: "password123",
    name: "Organizer",
    role: "organizer",
  });
}

function makeCustomer(store, email = "customer@example.com") {
  return registerUser(store, {
    email,
    password: "password123",
    name: "Customer",
    role: "customer",
  });
}

function createBasicEvent(context, actor, overrides = {}) {
  return createEvent(context, actor, {
    title: "Concert",
    venue: "Hall",
    startsAt: "2025-01-02T12:00:00.000Z",
    tiers: [{ name: "GA", priceCents: 1000, quantity: 5 }],
    ...overrides,
  });
}

function expectHttpError(fn, statusCode, message) {
  assert.throws(fn, (error) => error instanceof HttpError && error.statusCode === statusCode && error.message === message);
}

test("exported view shapes can be represented", () => {
  const eventView = {
    id: "id_1",
    title: "Show",
    venue: "Hall",
    startsAt: "2025-01-02T12:00:00.000Z",
    status: "on_sale",
    organizerId: "id_organizer",
    tiers: [{ id: "id_2", name: "GA", priceCents: 1000, quantity: 10, available: 10 }],
  };
  const paginated = { items: [eventView], page: 1, pageSize: 10, total: 1 };
  const orderView = {
    id: "id_3",
    eventId: "id_1",
    customerId: "id_4",
    status: "held",
    items: [{ tierId: "id_2", quantity: 1, unitPriceCents: 1000 }],
    subtotalCents: 1000,
    discountCode: null,
    discountCents: 0,
    totalCents: 1000,
    createdAt: "2025-01-01T12:00:00.000Z",
    expiresAt: "2025-01-01T12:15:00.000Z",
    paidAt: null,
  };
  const discountView = { code: "SAVE10", percentOff: 10, amountOffCents: null, maxUses: null, expiresAt: null, uses: 0 };
  const waitlistView = { id: "id_5", eventId: "id_1", tierId: "id_2", quantity: 1, position: 1 };
  const report = {
    eventId: "id_1",
    tiers: [{ tierId: "id_2", name: "GA", sold: 1, held: 0, available: 9 }],
    grossCents: 1000,
    discountCents: 100,
    refundedCents: 0,
    netCents: 900,
  };

  assert.equal(eventView.tiers[0].available, 10);
  assert.equal(paginated.total, 1);
  assert.equal(orderView.totalCents, 1000);
  assert.equal(discountView.code, "SAVE10");
  assert.equal(waitlistView.position, 1);
  assert.equal(report.netCents, 900);
});

test("listEvents filters only on_sale events, sorts, paginates, and validates query", () => {
  const context = makeContext();
  const organizer = makeOrganizer(context.store);
  const otherOrganizer = makeOrganizer(context.store, "other@example.com");
  createBasicEvent(context, organizer, { title: "Beta", venue: "Venue B", startsAt: "2025-01-03T12:00:00.000Z" });
  createBasicEvent(context, organizer, { title: "Alpha", venue: "Venue A", startsAt: "2025-01-03T12:00:00.000Z" });
  const cancelled = createBasicEvent(context, otherOrganizer, { title: "Cancelled", venue: "Venue C", startsAt: "2025-01-04T12:00:00.000Z" });
  cancelEvent(context, otherOrganizer, cancelled.id);

  const result = listEvents(context, new URLSearchParams({ q: "venue", page: "1", pageSize: "10" }));
  assert.equal(result.total, 2);
  assert.deepEqual(result.items.map((event) => event.title), ["Alpha", "Beta"]);
  assert.equal(result.items[0].tiers[0].available, 5);

  expectHttpError(() => listEvents(context, new URLSearchParams({ page: "0" })), 400, "Invalid query");
  expectHttpError(() => listEvents(context, new URLSearchParams({ pageSize: "51" })), 400, "Invalid query");
  expectHttpError(() => listEvents(context, new URLSearchParams({ from: "not-a-date" })), 400, "Invalid query");
});

test("getEvent returns cancelled events and 404 for missing events", () => {
  const context = makeContext();
  const organizer = makeOrganizer(context.store);
  const event = createBasicEvent(context, organizer);
  cancelEvent(context, organizer, event.id);

  const view = getEvent(context, event.id);
  assert.equal(view.status, "cancelled");
  expectHttpError(() => getEvent(context, "missing"), 404, "Event not found");
});

test("createEvent validates organizer role, input, and future startsAt", () => {
  const context = makeContext();
  const organizer = makeOrganizer(context.store);
  const customer = makeCustomer(context.store);

  expectHttpError(
    () => createEvent(context, customer, {
      title: "Concert",
      venue: "Hall",
      startsAt: "2025-01-02T12:00:00.000Z",
      tiers: [{ name: "GA", priceCents: 0, quantity: 1 }],
    }),
    403,
    "Forbidden",
  );
  expectHttpError(() => createEvent(context, organizer, null), 400, "Invalid event");
  expectHttpError(() => createEvent(context, organizer, { title: "", venue: "Hall", startsAt: "2025-01-02T12:00:00.000Z", tiers: [{ name: "GA", priceCents: 0, quantity: 1 }] }), 400, "Invalid event");
  expectHttpError(() => createEvent(context, organizer, { title: "Concert", venue: "Hall", startsAt: "2024-12-31T12:00:00.000Z", tiers: [{ name: "GA", priceCents: 0, quantity: 1 }] }), 400, "Invalid event");
  expectHttpError(() => createEvent(context, organizer, { title: "Concert", venue: "Hall", startsAt: "2025-01-02T12:00:00.000Z", tiers: [] }), 400, "Invalid event");
  expectHttpError(() => createEvent(context, organizer, { title: "Concert", venue: "Hall", startsAt: "2025-01-02T12:00:00.000Z", tiers: [{ name: "GA", priceCents: -1, quantity: 1 }] }), 400, "Invalid event");
  expectHttpError(() => createEvent(context, organizer, { title: "Concert", venue: "Hall", startsAt: "2025-01-02T12:00:00.000Z", tiers: [{ name: "GA", priceCents: 0, quantity: 0 }] }), 400, "Invalid event");
  expectHttpError(() => createEvent(context, organizer, { title: "Concert", venue: "Hall", startsAt: "2025-01-02T12:00:00.000Z", tiers: [{ name: "GA", priceCents: 0, quantity: 1 }, { name: "GA", priceCents: 1, quantity: 1 }] }), 400, "Invalid event");

  const view = createEvent(context, organizer, {
    title: "Concert",
    venue: "Hall",
    startsAt: "2025-01-02T12:00:00.000Z",
    tiers: [{ name: "GA", priceCents: 1000, quantity: 5 }],
  });
  assert.equal(view.status, "on_sale");
  assert.equal(view.tiers[0].available, 5);
});

test("cancelEvent enforces organizer ownership and cascades order and waitlist status", () => {
  const context = makeContext();
  const organizer = makeOrganizer(context.store);
  const otherOrganizer = makeOrganizer(context.store, "other@example.com");
  const customer = makeCustomer(context.store);
  const event = createBasicEvent(context, organizer);

  expectHttpError(() => cancelEvent(context, customer, event.id), 403, "Forbidden");
  expectHttpError(() => cancelEvent(context, otherOrganizer, event.id), 403, "Forbidden");
  expectHttpError(() => cancelEvent(context, organizer, "missing"), 404, "Event not found");

  const paidOrder = createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] });
  payOrder(context, customer, paidOrder.id);
  const heldOrder = createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] });
  const waitlisted = joinWaitlist(context, customer, event.id, { tierId: event.tiers[0].id, quantity: 1 });

  const cancelled = cancelEvent(context, organizer, event.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(context.store.orders.find((order) => order.id === paidOrder.id).status, "refunded");
  assert.equal(context.store.orders.find((order) => order.id === heldOrder.id).status, "cancelled");
  assert.equal(context.store.waitlist.length, 0);
  assert.equal(waitlisted.position, 1);

  expectHttpError(() => cancelEvent(context, organizer, event.id), 409, "Event already cancelled");
});

test("createOrder validates input, inventory, event state, ticket limit, and discounts", () => {
  const context = makeContext();
  const organizer = makeOrganizer(context.store);
  const customer = makeCustomer(context.store);
  const event = createBasicEvent(context, organizer, { tiers: [{ name: "GA", priceCents: 1000, quantity: 6 }, { name: "VIP", priceCents: 2500, quantity: 2 }] });
  const discount = createDiscount(context, organizer, event.id, { code: "save10", percentOff: 10 });

  expectHttpError(() => createOrder(context, organizer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] }), 403, "Forbidden");
  expectHttpError(() => createOrder(context, customer, null), 400, "Invalid order");
  expectHttpError(() => createOrder(context, customer, { eventId: event.id }), 400, "Invalid order");
  expectHttpError(() => createOrder(context, customer, { eventId: event.id, items: [] }), 400, "Invalid order");
  expectHttpError(() => createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 0 }] }), 400, "Invalid order");
  expectHttpError(() => createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }, { tierId: event.tiers[0].id, quantity: 1 }] }), 400, "Invalid order");
  expectHttpError(() => createOrder(context, customer, { eventId: "missing", items: [{ tierId: "x", quantity: 1 }] }), 404, "Event not found");
  expectHttpError(() => createOrder(context, customer, { eventId: event.id, items: [{ tierId: "missing", quantity: 1 }] }), 400, "Invalid order");

  const endedContext = makeContext("2025-01-03T12:00:00.000Z");
  const endedOrganizer = makeOrganizer(endedContext.store, "ended@example.com");
  const endedEvent = createEvent(endedContext, endedOrganizer, {
    title: "Past",
    venue: "Hall",
    startsAt: "2025-01-02T12:00:00.000Z",
    tiers: [{ name: "GA", priceCents: 1000, quantity: 5 }],
  });
  const endedCustomer = makeCustomer(endedContext.store, "ended-customer@example.com");
  expectHttpError(() => createOrder(endedContext, endedCustomer, { eventId: endedEvent.id, items: [{ tierId: endedEvent.tiers[0].id, quantity: 1 }] }), 409, "Event is not on sale");

  const soldOutContext = makeContext();
  const soldOrganizer = makeOrganizer(soldOutContext.store, "sold@example.com");
  const soldCustomer = makeCustomer(soldOutContext.store, "sold-customer@example.com");
  const soldEvent = createBasicEvent(soldOutContext, soldOrganizer, { tiers: [{ name: "GA", priceCents: 1000, quantity: 1 }] });
  createOrder(soldOutContext, soldCustomer, { eventId: soldEvent.id, items: [{ tierId: soldEvent.tiers[0].id, quantity: 1 }] });
  expectHttpError(() => createOrder(soldOutContext, soldCustomer, { eventId: soldEvent.id, items: [{ tierId: soldEvent.tiers[0].id, quantity: 1 }] }), 409, "Not enough tickets");

  const limitContext = makeContext();
  const limitOrganizer = makeOrganizer(limitContext.store, "limit@example.com");
  const limitCustomer = makeCustomer(limitContext.store, "limit-customer@example.com");
  const limitEvent = createBasicEvent(limitContext, limitOrganizer, { tiers: [{ name: "GA", priceCents: 1000, quantity: 10 }, { name: "VIP", priceCents: 2000, quantity: 10 }] });
  createOrder(limitContext, limitCustomer, { eventId: limitEvent.id, items: [{ tierId: limitEvent.tiers[0].id, quantity: 4 }] });
  expectHttpError(() => createOrder(limitContext, limitCustomer, { eventId: limitEvent.id, items: [{ tierId: limitEvent.tiers[1].id, quantity: 3 }] }), 422, "Ticket limit exceeded");

  expectHttpError(() => createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }], discountCode: 1 }), 400, "Invalid order");
  expectHttpError(() => createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }], discountCode: "missing" }), 422, "Discount code cannot be used");
  expectHttpError(() => createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }], discountCode: "save10" }), 400, "Invalid order");
  assert.equal(discount.uses, 0);

  const order = createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 2 }], discountCode: "save10" });
  assert.equal(order.discountCode, "SAVE10");
  assert.equal(order.subtotalCents, 2000);
  assert.equal(order.discountCents, 200);
  assert.equal(order.totalCents, 1800);
  assert.equal(order.paidAt, null);
});

test("createDiscount validates organizer ownership and discount rules", () => {
  const context = makeContext();
  const organizer = makeOrganizer(context.store);
  const otherOrganizer = makeOrganizer(context.store, "other@example.com");
  const customer = makeCustomer(context.store);
  const event = createBasicEvent(context, organizer);

  expectHttpError(() => createDiscount(context, customer, event.id, { code: "SAVE10", percentOff: 10 }), 403, "Forbidden");
  expectHttpError(() => createDiscount(context, organizer, "missing", { code: "SAVE10", percentOff: 10 }), 404, "Event not found");
  expectHttpError(() => createDiscount(context, otherOrganizer, event.id, { code: "SAVE10", percentOff: 10 }), 403, "Forbidden");
  expectHttpError(() => createDiscount(context, organizer, event.id, null), 400, "Invalid discount");
  expectHttpError(() => createDiscount(context, organizer, event.id, { code: "ab", percentOff: 10 }), 400, "Invalid discount");
  expectHttpError(() => createDiscount(context, organizer, event.id, { code: "SAVE10", percentOff: 0 }), 400, "Invalid discount");
  expectHttpError(() => createDiscount(context, organizer, event.id, { code: "SAVE10", amountOffCents: 10, percentOff: 10 }), 400, "Invalid discount");
  expectHttpError(() => createDiscount(context, organizer, event.id, { code: "SAVE10", amountOffCents: 10 }), 400, "Invalid discount");
  expectHttpError(() => createDiscount(context, organizer, event.id, { code: "SAVE10", percentOff: 10, maxUses: 0 }), 400, "Invalid discount");
  expectHttpError(() => createDiscount(context, organizer, event.id, { code: "SAVE10", percentOff: 10, expiresAt: "bad-date" }), 400, "Invalid discount");

  const discount = createDiscount(context, organizer, event.id, { code: "save10", percentOff: 10, maxUses: 2, expiresAt: "2025-01-02T12:00:00.000Z" });
  assert.deepEqual(discount, {
    code: "SAVE10",
    percentOff: 10,
    amountOffCents: null,
    maxUses: 2,
    expiresAt: "2025-01-02T12:00:00.000Z",
    uses: 0,
  });
  expectHttpError(() => createDiscount(context, organizer, event.id, { code: "SAVE10", percentOff: 20 }), 409, "Discount code already exists");
});

test("payOrder and cancelOrder transition held, paid, expired, and refunded orders", () => {
  const context = makeContext();
  const organizer = makeOrganizer(context.store);
  const customer = makeCustomer(context.store);
  const event = createBasicEvent(context, organizer, { startsAt: "2025-01-05T12:00:00.000Z" });
  const heldOrder = createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] });

  expectHttpError(() => payOrder(context, organizer, heldOrder.id), 403, "Forbidden");
  expectHttpError(() => payOrder(context, customer, "missing"), 404, "Order not found");
  const paid = payOrder(context, customer, heldOrder.id);
  assert.equal(paid.status, "paid");
  assert.equal(paid.paidAt, context.now.toISOString());
  assert.equal(paid.expiresAt, heldOrder.expiresAt);
  expectHttpError(() => payOrder(context, customer, heldOrder.id), 409, "Order cannot be paid");

  const cancelEventSoon = createBasicEvent(context, organizer, { startsAt: "2025-01-02T00:00:00.000Z", title: "Soon" });
  const soonOrder = createOrder(context, customer, { eventId: cancelEventSoon.id, items: [{ tierId: cancelEventSoon.tiers[0].id, quantity: 1 }] });
  expectHttpError(() => cancelOrder(context, customer, "missing"), 404, "Order not found");
  expectHttpError(() => cancelOrder(context, organizer, soonOrder.id), 403, "Forbidden");
  expectHttpError(() => cancelOrder(context, customer, soonOrder.id), 409, "Order cannot be cancelled");

  const futureEvent = createBasicEvent(context, organizer, { startsAt: "2025-01-05T12:00:00.000Z", title: "Future" });
  const futureOrder = createOrder(context, customer, { eventId: futureEvent.id, items: [{ tierId: futureEvent.tiers[0].id, quantity: 1 }] });
  const cancelledHeld = cancelOrder(context, customer, futureOrder.id);
  assert.equal(cancelledHeld.status, "cancelled");

  const payLaterOrder = createOrder(context, customer, { eventId: futureEvent.id, items: [{ tierId: futureEvent.tiers[0].id, quantity: 1 }] });
  payOrder(context, customer, payLaterOrder.id);
  context.now = new Date("2025-01-04T12:00:00.000Z");
  const refunded = cancelOrder(context, customer, payLaterOrder.id);
  assert.equal(refunded.status, "refunded");
});

test("getOrder enforces customer and organizer visibility rules", () => {
  const context = makeContext();
  const organizer = makeOrganizer(context.store);
  const otherOrganizer = makeOrganizer(context.store, "other@example.com");
  const customer = makeCustomer(context.store);
  const otherCustomer = makeCustomer(context.store, "other-customer@example.com");
  const event = createBasicEvent(context, organizer);
  const order = createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] });

  assert.equal(getOrder(context, customer, order.id).id, order.id);
  expectHttpError(() => getOrder(context, otherCustomer, order.id), 404, "Order not found");
  expectHttpError(() => getOrder(context, otherOrganizer, order.id), 404, "Order not found");
  expectHttpError(() => getOrder(context, organizer, "missing"), 404, "Order not found");
});

test("listMyOrders returns customer orders sorted newest-first and rejects other roles", () => {
  const context = makeContext();
  const organizer = makeOrganizer(context.store);
  const customer = makeCustomer(context.store);
  const event = createBasicEvent(context, organizer);
  const first = createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] });
  context.now = new Date("2025-01-01T12:10:00.000Z");
  const second = createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] });
  payOrder(context, customer, second.id);
  context.now = new Date("2025-01-01T12:20:00.000Z");

  const orders = listMyOrders(context, customer);
  assert.deepEqual(orders.map((order) => order.id), [second.id, first.id]);
  expectHttpError(() => listMyOrders(context, organizer), 403, "Forbidden");
});

test("joinWaitlist and listMyWaitlist manage queue positions and validation", () => {
  const context = makeContext();
  const organizer = makeOrganizer(context.store);
  const customer = makeCustomer(context.store);
  const otherCustomer = makeCustomer(context.store, "other@example.com");
  const event = createBasicEvent(context, organizer, { tiers: [{ name: "GA", priceCents: 1000, quantity: 1 }] });

  expectHttpError(() => joinWaitlist(context, organizer, event.id, { tierId: event.tiers[0].id, quantity: 1 }), 403, "Forbidden");
  expectHttpError(() => joinWaitlist(context, customer, "missing", { tierId: event.tiers[0].id, quantity: 1 }), 404, "Event not found");
  expectHttpError(() => joinWaitlist(context, customer, event.id, null), 400, "Invalid waitlist entry");
  expectHttpError(() => joinWaitlist(context, customer, event.id, { tierId: event.tiers[0].id, quantity: 0 }), 400, "Invalid waitlist entry");
  expectHttpError(() => joinWaitlist(context, customer, event.id, { tierId: "missing", quantity: 1 }), 400, "Invalid waitlist entry");
  expectHttpError(() => joinWaitlist(context, customer, event.id, { tierId: event.tiers[0].id, quantity: 1 }), 409, "Tickets are available");

  createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] });
  const waitlisted1 = joinWaitlist(context, customer, event.id, { tierId: event.tiers[0].id, quantity: 1 });
  assert.equal(waitlisted1.position, 1);
  const waitlisted2 = joinWaitlist(context, otherCustomer, event.id, { tierId: event.tiers[0].id, quantity: 1 });
  assert.equal(waitlisted2.position, 2);
  expectHttpError(() => joinWaitlist(context, customer, event.id, { tierId: event.tiers[0].id, quantity: 1 }), 409, "Already waitlisted");

  const entries = listMyWaitlist(context, customer);
  assert.deepEqual(entries.map((entry) => entry.position), [1]);
  expectHttpError(() => listMyWaitlist(context, organizer), 403, "Forbidden");
});

test("lazy expiration expires held orders and serves waitlist FIFO", () => {
  const context = makeContext("2025-01-01T12:00:00.000Z", 60);
  const organizer = makeOrganizer(context.store);
  const customer = makeCustomer(context.store);
  const nextCustomer = makeCustomer(context.store, "next@example.com");
  const event = createBasicEvent(context, organizer, { tiers: [{ name: "GA", priceCents: 1000, quantity: 1 }] });

  const held = createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] });
  const waitlisted = joinWaitlist(context, nextCustomer, event.id, { tierId: event.tiers[0].id, quantity: 1 });
  assert.equal(waitlisted.position, 1);

  context.now = new Date("2025-01-01T12:01:01.000Z");
  const view = getEvent(context, event.id);
  assert.equal(context.store.orders.find((order) => order.id === held.id).status, "expired");
  assert.equal(context.store.orders.some((order) => order.customerId === nextCustomer.id && order.status === "held"), true);
  assert.equal(context.store.waitlist.length, 0);
  assert.equal(view.tiers[0].available, 0);
});

test("waitlist serving skips entries that would exceed the six ticket customer limit", () => {
  const context = makeContext("2025-01-01T12:00:00.000Z", 60);
  const organizer = makeOrganizer(context.store);
  const customer = makeCustomer(context.store);
  const waitlistedCustomer = makeCustomer(context.store, "wait@example.com");
  const event = createBasicEvent(context, organizer, { tiers: [{ name: "GA", priceCents: 1000, quantity: 10 }] });

  createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 6 }] });
  joinWaitlist(context, waitlistedCustomer, event.id, { tierId: event.tiers[0].id, quantity: 1 });

  context.store.orders.push({
    id: "manual_held",
    eventId: event.id,
    customerId: customer.id,
    status: "held",
    items: [{ tierId: event.tiers[0].id, quantity: 0, unitPriceCents: 1000 }],
    subtotalCents: 0,
    discountCode: null,
    discountCents: 0,
    totalCents: 0,
    createdAt: "2025-01-01T12:00:00.000Z",
    expiresAt: "2025-01-01T12:00:00.000Z",
    paidAt: null,
  });

  context.now = new Date("2025-01-01T12:01:01.000Z");
  getEvent(context, event.id);
  assert.equal(context.store.waitlist.length, 0);
  assert.equal(context.store.orders.filter((order) => order.customerId === waitlistedCustomer.id && order.status === "held").length, 0);
});

test("getEventReport summarizes paid, held, refunded, and available counts", () => {
  const context = makeContext();
  const organizer = makeOrganizer(context.store);
  const otherOrganizer = makeOrganizer(context.store, "other@example.com");
  const customer = makeCustomer(context.store);
  const event = createBasicEvent(context, organizer, { tiers: [{ name: "GA", priceCents: 1000, quantity: 3 }] });
  const held = createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] });
  const paid = createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] });
  payOrder(context, customer, paid.id);
  const refundedPaid = createOrder(context, customer, { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] });
  payOrder(context, customer, refundedPaid.id);
  context.now = new Date("2025-01-04T12:00:00.000Z");
  cancelOrder(context, customer, refundedPaid.id);

  const report = getEventReport(context, organizer, event.id);
  assert.equal(report.eventId, event.id);
  assert.equal(report.tiers[0].sold, 1);
  assert.equal(report.tiers[0].held, 1);
  assert.equal(report.tiers[0].available, 1);
  assert.equal(report.grossCents, 1000);
  assert.equal(report.discountCents, 0);
  assert.equal(report.refundedCents, 1000);
  assert.equal(report.netCents, 1000);

  expectHttpError(() => getEventReport(context, otherOrganizer, event.id), 403, "Forbidden");
  expectHttpError(() => getEventReport(context, organizer, "missing"), 404, "Event not found");
});
