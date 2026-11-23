import type { ReactNode } from "react";
import { eventDisplay } from "@/lib/event-info";
import { formatEventDate, formatTime } from "@/lib/format";

/** The dark ticket face shared by the wallet, the entry flow and the verifier. */
export function TicketVisual({
  eventId,
  ticketNumber,
  status,
}: {
  eventId: number;
  ticketNumber: number;
  status: ReactNode;
}) {
  const display = eventDisplay(eventId);
  return (
    <div className="relative overflow-hidden rounded-[12px] bg-ink text-white">
      <div className="p-5 pb-6">
        <div className="flex items-start justify-between gap-3">
          <p className="eyebrow text-accent">
            {formatEventDate(display.startsAt)} · {formatTime(display.startsAt)}
          </p>
          {status}
        </div>
        <p className="mt-4 text-[34px] font-extrabold uppercase leading-[0.95] tracking-[-0.02em]">{display.name}</p>
        <p className="mt-2 text-[15px] text-white/70">
          {display.venue}, {display.city}
        </p>
      </div>
      <div className="relative border-t border-dashed border-white/25">
        <span className="absolute -left-3 -top-3 size-6 rounded-full bg-canvas" />
        <span className="absolute -right-3 -top-3 size-6 rounded-full bg-canvas" />
      </div>
      <div className="flex items-end justify-between p-5 pt-4">
        <div>
          <p className="eyebrow text-white/55">Ticket</p>
          <p className="text-3xl font-extrabold tracking-tight">#{ticketNumber}</p>
        </div>
        <p className="eyebrow text-white/55">{display.admission} · admit one</p>
      </div>
    </div>
  );
}
