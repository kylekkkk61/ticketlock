"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ProofPanel } from "@/components/proof-panel";
import { TicketVisual } from "@/components/ticket-visual";
import { TransferDialog } from "@/components/transfer-dialog";
import { Chip, SignInPrompt, Working } from "@/components/ui";
import type { HistoryEntry, TicketState } from "@/lib/chain-read";
import { usePolling, useSession } from "@/lib/client/session";
import { formatDateTime } from "@/lib/format";
import type { TicketView } from "@/server/services";

function TicketCard({ ticket, onTransfer }: { ticket: TicketView; onTransfer: () => void }) {
  const { api } = useSession();
  const loadProof = useCallback(
    () => api<{ ticket: TicketState; history: HistoryEntry[] }>("/api/tickets/" + ticket.tokenId + "/history"),
    [api, ticket.tokenId],
  );
  const admitHref = "/admit?eventId=" + ticket.eventId + "&ticket=" + ticket.tokenId;

  return (
    <article className="card overflow-hidden">
      <div className="p-3 pb-0">
        <TicketVisual
          eventId={ticket.eventId}
          ticketNumber={ticket.ticketNumber}
          status={
            ticket.used ? (
              <Chip tone="used" onDark>Used</Chip>
            ) : ticket.pending ? (
              <Chip tone="pending">{ticket.pending.kind === "transfer" ? "Transferring" : "Entry requested"}</Chip>
            ) : (
              <Chip tone="available">Available</Chip>
            )
          }
        />
      </div>
      <div className="p-5">
        {ticket.used ? (
          <p className="text-[15px] text-body">
            Checked in {formatDateTime(ticket.checkedInAt)}. This ticket cannot be transferred or used again.
          </p>
        ) : ticket.pending?.kind === "transfer" ? (
          <Working>Transfer in progress</Working>
        ) : ticket.pending?.kind === "admission" ? (
          <Link href={admitHref} className="btn btn-dark w-full">
            Continue entry
          </Link>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href={"/enter?ticket=" + ticket.tokenId} className="btn btn-primary flex-1">
              Enter event
            </Link>
            <button className="btn btn-outline flex-1" onClick={onTransfer}>
              Transfer ticket
            </button>
          </div>
        )}
      </div>
      <ProofPanel tokenId={ticket.tokenId} load={loadProof} refreshKey={ticket.nonce + ":" + ticket.owner} />
    </article>
  );
}

export default function TicketsPage() {
  const { status, login, api } = useSession();
  const [tickets, setTickets] = useState<TicketView[] | null>(null);
  const [transferring, setTransferring] = useState<TicketView | null>(null);

  const load = useCallback(async () => setTickets(await api<TicketView[]>("/api/tickets")), [api]);
  // Holdings are read from the chain, so a ticket sent by someone else simply appears.
  usePolling(load, tickets?.some((t) => t.pending) ? 2000 : 5000, status === "ready");

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">My tickets</h1>

      <div className="mt-8">
        {status === "signedOut" && (
          <SignInPrompt title="Sign in to see your tickets" body="Your tickets are kept in your TicketLock account." onSignIn={login} />
        )}
        {(status === "loading" || status === "preparing" || (status === "ready" && !tickets)) && (
          <Working>{status === "preparing" ? "Preparing your account" : "Loading your tickets"}</Working>
        )}
        {status === "ready" && tickets?.length === 0 && (
          <div className="card max-w-md p-8">
            <p className="text-xl font-bold">No tickets yet</p>
            <p className="mt-1 text-body">Tickets you buy or receive appear here.</p>
            <Link href="/" className="btn btn-primary mt-6">
              Browse events
            </Link>
          </div>
        )}
        {status === "ready" && tickets && tickets.length > 0 && (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {tickets.map((ticket) => (
              <TicketCard key={ticket.tokenId} ticket={ticket} onTransfer={() => setTransferring(ticket)} />
            ))}
          </div>
        )}
      </div>

      {transferring && (
        <TransferDialog
          ticket={transferring}
          onClose={(changed) => {
            setTransferring(null);
            if (changed) void load();
          }}
        />
      )}
    </div>
  );
}
