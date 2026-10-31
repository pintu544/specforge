export type UserRecord = {
  id: string;
  email: string;
  emailLower: string;
  password: string;
  name: string;
  role: "organizer" | "customer";
};

export type EventTierRecord = {
  id: string;
  name: string;
  priceCents: number;
  quantity: number;
};

export type EventRecord = {
  id: string;
  title: string;
  venue: string;
  startsAt: string;
  status: "on_sale" | "cancelled";
  organizerId: string;
  tiers: EventTierRecord[];
};

export type DiscountRecord = {
  eventId: string;
  code: string;
  percentOff: number | null;
  amountOffCents: number | null;
  maxUses: number | null;
  expiresAt: string | null;
};

export type OrderItemRecord = {
  tierId: string;
  quantity: number;
  unitPriceCents: number;
};

export type OrderRecord = {
  id: string;
  eventId: string;
  customerId: string;
  status: "held" | "paid" | "expired" | "cancelled" | "refunded";
  items: OrderItemRecord[];
  subtotalCents: number;
  discountCode: string | null;
  discountCents: number;
  totalCents: number;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
};

export type WaitlistRecord = {
  id: string;
  eventId: string;
  tierId: string;
  customerId: string;
  quantity: number;
};

export type Store = {
  holdSeconds: number;
  nextId: number;
  users: Map<string, UserRecord>;
  usersByEmailLower: Map<string, string>;
  sessions: Map<string, string>;
  events: Map<string, EventRecord>;
  discountsByEventId: Map<string, Map<string, DiscountRecord>>;
  orders: Map<string, OrderRecord>;
  waitlistsByTierKey: Map<string, WaitlistRecord[]>;
};

export function createStore(holdSeconds: number): Store {
  return {
    holdSeconds,
    nextId: 1,
    users: new Map(),
    usersByEmailLower: new Map(),
    sessions: new Map(),
    events: new Map(),
    discountsByEventId: new Map(),
    orders: new Map(),
    waitlistsByTierKey: new Map(),
  };
}

export function generateId(store: Store): string {
  const id = `id-${store.nextId}`;
  store.nextId += 1;
  return id;
}
