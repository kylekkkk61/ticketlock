"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { HistoryEntry, TicketState } from "@/lib/chain-read";
import { useConfig } from "@/lib/client/config";
import { formatDateTime } from "@/lib/format";
import { AddressLink, Row, TxLink } from "./ui";

const TITLES: Record<HistoryEntry["kind"], string> = {
  issued: "Issued",
  transferred: "Transferred",
  checkedIn: "Checked in",
};

export function HistoryList({ history }: { history: HistoryEntry[] }) {
  return (
    <ol className="space-y-3">
      {history.map((entry) => (
        <li key={entry.txHash + entry.kind} className="rounded-[6px] bg-soft p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <p className="font-bold">{TITLES[entry.kind]}</p>
            <p className="text-sm text-body">{formatDateTime(entry.timestamp, true)}</p>
          </div>
          <div className="mt-1 text-sm">
            {entry.kind === "issued" && entry.to && (
              <p>To <AddressLink address={entry.to} /></p>
            )}
            {entry.kind === "transferred" && entry.from && entry.to && (
              <p>
                From <AddressLink address={entry.from} /> to <AddressLink address={entry.to} />
              </p>
            )}
            <p className="mt-1 text-body">
              {entry.kind === "issued" ? "Issuer" : entry.kind === "checkedIn" ? "Signed by holder and organiser" : "Signed by holder"}:{" "}
              {entry.authorisedBy.map((address, index) => (
                <span key={address}>
                  {index > 0 && " and "}
                  <AddressLink address={address} />
                </span>
              ))}
            </p>
            <p className="text-body">
              Sent and gas paid by relayer: <AddressLink address={entry.relayer} />
            </p>
            <p className="mt-1">
              Transaction <TxLink hash={entry.txHash} />
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

type Proof = { ticket: TicketState; history: HistoryEntry[] };

/** Collapsible evidence for one ticket. Everything shown is read from the chain. */
export function ProofPanel({ tokenId, load, refreshKey }: { tokenId: number; load: () => Promise<Proof>; refreshKey: string }) {
  const config = useConfig();
  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState<Proof | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    load()
      .then((result) => !cancelled && (setProof(result), setFailed(false)))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
    // refreshKey changes when the ticket's on-chain state changes.
  }, [open, load, refreshKey]);

  return (
    <details className="border-t border-line" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
        On-chain proof
        <span className="text-xl leading-none text-body">{open ? "−" : "+"}</span>
      </summary>
      <div className="px-5 pb-5">
        {failed && <p className="text-sm text-danger">The network did not respond. Close and reopen to retry.</p>}
        {!proof && !failed && <p className="text-sm text-body">Reading the contract…</p>}
        {proof && (
          <>
            <dl className="divide-y divide-line border-y border-line">
              <Row label="Network">{config.networkName} · chain ID {config.chainId}</Row>
              <Row label="Contract"><AddressLink address={config.contract} full /></Row>
              <Row label="Token ID">#{tokenId}</Row>
              <Row label="Owner"><AddressLink address={proof.ticket.owner} full /></Row>
              <Row label="State">
                {proof.ticket.used ? "Used · " + formatDateTime(proof.ticket.checkedInAt, true) : "Available"}
              </Row>
            </dl>
            <p className="eyebrow mb-3 mt-5 text-body">History</p>
            <HistoryList history={proof.history} />
            <Link href={"/verify?token=" + tokenId} className="mt-4 inline-block text-sm font-semibold underline underline-offset-4">
              Check this ticket in the independent verifier
            </Link>
          </>
        )}
      </div>
    </details>
  );
}
