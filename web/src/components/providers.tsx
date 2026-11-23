"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { baseSepolia, hardhat } from "viem/chains";
import { ConfigProvider } from "@/lib/client/config";
import { SessionProvider } from "@/lib/client/session";
import type { PublicConfig } from "@/server/config";

export function Providers({ config, children }: { config: PublicConfig; children: ReactNode }) {
  const chain = config.chainId === hardhat.id ? hardhat : baseSepolia;
  return (
    <ConfigProvider value={config}>
      <PrivyProvider
        appId={config.privyAppId}
        config={{
          loginMethods: ["email"],
          appearance: {
            theme: "light",
            accentColor: "#0e1512",
            logo: "/brand/ticketlock-wordmark.svg",
            landingHeader: "Sign in to TicketLock",
            walletChainType: "ethereum-only",
          },
          // Every account gets one embedded wallet; TicketLock's own buttons are the confirmation.
          embeddedWallets: { ethereum: { createOnLogin: "all-users" }, showWalletUIs: false },
          defaultChain: chain,
          supportedChains: [chain],
        }}
      >
        <SessionProvider>{children}</SessionProvider>
      </PrivyProvider>
    </ConfigProvider>
  );
}
