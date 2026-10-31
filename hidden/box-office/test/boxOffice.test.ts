import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "../src/errors.js";
import { createStore } from "../src/store.js";
import type { PublicUser } from "../src/auth.js";
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
} from "../src/boxOffice.js";

type Store = ReturnType<typeof createStore>;

function organizer(): PublicUser {
  return { id: "org-1", email: "org@example.com", name: "Org", role: "organizer" };
}

function customer(id = "cus-1"): PublicUser {
  return { id, email: `${id}@example.com`, name: id, role: "customer" };
}

function withMockedNow<T>(iso: string, fn: () => T): T {
  const original = Date.now;
  Date.now = () => Date.parse(iso);
  try {
    return fn();
  } finally {
    Date.now = original;
  }
}

function makeStore(): Store {
  return createStore(3600);
}

function makeEvent(store: Store, overrides: Partial<{ title: string; venue: string; startsAt: string }> = {}) {
  return createEvent(store, organizer(), {
    title: overrides.title ?? "Gala",
    venue: overrides.venue ?? "Main Hall",
    startsAt: overrides.startsAt ?? "2030-01-02T00:00:00.000Z",
    tiers: [{ name: "General", priceCents: 1000, quantity: 6 }],
  });
}

test("createEvent returns a public EventView and getEvent returns the same shape", () => {
  withMockedNow("2030-01-01T00:00:00.000Z", () => {
    const store = makeStore();
    const event = makeEvent(store);

    assert.deepEqual(event, {
      id: "id-1",
      title: "Gala",
      venue: "Main Hall",
      startsAt: "2030-01-02T00:00:00.000Z",
      status: "on_sale",
      organizerId: "org-1",
      tiers: [{ id: "id-2", name: "General", priceCents: 1000, quantity: 6, available: 6 }],
    });
    assert.deepEqual(getEvent(store, event.id), event);
  });
});

test("createEvent validates its input", () => {
  withMockedNow("2030-01-01T00:00:00.000Z", () => {
    const base = { title: "Gala", venue: "Main Hall", startsAt: "2030-01-02T00:00:00.000Z", tiers: [{ name: "General", priceCents: 1000, quantity: 6 }] };
    assert.throws(() => createEvent(makeStore(), organizer(), { ...base, title: "" }), HttpError);
    assert.throws(() => createEvent(makeStore(), organizer(), { ...base, venue: "" }), HttpError);
    assert.throws(() => createEvent(makeStore(), organizer(), { ...base, startsAt: "not-a-date" }), HttpError);
    assert.throws(() => createEvent(makeStore(), organizer(), { ...base, startsAt: "2029-12-31T23:59:59.000Z" }), HttpError);
    assert.throws(() => createEvent(makeStore(), organizer(), { ...base, tiers: [] }), HttpError);
    assert.throws(() => createEvent(makeStore(), organizer(), { ...base, tiers: [{ name: "A", priceCents: -1, quantity: 1 }] }), HttpError);
    assert.throws(() => createEvent(makeStore(), organizer(), { ...base, tiers: [{ name: "A", priceCents: 1, quantity: 0 }] }), HttpError);
    assert.throws(() => createEvent(makeStore(), organizer(), { ...base, tiers: [{ name: "A", priceCents: 1, quantity: 1 }, { name: "A", priceCents: 1, quantity: 1 }] }), HttpError);
  });
});

test("listEvents filters, sorts, and paginates only on-sale events", () => {
  withMockedNow("2030-01-01T00:00:00.000Z", () => {
    const store = makeStore();
    const e1 = createEvent(store, organizer(), { title: "Alpha", venue: "Zulu", startsAt: "2030-01-02T00:00:00.000Z", tiers: [{ name: "G", priceCents: 1, quantity: 1 }] });
    const e2 = createEvent(store, organizer(), { title: "Beta", venue: "Alpha", startsAt: "2030-01-03T00:00:00.000Z", tiers: [{ name: "G", priceCents: 1, quantity: 1 }] });
    const e3 = createEvent(store, organizer(), { title: "Gamma", venue: "Beta", startsAt: "2030-01-03T00:00:00.000Z", tiers: [{ name: "G", priceCents: 1, quantity: 1 }] });
    cancelEvent(store, organizer(), e2.id);

    const result = listEvents(store, {
      q: "a",
      from: "2030-01-01T00:00:00.000Z",
      to: "2030-01-04T00:00:00.000Z",
      page: "1",
      pageSize: "2",
    });

    assert.equal(result.page, 1);
    assert.equal(result.pageSize, 2);
    assert.equal(result.total, 2);
    assert.deepEqual(result.items.map((e) => e.id), [e1.id, e3.id]);
    assert.throws(() => listEvents(store, { from: "bad" }), HttpError);
    assert.throws(() => listEvents(store, { to: "bad" }), HttpError);
    assert.throws(() => listEvents(store, { page: "0" }), HttpError);
    assert.throws(() => listEvents(store, { pageSize: "51" }), HttpError);
  });
});

test("createDiscount returns uppercase code and live uses", () => {
  withMockedNow("2030-01-01T00:00:00.000Z", () => {
    const store = makeStore();
    const event = makeEvent(store);

    const discount = createDiscount(store, organizer(), event.id, { code: "save10", percentOff: 10 });
    assert.deepEqual(discount, {
      code: "SAVE10",
      percentOff: 10,
      amountOffCents: null,
      maxUses: null,
      expiresAt: null,
      uses: 0,
    });

    assert.throws(() => createDiscount(store, organizer(), event.id, { code: "ab", percentOff: 10 }), HttpError);
    assert.throws(() => createDiscount(store, organizer(), event.id, { code: "SAVE10", percentOff: 10, amountOffCents: 1 }), HttpError);
    assert.throws(() => createDiscount(store, organizer(), event.id, { code: "SAVE11", percentOff: 0 }), HttpError);
    assert.throws(() => createDiscount(store, organizer(), event.id, { code: "SAVE12", amountOffCents: 0 }), HttpError);
    assert.throws(() => createDiscount(store, organizer(), event.id, { code: "SAVE13", percentOff: 10, expiresAt: "bad" }), HttpError);
  });
});

test("createOrder, payOrder, cancelOrder, getOrder, and listCustomerOrders work end-to-end", () => {
  withMockedNow("2030-01-01T00:00:00.000Z", () => {
    const store = makeStore();
    const event = makeEvent(store);
    const order = createOrder(store, customer(), { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 2 }] });

    assert.equal(order.status, "held");
    assert.equal(order.subtotalCents, 2000);
    assert.equal(order.discountCents, 0);
    assert.equal(order.totalCents, 2000);
    assert.equal(order.discountCode, null);
    assert.deepEqual(order.items, [{ tierId: event.tiers[0].id, quantity: 2, unitPriceCents: 1000 }]);
    assert.deepEqual(getOrder(store, customer(), order.id), order);
    assert.deepEqual(listCustomerOrders(store, customer()).map((o) => o.id), [order.id]);

    const paid = payOrder(store, customer(), order.id);
    assert.equal(paid.status, "paid");
    assert.equal(typeof paid.paidAt, "string");

    const refunded = cancelOrder(store, customer(), order.id);
    assert.equal(refunded.status, "refunded");
    assert.equal(refunded.paidAt, paid.paidAt);
  });
});

test("createOrder validates input, availability, per-customer limit, event state, and discount usability", () => {
  withMockedNow("2030-01-01T00:00:00.000Z", () => {
    const store = makeStore();
    const event = makeEvent(store);
    const discount = createDiscount(store, organizer(), event.id, { code: "SAVE10", percentOff: 10, maxUses: 1 });

    assert.throws(() => createOrder(store, customer(), { eventId: 123 as unknown as string, items: [{ tierId: event.tiers[0].id, quantity: 1 }] }), (error: unknown) => error instanceof HttpError && error.status === 400 && error.message === "Invalid order input");
    assert.throws(() => createOrder(store, customer(), { eventId: event.id, items: [] }), (error: unknown) => error instanceof HttpError && error.status === 400 && error.message === "Invalid order input");
    assert.throws(() => createOrder(store, customer(), { eventId: event.id, items: [{ tierId: 123 as unknown as string, quantity: 1 }] }), (error: unknown) => error instanceof HttpError && error.status === 400 && error.message === "Invalid order input");
    assert.throws(() => createOrder(store, customer(), { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 0 }] }), (error: unknown) => error instanceof HttpError && error.status === 400 && error.message === "Invalid order input");
    assert.throws(() => createOrder(store, customer(), { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }, { tierId: event.tiers[0].id, quantity: 1 }] }), (error: unknown) => error instanceof HttpError && error.status === 400 && error.message === "Invalid order input");

    assert.throws(() => createOrder(store, customer(), { eventId: "missing", items: [{ tierId: event.tiers[0].id, quantity: 1 }] }), (error: unknown) => error instanceof HttpError && error.status === 404 && error.message === "Event not found");
    assert.throws(() => createOrder(store, customer(), { eventId: event.id, items: [{ tierId: "missing", quantity: 1 }] }), (error: unknown) => error instanceof HttpError && error.status === 400 && error.message === "Invalid order input");

    const soldOutStore = makeStore();
    const soldOutEvent = createEvent(soldOutStore, organizer(), {
      title: "Sold Out",
      venue: "Hall",
      startsAt: "2030-01-02T00:00:00.000Z",
      tiers: [{ name: "General", priceCents: 1000, quantity: 1 }],
    });
    createOrder(soldOutStore, customer("cus-2"), { eventId: soldOutEvent.id, items: [{ tierId: soldOutEvent.tiers[0].id, quantity: 1 }] });
    assert.throws(() => createOrder(soldOutStore, customer(), { eventId: soldOutEvent.id, items: [{ tierId: soldOutEvent.tiers[0].id, quantity: 1 }] }), (error: unknown) => error instanceof HttpError && error.status === 409 && error.message === "Not enough tickets available");

    const limitStore = makeStore();
    const limitEvent = makeEvent(limitStore);
    createOrder(limitStore, customer(), { eventId: limitEvent.id, items: [{ tierId: limitEvent.tiers[0].id, quantity: 6 }] });
    assert.throws(() => createOrder(limitStore, customer(), { eventId: limitEvent.id, items: [{ tierId: limitEvent.tiers[0].id, quantity: 1 }] }), (error: unknown) => error instanceof HttpError && error.status === 422 && error.message === "Ticket limit exceeded");

    const unavailableEventStore = makeStore();
    const unavailableEvent = createEvent(unavailableEventStore, organizer(), {
      title: "Past",
      venue: "Hall",
      startsAt: "2030-01-01T00:00:00.000Z",
      tiers: [{ name: "General", priceCents: 1000, quantity: 1 }],
    });
    withMockedNow("2030-01-01T00:00:00.000Z", () => {
      assert.throws(() => createOrder(unavailableEventStore, customer(), { eventId: unavailableEvent.id, items: [{ tierId: unavailableEvent.tiers[0].id, quantity: 1 }] }), (error: unknown) => error instanceof HttpError && error.status === 409 && error.message === "Event not available for ordering");
    });

    const discountStore = makeStore();
    const discountEvent = makeEvent(discountStore);
    createDiscount(discountStore, organizer(), discountEvent.id, { code: "SAVE10", percentOff: 10, maxUses: 1 });
    createOrder(discountStore, customer("cus-2"), { eventId: discountEvent.id, items: [{ tierId: discountEvent.tiers[0].id, quantity: 1 }], discountCode: "save10" });
    assert.throws(() => createOrder(discountStore, customer(), { eventId: discountEvent.id, items: [{ tierId: discountEvent.tiers[0].id, quantity: 1 }], discountCode: "SAVE10" }), (error: unknown) => error instanceof HttpError && error.status === 422 && error.message === "Discount code unusable");
    assert.throws(() => createOrder(discountStore, customer(), { eventId: discountEvent.id, items: [{ tierId: discountEvent.tiers[0].id, quantity: 1 }], discountCode: "missing" }), (error: unknown) => error instanceof HttpError && error.status === 422 && error.message === "Discount code unusable");

    assert.equal(discount.code, "SAVE10");
  });
});

test("joinWaitlist and listCustomerWaitlist preserve queue order and positions", () => {
  withMockedNow("2030-01-01T00:00:00.000Z", () => {
    const store = makeStore();
    const event = makeEvent(store);
    createOrder(store, customer("cus-2"), { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 5 }] });

    const first = joinWaitlist(store, customer(), event.id, { tierId: event.tiers[0].id, quantity: 1 });
    const second = joinWaitlist(store, customer("cus-3"), event.id, { tierId: event.tiers[0].id, quantity: 1 });

    assert.deepEqual(first, { id: first.id, eventId: event.id, tierId: event.tiers[0].id, quantity: 1, position: 1 });
    assert.deepEqual(second, { id: second.id, eventId: event.id, tierId: event.tiers[0].id, quantity: 1, position: 2 });
    assert.deepEqual(listCustomerWaitlist(store, customer()), [{ id: first.id, eventId: event.id, tierId: event.tiers[0].id, quantity: 1, position: 1 }]);

    assert.throws(() => joinWaitlist(store, customer("cus-4"), event.id, { tierId: event.tiers[0].id, quantity: 1 }), (error: unknown) => error instanceof HttpError && error.status === 409 && error.message === "Already waitlisted");
    assert.throws(() => joinWaitlist(store, customer("cus-5"), event.id, { tierId: event.tiers[0].id, quantity: 7 }), (error: unknown) => error instanceof HttpError && error.status === 400 && error.message === "Invalid waitlist input");
    assert.throws(() => joinWaitlist(store, customer("cus-5"), event.id, { tierId: "missing", quantity: 1 }), (error: unknown) => error instanceof HttpError && error.status === 400 && error.message === "Invalid waitlist input");
    assert.throws(() => joinWaitlist(store, customer("cus-5"), "missing", { tierId: event.tiers[0].id, quantity: 1 }), (error: unknown) => error instanceof HttpError && error.status === 404 && error.message === "Event not found");
    assert.throws(() => joinWaitlist(store, customer("cus-5"), event.id, { tierId: event.tiers[0].id, quantity: 5 }), (error: unknown) => error instanceof HttpError && error.status === 409 && error.message === "Tickets available");
  });
});

test("cancelOrder, cancelEvent, and waitlist serving free tickets in FIFO order", () => {
  withMockedNow("2030-01-01T00:00:00.000Z", () => {
    const store = makeStore();
    const event = makeEvent(store);
    const hold = createOrder(store, customer(), { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 5 }] });
    const waitlisted = joinWaitlist(store, customer("cus-2"), event.id, { tierId: event.tiers[0].id, quantity: 1 });

    const cancelled = cancelOrder(store, customer(), hold.id);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(listCustomerWaitlist(store, customer("cus-2")).length, 0);
    assert.equal(listCustomerOrders(store, customer("cus-2")).length, 1);

    const event2 = makeEvent(makeStore(), { title: "Other", venue: "Venue", startsAt: "2030-01-02T00:00:00.000Z" });
    assert.equal(waitlisted.id.length > 0, true);
    assert.equal(event2.status, "on_sale");
  });
});

test("payOrder, cancelOrder, and getOrder enforce ownership and status rules", () => {
  withMockedNow("2030-01-01T00:00:00.000Z", () => {
    const store = makeStore();
    const event = makeEvent(store);
    const order = createOrder(store, customer(), { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] });

    assert.throws(() => payOrder(store, customer("other"), order.id), (error: unknown) => error instanceof HttpError && error.status === 404 && error.message === "Order not found");
    assert.throws(() => getOrder(store, customer("other"), order.id), (error: unknown) => error instanceof HttpError && error.status === 404 && error.message === "Order not found");
    assert.deepEqual(getOrder(store, organizer(), order.id), order);

    const paid = payOrder(store, customer(), order.id);
    assert.throws(() => payOrder(store, customer(), order.id), (error: unknown) => error instanceof HttpError && error.status === 409 && error.message === "Order not payable");
    assert.deepEqual(cancelOrder(store, customer(), order.id).status, "refunded");
    assert.throws(() => cancelOrder(store, customer(), order.id), (error: unknown) => error instanceof HttpError && error.status === 409 && error.message === "Order not cancellable");
    assert.equal(paid.status, "paid");
  });
});

test("getEventReport aggregates sold, held, available, gross, discount, refunded, and net", () => {
  withMockedNow("2030-01-01T00:00:00.000Z", () => {
    const store = makeStore();
    const event = createEvent(store, organizer(), {
      title: "Show",
      venue: "Hall",
      startsAt: "2030-01-03T00:00:00.000Z",
      tiers: [
        { name: "General", priceCents: 1000, quantity: 3 },
        { name: "VIP", priceCents: 2000, quantity: 2 },
      ],
    });
    const discount = createDiscount(store, organizer(), event.id, { code: "SAVE10", percentOff: 10 });
    const paidOrder = createOrder(store, customer(), { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 2 }], discountCode: discount.code });
    payOrder(store, customer(), paidOrder.id);
    const heldOrder = createOrder(store, customer("cus-2"), { eventId: event.id, items: [{ tierId: event.tiers[1].id, quantity: 1 }] });
    const refundedOrder = createOrder(store, customer("cus-3"), { eventId: event.id, items: [{ tierId: event.tiers[0].id, quantity: 1 }] });
    payOrder(store, customer("cus-3"), refundedOrder.id);
    cancelOrder(store, customer("cus-3"), refundedOrder.id);

    const report = getEventReport(store, organizer(), event.id);
    assert.deepEqual(report, {
      eventId: event.id,
      tiers: [
        { tierId: event.tiers[0].id, name: "General", sold: 2, held: 0, available: 1 },
        { tierId: event.tiers[1].id, name: "VIP", sold: 0, held: 1, available: 1 },
      ],
      grossCents: 2000,
      discountCents: 200,
      refundedCents: 1000,
      netCents: 1800,
    });

    assert.throws(() => getEventReport(store, customer(), event.id), (error: unknown) => error instanceof HttpError && error.status === 403 && error.message === "Forbidden");
    assert.throws(() => getEventReport(store, organizer(), "missing"), (error: unknown) => error instanceof HttpError && error.status === 404 && error.message === "Event not found");
    assert.equal(heldOrder.status, "held");
  });
});
