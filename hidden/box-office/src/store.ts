export type UserRole = "organizer" | "customer";
export type EventStatus = "on_sale" | "cancelled";
export type OrderStatus = "held" | "paid" | "expired" | "cancelled" | "refunded";

export interface UserRecord {
  id: string;
  email: string;
  emailKey: string;
  password: string;
  name: string;
  role: UserRole;
}

export interface SessionRecord {
  token: string;
  userId: string;
}

export interface EventTierRecord {
  id: string;
  name: string;
  priceCents: number;
  quantity: number;
}

export interface DiscountRecord {
  code: string;
  percentOff: number | null;
  amountOffCents: number | null;
  maxUses: number | null;
  expiresAt: string | null;
}

export interface EventRecord {
  id: string;
  title: string;
  venue: string;
  startsAt: string;
  status: EventStatus;
  organizerId: string;
  tiers: EventTierRecord[];
  discounts: DiscountRecord[];
}

export interface OrderItemRecord {
  tierId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface OrderRecord {
  id: string;
  eventId: string;
  customerId: string;
  status: OrderStatus;
  items: OrderItemRecord[];
  subtotalCents: number;
  discountCode: string | null;
  discountCents: number;
  totalCents: number;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
}

export interface WaitlistEntryRecord {
  id: string;
  eventId: string;
  tierId: string;
  customerId: string;
  quantity: number;
  createdAt: string;
}

export interface Store {
  users: UserRecord[];
  sessions: SessionRecord[];
  events: EventRecord[];
  orders: OrderRecord[];
  waitlist: WaitlistEntryRecord[];
  nextIdValue: number;
}

export function createStore(): Store {
  return {
    users: [],
    sessions: [],
    events: [],
    orders: [],
    waitlist: [],
    nextIdValue: 1,
  };
}

export function nextId(store: Store): string {
  const id = `id_${store.nextIdValue}`;
  store.nextIdValue += 1;
  return id;
}
