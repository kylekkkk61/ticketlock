"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, http, type PublicClient } from "viem";
import { HistoryList } from "@/components/proof-panel";
import { AddressLink, Chip, Notice, Row, Working } from "@/components/ui";
import { readEvent, readTicket, readTicketHistory, type EventState, type HistoryEntry, type TicketState } from "@/lib/chain-read";
import { useConfig } from "@/lib/client/config";
import { formatDateTime } from "@/lib/format";

type Result = { ticket: TicketState; event: EventState; history: HistoryEntry[]; blockNumber: number };
type Outcome = { state: "idle"; result: Result } | { state: "missing" | "offline"; result: null };

// Reference client. It talks to a public RPC endpoint from the browser and never calls
// TicketLock's own checkout or admission APIs.
function VerifyInner() {
  const config = useConfig();
  const params = useSearchParams();
  const initial = params.get("token");
  const [input, setInput] = useState(initial ?? "");
  const [result, setResult] = useState<Result | null>(null);
  const [state, setState] = useState<"idle" | "reading" | "missing" | "offline">(initial ? "reading" : "idle");

  const client = useMemo(
    () => createPublicClient({ transport: http(config.publicRpcUrl) }) as PublicClient,
    [config.publicRpcUrl],
  );

  const lookUp = useCallback(
    async (value: string): Promise<Outcome> => {
      const tokenId = Number(value);
      if (!Number.isSafeInteger(tokenId) || tokenId < 1) return { state: "missing", result: null };
      try {
        const chainId = await client.getChainId();
        if (chainId !== config.chainId) throw new Error("wrong chain");
      } catch {
        return { state: "offline", result: null };
      }
      try {
        const ticket = await readTicket(client, config.contract, tokenId);
        const [event, history, blockNumber] = await Promise.all([
          readEvent(client, config.contract, ticket.eventId),
          readTicketHistory(client, config.contract, tokenId),
          client.getBlockNumber(),
        ]);
        return { state: "idle", result: { ticket, event, history, blockNumber: Number(blockNumber) } };
      } catch {
        return { state: "missing", result: null };
      }
    },
    [client, config.chainId, config.contract],
  );

  const show = (outcome: Outcome) => {
    setResult(outcome.result);
    setState(outcome.state);
  };

  // A link from a ticket's proof panel opens the verifier with the token already read.
  useEffect(() => {
    if (!initial) return;
    let cancelled = false;
    void lookUp(initial).then((outcome) => !cancelled && show(outcome));
    return () => {
      cancelled = true;
    };
  }, [initial, lookUp]);

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
      <p className="eyebrow text-accent-deep">Reference client · read only</p>
      <h1 className="mt-1 text-4xl font-extrabold tracking-tight sm:text-5xl">Independent verifier</h1>
      <p className="mt-3 max-w-2xl text-body">
        This page reads the ticket contract directly from a {config.networkName} RPC endpoint. It does not use
        TicketLock&apos;s accounts, checkout or admission services, so any party can reproduce the same result.
      </p>

      <dl className="mt-6 divide-y divide-line border-y border-line">
        <Row label="Network">{config.networkName} · chain ID {config.chainId}</Row>
        <Row label="Contract"><AddressLink address={config.contract} full /></Row>
        <Row label="RPC endpoint"><span className="mono">{config.publicRpcUrl}</span></Row>
      </dl>

      <form
        className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setState("reading");
          setResult(null);
          void lookUp(input).then(show);
        }}
      >
        <div className="flex-1">
          <label className="eyebrow mb-2 block text-body" htmlFor="token-id">
            Token ID
          </label>
          <input
            id="token-id"
            className="field"
            inputMode="numeric"
            pattern="[0-9]+"
            placeholder="e.g. 1"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            required
          />
        </div>
        <button className="btn btn-dark" disabled={state === "reading"}>
          Read from chain
        </button>
      </form>

      <div className="mt-8">
        {state === "reading" && <Working>Reading the contract</Working>}
        {state === "missing" && <Notice tone="info">No ticket with this token ID exists on the contract.</Notice>}
        {state === "offline" && <Notice>The RPC endpoint did not respond for chain {config.chainId}.</Notice>}
        {result && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-bold tracking-tight">Token #{result.ticket.tokenId}</h2>
              {result.ticket.used ? <Chip tone="used">Used</Chip> : <Chip tone="available">Available</Chip>}
            </div>
            <dl className="mt-4 divide-y divide-line border-y border-line">
              <Row label="Current owner"><AddressLink address={result.ticket.owner} full /></Row>
              <Row label="Event">
                Event #{result.ticket.eventId} · ticket number {result.ticket.ticketNumber}
              </Row>
              <Row label="Use state">
                {result.ticket.used
                  ? "Used · checked in " + formatDateTime(result.ticket.checkedInAt, true)
                  : "Not used · valid for one admission"}
              </Row>
              <Row label="Event organiser"><AddressLink address={result.event.organiser} full /></Row>
              <Row label="Event counts">
                {result.event.mintedCount} issued of {result.event.capacity} · {result.event.checkedInCount} checked in
              </Row>
              <Row label="Read at block">{result.blockNumber.toLocaleString("en-GB")}</Row>
            </dl>
            <p className="eyebrow mb-3 mt-6 text-body">History from contract logs</p>
            <HistoryList history={result.history} />
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}
