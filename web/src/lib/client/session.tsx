"use client";

import { usePrivy, useSignTypedData } from "@privy-io/react-auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Address, Hex } from "viem";
import type { CheckInTypedData, TransferTypedData } from "@/lib/permits";

export type Me = { email: string; address: Address; isOrganiser: boolean };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type ApiInit = { method?: "GET" | "POST"; body?: unknown };

type Session = {
  /** loading: SDK starting. preparing: signed in, account and wallet being set up. */
  status: "loading" | "signedOut" | "preparing" | "ready";
  me: Me | null;
  login: () => void;
  logout: () => Promise<void>;
  api: <T>(path: string, init?: ApiInit) => Promise<T>;
  /** Signs with the embedded wallet. Only ever called from an explicit confirmation button. */
  sign: (typedData: TransferTypedData | CheckInTypedData) => Promise<Hex>;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const { signTypedData } = useSignTypedData();
  const [me, setMe] = useState<Me | null>(null);

  const api = useCallback(
    async <T,>(path: string, init: ApiInit = {}): Promise<T> => {
      const token = await getAccessToken();
      const response = await fetch(path, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers: {
          ...(token ? { authorization: "Bearer " + token } : {}),
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new ApiError(
          response.status,
          data?.error?.code ?? "error",
          data?.error?.message ?? "Something went wrong. Please try again.",
        );
      }
      return data as T;
    },
    [getAccessToken],
  );

  // After login, wait until the server can see the verified email and embedded wallet.
  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const sync = async () => {
      try {
        const profile = await api<Me>("/api/session", { method: "POST" });
        if (!cancelled) setMe(profile);
      } catch {
        if (!cancelled) timer = setTimeout(sync, 1500);
      }
    };
    void sync();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, authenticated, api]);

  const value = useMemo<Session>(() => {
    const status = !ready ? "loading" : !authenticated ? "signedOut" : me ? "ready" : "preparing";
    return {
      status,
      me: status === "ready" ? me : null,
      login: () => login(),
      logout: async () => {
        await logout();
        setMe(null);
      },
      api,
      sign: async (typedData) => {
        if (!me) throw new Error("Sign in first.");
        const { signature } = await signTypedData(typedData as never, { address: me.address });
        return signature as Hex;
      },
    };
  }, [ready, authenticated, me, login, logout, api, signTypedData]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("SessionProvider is missing.");
  return session;
}

/** Calls fn now and then every intervalMs while enabled. Overlapping calls are skipped. */
export function usePolling(fn: () => Promise<void>, intervalMs: number, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        await fn();
      } catch {
        // Transient errors are retried on the next tick.
      } finally {
        busy = false;
      }
    };
    void tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [fn, intervalMs, enabled]);
}
