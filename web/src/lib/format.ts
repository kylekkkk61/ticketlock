const LONDON = "Europe/London";

export const shortAddress = (address: string) => address.slice(0, 6) + "…" + address.slice(-4);
export const shortHash = (hash: string) => hash.slice(0, 10) + "…" + hash.slice(-6);

/** Readable Europe/London time with an explicit timezone label. Accepts Unix seconds or ISO. */
export function formatDateTime(value: number | string, withSeconds = false) {
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    timeZoneName: "short",
  }).format(date);
}

export function formatEventDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export function formatTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}
