// Display details for the seeded demo event. Organiser, capacity and counts come from the chain.
export type EventDisplay = {
  name: string;
  tagline: string;
  venue: string;
  city: string;
  startsAt: string; // ISO 8601, Europe/London
  doorsAt: string;
  priceLabel: string;
  admission: string;
};

const DEMO_EVENT: EventDisplay = {
  name: "Midnight Circuit",
  tagline: "One night of live electronic music",
  venue: "The Foundry",
  city: "Coventry",
  startsAt: "2026-12-12T20:00:00+00:00",
  doorsAt: "2026-12-12T19:00:00+00:00",
  priceLabel: "£25",
  admission: "General admission",
};

const EVENTS: Record<number, EventDisplay> = { 1: DEMO_EVENT };

export const eventDisplay = (eventId: number): EventDisplay => EVENTS[eventId] ?? DEMO_EVENT;
