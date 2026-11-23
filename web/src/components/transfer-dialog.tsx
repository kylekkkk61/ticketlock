"use client";

import { useCallback, useState } from "react";
import { useConfig } from "@/lib/client/config";
import { usePolling, useSession } from "@/lib/client/session";
import type { TransferTypedData } from "@/lib/permits";
import type { JobView } from "@/server/jobs";
import type { TicketView } from "@/server/services";
import { AddressLink, Chip, Modal, Notice, TxLink, Working } from "./ui";

type Prepared = { typedData: TransferTypedData; recipient: { email: string; address: string } };

export function TransferDialog({ ticket, onClose }: { ticket: TicketView; onClose: (changed: boolean) => void }) {
  const { api, sign } = useSession();
  const { confirmedLabel } = useConfig();
  const [email, setEmail] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const lookUp = () =>
    run(async () => {
      setPrepared(
        await api<Prepared>("/api/transfers/prepare", { body: { tokenId: ticket.tokenId, recipientEmail: email } }),
      );
    });

  // The signature is created here, by this button press, for exactly the recipient shown.
  const confirm = () =>
    run(async () => {
      if (!prepared) return;
      const signature = await sign(prepared.typedData);
      setJob(await api<JobView>("/api/transfers", { body: { permit: prepared.typedData.message, signature } }));
    });

  const jobId = job?.id;
  const poll = useCallback(async () => {
    if (jobId) setJob(await api<JobView>("/api/jobs/" + jobId));
  }, [jobId, api]);
  usePolling(poll, 2000, job?.status === "processing");

  const close = () => onClose(job !== null);

  return (
    <Modal title="Transfer ticket" onClose={close}>
      {!prepared && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void lookUp();
          }}
        >
          <p className="text-body">Send Ticket #{ticket.ticketNumber} to another TicketLock account.</p>
          <label className="eyebrow mb-2 mt-5 block text-body" htmlFor="recipient-email">
            Recipient email
          </label>
          <input
            id="recipient-email"
            className="field"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            placeholder="name@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoFocus
          />
          {error && <div className="mt-4"><Notice>{error}</Notice></div>}
          <button className="btn btn-dark mt-6 w-full" disabled={busy || !email}>
            {busy ? "Looking up account…" : "Continue"}
          </button>
        </form>
      )}

      {prepared && !job && (
        <div>
          <dl className="divide-y divide-line rounded-[6px] border border-line px-4">
            <div className="py-3">
              <dt className="eyebrow text-body">Ticket</dt>
              <dd className="mt-0.5 text-lg font-bold">#{ticket.ticketNumber}</dd>
            </div>
            <div className="py-3">
              <dt className="eyebrow text-body">Recipient</dt>
              <dd className="mt-0.5 break-all text-lg font-bold">{prepared.recipient.email}</dd>
              <dd className="mt-0.5 text-sm text-body">
                Account <AddressLink address={prepared.recipient.address} />
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-body">
            The ticket leaves your account as soon as the network confirms. A completed transfer cannot be undone by
            TicketLock.
          </p>
          {error && <div className="mt-4"><Notice>{error}</Notice></div>}
          <div className="mt-6 flex flex-col gap-3">
            <button className="btn btn-primary w-full" onClick={confirm} disabled={busy}>
              {busy ? "Confirming…" : "Confirm transfer"}
            </button>
            <button className="btn btn-outline w-full" onClick={() => (setPrepared(null), setError(null))} disabled={busy}>
              Change recipient
            </button>
          </div>
        </div>
      )}

      {job && prepared && (
        <div>
          {job.status === "processing" && (
            <>
              <Working>Transferring your ticket</Working>
              <p className="mt-2 text-sm text-body">Waiting for the network to confirm. You can close this window.</p>
            </>
          )}
          {job.status === "confirmed" && (
            <>
              <Chip tone="available">{confirmedLabel}</Chip>
              <p className="mt-3 text-xl font-bold">Ticket #{ticket.ticketNumber} now belongs to {prepared.recipient.email}.</p>
            </>
          )}
          {job.status === "failed" && (
            <Notice>{job.error ?? "The transfer failed."} The ticket is still in your account.</Notice>
          )}
          {job.txHash && (
            <p className="mt-3 text-sm text-body">
              Transaction <TxLink hash={job.txHash} />
            </p>
          )}
          <button className="btn btn-dark mt-6 w-full" onClick={close}>
            {job.status === "processing" ? "Close" : "Done"}
          </button>
        </div>
      )}
    </Modal>
  );
}
