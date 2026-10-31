export type Role = "organizer" | "customer";

export type User = {
  id: string;
  email: string;
  password: string;
  name: string;
  role: Role;
};

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export type Session = {
  token: string;
  userId: string;
};

export type EventStatus = "on_sale" | "cancelled";

export type StoredTier = {
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
  status: EventStatus;
  organizerId: string;
  tiers: StoredTier[];
};

export type EventTier = {
  id: string;
  name: string;
  priceCents: number;
  quantity: number;
  available: number;
};

export type Event = {
  id: string;
  title: string;
  venue: string;
  startsAt: string;
  status: EventStatus;
  organizerId: string;
  tiers: EventTier[];
};

export type OrderStatus = "held" | "paid" | "expired" | "cancelled" | "refunded";

export type OrderItem = {
  tierId: string;
  quantity: number;
  unitPriceCents: number;
};

export type Order = {
  id: string;
  eventId: string;
  customerId: string;
  status: OrderStatus;
  items: OrderItem[];
  subtotalCents: number;
  discountCode: string | null;
  discountCents: number;
  totalCents: number;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
};

export type DiscountRecord = {
  eventId: string;
  code: string;
  percentOff: number | null;
  amountOffCents: number | null;
  maxUses: number | null;
  expiresAt: string | null;
};

export type Discount = {
  code: string;
  percentOff: number | null;
  amountOffCents: number | null;
  maxUses: number | null;
  expiresAt: string | null;
  uses: number;
};

export type WaitlistEntryRecord = {
  id: string;
  eventId: string;
  tierId: string;
  customerId: string;
  quantity: number;
  createdAt: string;
};

export type WaitlistEntry = {
  id: string;
  eventId: string;
  tierId: string;
  quantity: number;
  position: number;
};

export type EventReportTier = {
  tierId: string;
  name: string;
  sold: number;
  held: number;
  available: number;
};

export type EventReport = {
  eventId: string;
  tiers: EventReportTier[];
  grossCents: number;
  discountCents: number;
  refundedCents: number;
  netCents: number;
};

export type CreateUserInput = {
  email: string;
  password: string;
  name: string;
  role: string;
};

export type CreateSessionInput = {
  email: string;
  password: string;
};

export type CreateEventTierInput = {
  name: string;
  priceCents: number;
  quantity: number;
};

export type CreateEventInput = {
  title: string;
  venue: string;
  startsAt: string;
  tiers: CreateEventTierInput[];
};

export type ListEventsQuery = {
  from?: string;
  to?: string;
  q?: string;
  page?: string;
  pageSize?: string;
};

export type PaginatedEvents = {
  items: Event[];
  page: number;
  pageSize: number;
  total: number;
};

export type CreateDiscountInput = {
  code: string;
  percentOff?: number;
  amountOffCents?: number;
  maxUses?: number;
  expiresAt?: string;
};

export type CreateOrderItemInput = {
  tierId: string;
  quantity: number;
};

export type CreateOrderInput = {
  eventId: string;
  items: CreateOrderItemInput[];
  discountCode?: string;
};

export type JoinWaitlistInput = {
  tierId: string;
  quantity: number;
};

export type Store = {
  nextId: number;
  users: User[];
  sessions: Session[];
  events: EventRecord[];
  orders: Order[];
  discounts: DiscountRecord[];
  waitlistEntries: WaitlistEntryRecord[];
};

export function createStore(): Store {
  return {
    nextId: 1,
    users: [],
    sessions: [],
    events: [],
    orders: [],
    discounts: [],
    waitlistEntries: [],
  };
}

export function generateId(store: Store): string {
  const id = `id-${store.nextId}`;
  store.nextId += 1;
  return id;
}
