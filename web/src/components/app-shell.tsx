"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useConfig } from "@/lib/client/config";
import { useSession } from "@/lib/client/session";
import { Logo } from "./ui";

function useNavItems() {
  const { me } = useSession();
  return [
    { href: "/", label: "Events" },
    { href: "/tickets", label: "My tickets" },
    ...(me?.isOrganiser ? [{ href: "/organiser", label: "Manage event" }] : []),
  ];
}

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const config = useConfig();
  const { status, me, login, logout } = useSession();
  const items = useNavItems();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 bg-ink text-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-5 sm:px-8">
          <Link href="/" aria-label="TicketLock home">
            <Logo />
          </Link>
          {config.network === "local" && (
            <span className="rounded-full bg-[#ffd166] px-2.5 py-0.5 text-xs font-extrabold tracking-wider text-ink">LOCAL</span>
          )}
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Main">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={
                  "rounded-full px-4 py-2 text-[15px] font-semibold " +
                  (isActive(pathname, item.href) ? "bg-white/12 text-white" : "text-white/70 hover:text-white")
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {status === "ready" && me && (
              <>
                <span className="hidden max-w-56 truncate text-sm text-white/70 md:inline">{me.email}</span>
                <button className="btn btn-sm btn-outline-light" onClick={() => void logout()}>
                  Sign out
                </button>
              </>
            )}
            {status === "preparing" && <span className="text-sm text-white/70">Preparing your account…</span>}
            {status === "signedOut" && (
              <button className="btn btn-sm btn-primary" onClick={login}>
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 pb-24 sm:pb-0">{children}</main>

      <footer className="hidden bg-ink text-white/60 sm:block">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-8 py-6 text-sm">
          <span>TicketLock presentation demo · {config.networkName} · no real payments</span>
          <Link href="/verify" className="font-semibold text-white underline decoration-white/30 underline-offset-4">
            Independent verifier
          </Link>
        </div>
      </footer>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas pb-[env(safe-area-inset-bottom)] sm:hidden" aria-label="Main">
        <div className="flex">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={
                "flex-1 border-t-[3px] py-3.5 text-center text-sm font-bold " +
                (isActive(pathname, item.href) ? "border-accent text-ink" : "border-transparent text-body")
              }
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
