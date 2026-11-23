"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { TicketVisual } from "@/components/ticket-visual";
import { Chip, Notice, SignInPrompt, TxLink, Working } from "@/components/ui";
import { useConfig } from "@/lib/client/config";
import { usePolling, useSession } from "@/lib/client/session";
import { eventDisplay } from "@/lib/event-info";
import { formatDateTime } from "@/lib/format";
import { CHECK_IN_VALIDITY_SECONDS, type CheckInTypedData } from "@/lib/permits";
import type { AdmissionView, TicketView } from "@/server/services";

function useSecondsLeft(deadline: number | null) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (deadline === null) return;
    // Capped at the permit's lifetime in case this device's clock runs behind the network's.
    const update = () =>
      setLeft(Math.min(CHECK_IN_VALIDITY_SECONDS, Math.max(0, deadline - Math.floor(Date.now() / 1000))));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [deadline]);
  return left;
}

const ENDED: Partial<Record<AdmissionView["status"], string>> = {
  rejected: "Staff did not admit this request. Your ticket is still available.",
  expired: "Staff did not confirm in time. Your ticket is still available.",
  superseded: "A newer entry request replaced this one.",
};

function AdmitInner() {
  const params = useSearchParams();
  const config = useConfig();
  const { status, login, api, sign } = useSession();
  const eventId = Number(params.get("eventId"));
  const preferred = Number(params.get("ticket"));
  const display = eventDisplay(eventId);

  const [tickets, setTickets] = useState<TicketView[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [request, setRequest] = useState<AdmissionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTickets = useCallback(async () => {
    const mine = (await api<TicketView[]>("/api/tickets")).filter((t) => t.eventId === eventId);
    setTickets(mine);
    return mine;
  }, [api, eventId]);

  // On arrival (or after a refresh) continue an entry request that is already open.
  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    void (async () => {
      const mine = await loadTickets().catch(() => null);
      if (!mine || cancelled) return;
      const open = mine.find((t) => t.pending?.kind === "admission");
      if (open?.pending?.kind === "admission") {
        const existing = await api<AdmissionView>("/api/admissions/" + open.pending.requestId).catch(() => null);
        if (existing && !cancelled) setRequest(existing);
      }
      const available = mine.filter((t) => !t.used && !t.pending);
      setSelected((available.find((t) => t.tokenId === preferred) ?? available[0])?.tokenId ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, api, loadTickets, preferred]);

  const requestId = request?.id;
  const poll = useCallback(async () => {
    if (requestId) setRequest(await api<AdmissionView>("/api/admissions/" + requestId));
  }, [requestId, api]);
  usePolling(poll, 2000, request?.status === "waiting" || request?.status === "processing");
  const secondsLeft = useSecondsLeft(request?.status === "waiting" ? request.deadline : null);

  // Signing happens only here, when the holder presses Confirm entry.
  const confirm = async () => {
    if (selected === null) return;
    setBusy(true);
    setError(null);
    try {
      const { typedData } = await api<{ typedData: CheckInTypedData }>("/api/admissions/prepare", {
        body: { eventId, tokenId: selected },
      });
      const signature = await sign(typedData);
      setRequest(await api<AdmissionView>("/api/admissions", { body: { permit: typedData.message, signature } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not request entry. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const startAgain = () => {
    setRequest(null);
    setError(null);
    void loadTickets();
  };

  if (eventId !== config.eventId) {
    return (
      <Notice>This entry code is not for a TicketLock event. Ask staff to show the event&apos;s entry code.</Notice>
    );
  }
  if (status === "signedOut") {
    return <SignInPrompt title="Sign in to enter" body={"Use the account that holds your " + display.name + " ticket."} onSignIn={login} />;
  }
  if (status !== "ready" || !tickets) {
    return <Working>{status === "preparing" ? "Preparing your account" : "Finding your ticket"}</Working>;
  }

  if (request) {
    const visual = (chip: ReactNode) => (
      <TicketVisual eventId={eventId} ticketNumber={request.ticketNumber} status={chip} />
    );
    if (request.status === "waiting") {
      return (
        <div>
          {visual(<Chip tone="pending">Waiting for staff</Chip>)}
          <div className="mt-6 text-center">
            <p className="eyebrow text-body">Show this code to staff</p>
            <p className="mt-2 font-mono text-[72px] font-bold leading-none tracking-[0.12em]">{request.shortCode}</p>
            <p className="mt-4 text-body">
              {secondsLeft > 0 ? "Valid for " + secondsLeft + " more seconds" : "Checking…"}
            </p>
            <p className="mt-6 text-sm text-body">Your ticket is not used until staff admit you.</p>
          </div>
        </div>
      );
    }
    if (request.status === "processing") {
      return (
        <div>
          {visual(<Chip tone="pending">Checking in</Chip>)}
          <div className="mt-6">
            <Working>Checking in</Working>
            <p className="mt-2 text-sm text-body">Staff confirmed. Waiting for the network to record your entry.</p>
            {request.job?.txHash && (
              <p className="mt-3 text-sm text-body">
                Transaction sent: <TxLink hash={request.job.txHash} />
              </p>
            )}
          </div>
        </div>
      );
    }
    if (request.status === "confirmed") {
      return (
        <div>
          {visual(<Chip tone="used" onDark>Used</Chip>)}
          <div className="mt-6">
            <Chip tone="available">{config.confirmedLabel}</Chip>
            <p className="mt-3 text-3xl font-extrabold tracking-tight">You&apos;re in. Enjoy the show.</p>
            {request.job?.blockTime && (
              <p className="mt-2 text-body">Entry recorded {formatDateTime(request.job.blockTime, true)}</p>
            )}
            {request.job?.txHash && (
              <p className="mt-1 text-sm text-body">
                Transaction <TxLink hash={request.job.txHash} />
              </p>
            )}
            <Link href="/tickets" className="btn btn-outline mt-6 w-full">
              Back to my tickets
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div>
        {visual(<Chip tone="available">Available</Chip>)}
        <div className="mt-6">
          <Notice tone={request.status === "failed" ? "danger" : "info"}>
            {request.status === "failed"
              ? (request.job?.error ?? "The check-in could not be completed.") + " Your ticket was not used."
              : ENDED[request.status]}
          </Notice>
          <button className="btn btn-primary mt-5 w-full" onClick={startAgain}>
            Request entry again
          </button>
        </div>
      </div>
    );
  }

  const available = tickets.filter((t) => !t.used && !t.pending);
  if (available.length === 0) {
    const used = tickets.some((t) => t.used);
    return (
      <div className="card p-8">
        <p className="text-xl font-bold">No available ticket for this event</p>
        <p className="mt-1 text-body">
          {used
            ? "Your ticket for this event has already been used."
            : "This account does not hold a ticket for " + display.name + "."}
        </p>
        <Link href="/tickets" className="btn btn-outline mt-6">
          My tickets
        </Link>
      </div>
    );
  }

  const chosen = available.find((t) => t.tokenId === selected) ?? available[0];
  return (
    <div>
      <TicketVisual eventId={eventId} ticketNumber={chosen.ticketNumber} status={<Chip tone="available">Available</Chip>} />
      {available.length > 1 && (
        <fieldset className="mt-5">
          <legend className="eyebrow mb-2 text-body">Choose a ticket</legend>
          <div className="flex flex-wrap gap-2">
            {available.map((t) => (
              <button
                key={t.tokenId}
                type="button"
                aria-pressed={t.tokenId === chosen.tokenId}
                onClick={() => setSelected(t.tokenId)}
                className={"btn btn-sm " + (t.tokenId === chosen.tokenId ? "btn-dark" : "btn-outline")}
              >
                Ticket #{t.ticketNumber}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {error && <div className="mt-5"><Notice>{error}</Notice></div>}
      <button className="btn btn-primary mt-6 w-full" onClick={confirm} disabled={busy}>
        {busy ? "Confirming…" : "Confirm entry"}
      </button>
      <p className="mt-3 text-center text-sm text-body">
        Confirming asks staff to admit Ticket #{chosen.ticketNumber}. It is used only once they accept.
      </p>
    </div>
  );
}

export default function AdmitPage() {
  return (
    <div className="mx-auto max-w-md px-5 py-8 sm:py-12">
      <h1 className="mb-6 text-4xl font-extrabold tracking-tight">Enter event</h1>
      <Suspense>
        <AdmitInner />
      </Suspense>
    </div>
  );
}
