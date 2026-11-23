"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { AddressLink, Chip, Notice, SignInPrompt, TxLink, Working } from "@/components/ui";
import { useConfig } from "@/lib/client/config";
import { usePolling, useSession } from "@/lib/client/session";
import { eventDisplay } from "@/lib/event-info";
import { formatDateTime, formatEventDate } from "@/lib/format";
import type { organiserOverview } from "@/server/services";

type Overview = Awaited<ReturnType<typeof organiserOverview>>;
type Pending = Overview["pending"][number];

function EntryCode({ appUrl, path }: { appUrl: string | null; path: string }) {
  const [code, setCode] = useState<{ url: string; image: string } | null>(null);
  useEffect(() => {
    // The phone must reach this URL, so the configured public address wins over the current one.
    const url = (appUrl ?? window.location.origin) + path;
    QRCode.toDataURL(url, { width: 640, margin: 1, errorCorrectionLevel: "M", color: { dark: "#0e1512", light: "#ffffff" } })
      .then((image) => setCode({ url, image }))
      .catch(() => setCode(null));
  }, [appUrl, path]);
  return (
    <div className="rounded-[12px] bg-ink p-5 text-white">
      <p className="eyebrow text-accent">Entry code · display at the door</p>
      <div className="mx-auto mt-4 aspect-square max-w-[288px] overflow-hidden rounded-[6px] bg-white p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {code && <img src={code.image} alt="Entry QR code for this event" className="size-full" />}
      </div>
      <p className="mono mt-4 text-white/70">{code?.url}</p>
      <p className="mt-2 text-sm text-white/60">
        The code only names the event. Each entry still needs the customer&apos;s confirmation and yours.
      </p>
    </div>
  );
}

function PendingCard({ request, now, onDone }: { request: Pending; now: number; onDone: () => void }) {
  const { api, sign } = useSession();
  const [busy, setBusy] = useState<"admit" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const secondsLeft = Math.max(0, request.deadline - now);

  const act = async (action: "admit" | "reject") => {
    setBusy(action);
    setError(null);
    try {
      // Admit signs the customer's unchanged request with the organiser account.
      const body =
        action === "admit"
          ? { action: "approve", signature: await sign(request.typedData) }
          : { action: "reject" };
      await api("/api/organiser/requests/" + request.id, { body });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the request.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow text-body">Request code</p>
          <p className="font-mono text-5xl font-bold leading-tight tracking-[0.1em]">{request.shortCode}</p>
        </div>
        {request.status === "processing" ? (
          <Chip tone="pending">Checking in</Chip>
        ) : (
          <Chip tone={secondsLeft <= 20 ? "danger" : "neutral"}>{secondsLeft}s left</Chip>
        )}
      </div>
      <p className="mt-3 text-[15px] text-body">
        Ticket #{request.ticketNumber} · holder <AddressLink address={request.holder} />
      </p>
      {request.status === "processing" ? (
        <div className="mt-4">
          <Working>Recording entry on the network</Working>
          {request.job?.txHash && (
            <p className="mt-2 text-sm text-body">
              Transaction sent: <TxLink hash={request.job.txHash} />
            </p>
          )}
          <p className="mt-2 text-sm font-semibold">Wait for the confirmed result below before letting the customer in.</p>
        </div>
      ) : (
        <div className="mt-5 flex gap-3">
          <button className="btn btn-primary flex-1" onClick={() => act("admit")} disabled={busy !== null}>
            {busy === "admit" ? "Admitting…" : "Admit"}
          </button>
          <button className="btn btn-danger" onClick={() => act("reject")} disabled={busy !== null}>
            Reject
          </button>
        </div>
      )}
      {error && <div className="mt-4"><Notice>{error}</Notice></div>}
    </li>
  );
}

const RESULT: Record<string, { label: string; tone: "available" | "danger" | "used" }> = {
  confirmed: { label: "Admitted", tone: "available" },
  failed: { label: "Failed", tone: "danger" },
  rejected: { label: "Rejected", tone: "used" },
  expired: { label: "Expired", tone: "used" },
};

export default function OrganiserPage() {
  const config = useConfig();
  const { status, me, login, api } = useSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const display = eventDisplay(config.eventId);

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => setOverview(await api<Overview>("/api/organiser")), [api]);
  usePolling(load, 2000, status === "ready" && !!me?.isOrganiser);

  if (status === "signedOut") {
    return (
      <div className="px-5 py-12">
        <SignInPrompt title="Organiser sign-in" body="Sign in with the organiser account for this event." onSignIn={login} />
      </div>
    );
  }
  if (status !== "ready") {
    return <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8"><Working>Loading</Working></div>;
  }
  if (!me?.isOrganiser) {
    return (
      <div className="mx-auto max-w-md px-5 py-12">
        <Notice tone="info">
          This account is not the organiser of {display.name}. The organiser is fixed in the contract and cannot be
          selected here.
        </Notice>
      </div>
    );
  }

  const pending = overview?.pending.filter((p) => p.status === "processing" || p.deadline >= now) ?? [];

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow text-body">Manage event</p>
          <h1 className="mt-1 text-4xl font-extrabold uppercase tracking-tight sm:text-5xl">{display.name}</h1>
          <p className="mt-2 text-body">
            {formatEventDate(display.startsAt)} · {display.venue}, {display.city}
          </p>
        </div>
        <dl className="grid grid-cols-3 divide-x divide-line rounded-[12px] border border-line text-center lg:w-[420px]">
          {[
            ["Capacity", overview?.event.capacity],
            ["Issued", overview?.event.mintedCount],
            ["Checked in", overview?.event.checkedInCount],
          ].map(([label, value]) => (
            <div key={label as string} className="px-2 py-3">
              <dd className="text-3xl font-extrabold tracking-tight">{value ?? "…"}</dd>
              <dt className="eyebrow mt-1 text-body">{label}</dt>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[380px_1fr]">
        <aside className="space-y-6">
          {/* The code comes first so staff never have to scroll to show it. */}
          <EntryCode appUrl={config.appUrl} path={"/admit?eventId=" + config.eventId} />
          <p className="text-sm text-body">
            Counts are read from the contract. Organiser account <AddressLink address={me.address} />.
          </p>
        </aside>

        <section>
          <h2 className="text-2xl font-bold tracking-tight">Waiting at the door</h2>
          <p className="mt-1 text-body">Match the code on the customer&apos;s screen, then admit.</p>
          {pending.length === 0 ? (
            <div className="mt-4 rounded-[12px] bg-soft p-8 text-center text-body">No entry requests right now.</div>
          ) : (
            <ul className="mt-4 grid gap-4 md:grid-cols-2">
              {pending.map((request) => (
                <PendingCard key={request.id} request={request} now={now} onDone={() => void load()} />
              ))}
            </ul>
          )}

          <h2 className="mt-10 text-2xl font-bold tracking-tight">Recent results</h2>
          {!overview || overview.recent.length === 0 ? (
            <p className="mt-3 text-body">Results appear here after you admit or reject a request.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line border-y border-line">
              {overview.recent.map((result) => (
                <li key={result.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3.5">
                  <span className="w-20 font-mono text-lg font-bold tracking-[0.08em]">{result.shortCode}</span>
                  <span className="w-24 text-[15px] font-semibold">Ticket #{result.ticketNumber}</span>
                  <Chip tone={RESULT[result.status].tone}>{RESULT[result.status].label}</Chip>
                  <span className="ml-auto text-right text-sm text-body">
                    {result.status === "confirmed" && result.job?.blockTime
                      ? formatDateTime(result.job.blockTime, true)
                      : result.status === "failed"
                        ? (result.job?.error ?? "Not checked in")
                        : result.decidedAt
                          ? formatDateTime(result.decidedAt, true)
                          : ""}
                    {result.job?.txHash && (
                      <>
                        {" · "}
                        <TxLink hash={result.job.txHash} />
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
