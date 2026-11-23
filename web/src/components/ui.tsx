"use client";

import { useEffect, type ReactNode } from "react";
import { addressUrl, txUrl, useConfig } from "@/lib/client/config";
import { shortAddress, shortHash } from "@/lib/format";

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="11" fill="#20e3a2" />
      <path
        fill="#0e1512"
        d="M12 14h24a3 3 0 0 1 3 3v3.5a3.5 3.5 0 0 0 0 7V31a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3v-3.5a3.5 3.5 0 0 0 0-7V17a3 3 0 0 1 3-3z"
      />
      <circle cx="24" cy="22.2" r="3.3" fill="#20e3a2" />
      <path fill="#20e3a2" d="M22.3 24h3.4l1.1 6h-5.6z" />
    </svg>
  );
}

export function Logo({ tone = "light" }: { tone?: "light" | "dark" }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={30} />
      <span className={"text-[19px] font-extrabold tracking-tight " + (tone === "light" ? "text-white" : "text-ink")}>
        TicketLock
      </span>
    </span>
  );
}

type Tone = "available" | "used" | "pending" | "danger" | "neutral";
const CHIP: Record<Tone, string> = {
  available: "bg-accent text-ink",
  used: "bg-soft text-body",
  pending: "bg-[#fff4d6] text-warn",
  danger: "bg-[#fde9e5] text-danger",
  neutral: "bg-soft text-ink",
};

export function Chip({ tone, children, onDark = false }: { tone: Tone; children: ReactNode; onDark?: boolean }) {
  const style = onDark && tone === "used" ? "bg-white/15 text-white" : CHIP[tone];
  return (
    <span className={"inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-bold " + style}>
      {tone === "pending" && <span className="pulse-dot size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Working({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-base font-semibold" role="status">
      <span className="pulse-dot size-2.5 rounded-full bg-accent-deep" />
      {children}
    </span>
  );
}

export function Notice({ tone = "danger", children }: { tone?: "danger" | "info"; children: ReactNode }) {
  return (
    <p
      role={tone === "danger" ? "alert" : "status"}
      className={
        "rounded-[6px] border px-4 py-3 text-[15px] leading-snug " +
        (tone === "danger" ? "border-danger/40 bg-[#fde9e5] text-danger" : "border-line bg-soft text-ink")
      }
    >
      {children}
    </p>
  );
}

export function TxLink({ hash }: { hash: string }) {
  const url = txUrl(useConfig(), hash);
  if (!url) return <span className="mono whitespace-nowrap" title={hash}>{shortHash(hash)}</span>;
  return (
    <a className="mono whitespace-nowrap underline decoration-line underline-offset-4 hover:decoration-ink" href={url} target="_blank" rel="noreferrer">
      {shortHash(hash)} ↗
    </a>
  );
}

export function AddressLink({ address, full = false }: { address: string; full?: boolean }) {
  const url = addressUrl(useConfig(), address);
  const label = full ? address : shortAddress(address);
  const style = "mono" + (full ? "" : " whitespace-nowrap");
  if (!url) return <span className={style}>{label}</span>;
  return (
    <a className={style + " underline decoration-line underline-offset-4 hover:decoration-ink"} href={url} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/70 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[16px] bg-canvas p-6 sm:max-w-md sm:rounded-[12px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
          <button className="-mr-2 -mt-1 grid size-10 place-items-center rounded-full text-2xl leading-none hover:bg-soft" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SignInPrompt({ title, body, onSignIn }: { title: string; body: string; onSignIn: () => void }) {
  return (
    <div className="card mx-auto max-w-md p-8 text-center">
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
      <p className="mt-2 text-body">{body}</p>
      <button className="btn btn-primary mt-6 w-full" onClick={onSignIn}>
        Sign in with email
      </button>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="eyebrow w-36 shrink-0 text-body">{label}</dt>
      <dd className="min-w-0 text-[15px]">{children}</dd>
    </div>
  );
}
