"use client";

import { createContext, useContext } from "react";
import type { PublicConfig } from "@/server/config";

const ConfigContext = createContext<PublicConfig | null>(null);
export const ConfigProvider = ConfigContext.Provider;

export function useConfig(): PublicConfig {
  const config = useContext(ConfigContext);
  if (!config) throw new Error("ConfigProvider is missing.");
  return config;
}

export const txUrl = (config: PublicConfig, hash: string) =>
  config.explorerUrl ? config.explorerUrl + "/tx/" + hash : null;
export const addressUrl = (config: PublicConfig, address: string) =>
  config.explorerUrl ? config.explorerUrl + "/address/" + address : null;
