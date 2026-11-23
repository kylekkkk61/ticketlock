"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Chip, Notice, TxLink, Working } from "@/components/ui";
import type { EventState } from "@/lib/chain-read";
import { useConfig } from "@/lib/client/config";
import { usePolling, useSession } from "@/lib/client/session";
import { eventDisplay } from "@/lib/event-info";
import { formatEventDate, formatTime } from "@/lib/format";
import type { OrderView } from "@/server/services";

const STORAGE_KEY = "ticketlock.checkout";
type StoredCheckout = { key: string; orderId?: string };

const readCheckout = (): StoredCheckout | null => {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
};

function PurchasePanel({ remaining, onIssued }: { remaining: number | null; onIssued: () => void }) {
  const { status, login, api } = useSession();
  const { confirmedLabel } = useConfig();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A refresh during issuance continues the same order.
  useEffect(() => {
    if (status !== "ready") return;
    const stored = readCheckout();
    if (!stored?.orderId) return;
    api<OrderView>("/api/orders/" + stored.orderId)
      .then(setOrder)
      .catch(() => sessionStorage.removeItem(STORAGE_KEY));
  }, [status, api]);

  const orderId = order?.id;
  const orderStatus = order?.job.status;
  const poll = useCallback(async () => {
    if (orderId) setOrder(await api<OrderView>("/api/orders/" + orderId));
  }, [orderId, api]);
  usePolling(poll, 2000, orderStatus === "processing");

  // Once the order has a final result, the next purchase is a new order.
  useEffect(() => {
    if (orderStatus === "confirmed" || orderStatus === "failed") sessionStorage.removeItem(STORAGE_KEY);
    if (orderStatus === "confirmed") onIssued();
  }, [orderStatus, onIssued]);

  const buy = async () => {
    setBusy(true);
    setError(null);
    try {
      // Repeated clicks and retries reuse the key, so they continue one order.
      const stored = readCheckout() ?? { key: crypto.randomUUID() };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      const created = await api<OrderView>("/api/orders", { body: { checkoutKey: stored.key } });
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, orderId: created.id }));
      setOrder(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the order.");
    } finally {
      setBusy(false);
    }
  };

  const display = eventDisplay(1);
  const soldOut = remaining === 0;

  return (
    <div className="card p-6 sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow text-body">{display.admission}</p>
          <p className="mt-1 text-5xl font-extrabold tracking-tight">{display.priceLabel}</p>
        </div>
        {remaining !== null && <Chip tone={soldOut ? "used" : "neutral"}>{soldOut ? "Sold out" : remaining + " left"}</Chip>}
      </div>

      <div className="mt-6 border-t border-line pt-6">
        {!order && (
          <>
            {status === "ready" ? (
              <button className="btn btn-primary w-full" onClick={buy} disabled={busy || soldOut}>
                {busy ? "Starting order…" : "Simulate payment — " + display.priceLabel}
              </button>
            ) : status === "signedOut" ? (
              <button className="btn btn-primary w-full" onClick={login}>
                Sign in to buy
              </button>
            ) : (
              <Working>{status === "preparing" ? "Preparing your account" : "Loading"}</Working>
            )}
            <p className="mt-3 text-sm text-body">
              Demo checkout. No card is charged and no real payment is taken. The ticket itself is real and is issued to
              your account.
            </p>
            {error && <div className="mt-4"><Notice>{error}</Notice></div>}
          </>
        )}

        {order?.job.status === "processing" && (
          <div>
            <Working>Issuing your ticket</Working>
            <p className="mt-2 text-sm text-body">
              Payment simulated. Your ticket appears once the network confirms it; this usually takes a few seconds.
            </p>
            {order.job.txHash && (
              <p className="mt-3 text-sm text-body">
                Transaction sent: <TxLink hash={order.job.txHash} />
              </p>
            )}
          </div>
        )}

        {order?.job.status === "confirmed" && (
          <div>
            <Chip tone="available">{confirmedLabel}</Chip>
            <p className="mt-3 text-xl font-bold">Your ticket is in your account.</p>
            {order.job.txHash && (
              <p className="mt-1 text-sm text-body">
                Issued in transaction <TxLink hash={order.job.txHash} />
              </p>
            )}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Link href="/tickets" className="btn btn-dark flex-1">
                View my tickets
              </Link>
              <button className="btn btn-outline flex-1" onClick={() => setOrder(null)}>
                Buy another
              </button>
            </div>
          </div>
        )}

        {order?.job.status === "failed" && (
          <div>
            <Notice>{order.job.error ?? "The ticket could not be issued."} No ticket was created for this order.</Notice>
            <button className="btn btn-outline mt-4 w-full" onClick={() => setOrder(null)}>
              Back to checkout
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function EventsPage() {
  const config = useConfig();
  const display = eventDisplay(config.eventId);
  const [event, setEvent] = useState<EventState | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/event", { cache: "no-store" });
    if (response.ok) setEvent(await response.json());
  }, []);
  usePolling(load, 8000, true);

  return (
    <>
      <section className="bg-ink text-white">
        <div className="mx-auto max-w-6xl px-5 pb-12 pt-10 sm:px-8 sm:pb-20 sm:pt-16">
          <p className="eyebrow text-accent">
            {formatEventDate(display.startsAt)} · {display.venue}, {display.city}
          </p>
          <h1 className="mt-4 text-[15vw] font-extrabold uppercase leading-[0.88] tracking-[-0.03em] sm:text-[112px]">
            {display.name}
          </h1>
          <p className="mt-5 max-w-xl text-2xl font-light leading-snug text-white/80 sm:text-3xl">{display.tagline}</p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-10 px-5 py-10 sm:px-8 sm:py-16 lg:grid-cols-[1fr_420px]">
        <div>
          <h2 className="text-3xl font-light tracking-tight sm:text-4xl">Event details</h2>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-line pt-6">
            {[
              ["Date", formatEventDate(display.startsAt)],
              ["Doors", formatTime(display.doorsAt) + " · show " + formatTime(display.startsAt)],
              ["Venue", display.venue + ", " + display.city],
              ["Capacity", event ? event.capacity + " tickets" : "…"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="eyebrow text-body">{label}</dt>
                <dd className="mt-1 text-lg font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <ol className="mt-10 grid gap-6 border-t border-line pt-8 sm:grid-cols-3">
            {[
              ["Buy", "Your ticket is issued straight to your account."],
              ["Transfer", "Send it to another account by email. You confirm; nobody else can move it."],
              ["Enter", "Scan the door code and confirm. Staff admit you, and the ticket is used once."],
            ].map(([title, body], index) => (
              <li key={title}>
                <span className="grid size-9 place-items-center rounded-full bg-ink text-sm font-bold text-white">{index + 1}</span>
                <p className="mt-3 text-lg font-bold">{title}</p>
                <p className="mt-1 text-[15px] leading-snug text-body">{body}</p>
              </li>
            ))}
          </ol>
        </div>
        <div className="order-first lg:order-none lg:-mt-36">
          <PurchasePanel remaining={event ? event.capacity - event.mintedCount : null} onIssued={load} />
        </div>
      </section>
    </>
  );
}
