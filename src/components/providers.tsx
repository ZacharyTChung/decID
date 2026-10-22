"use client";

import { BrowserProvider, JsonRpcProvider, getAddress, type Eip1193Provider, type JsonRpcSigner } from "ethers";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PublicConfigResponse } from "@/lib/shared/api";
import type { HolderBundle } from "@/lib/shared/bundle";
import { api } from "@/lib/client/api";

/**
 * Client-side state shared by the three role views:
 *  - app config (public deployment info from GET /api/config, never secrets);
 *  - the injected EIP-1193 wallet (address, chain, listeners);
 *  - the server session (SIWE). It is dropped whenever the wallet account or chain changes;
 *  - the holder's credential bundle, kept IN MEMORY ONLY. A page reload forgets
 *    it, and the holder keeps it across reloads with the encrypted export.
 */

type InjectedProvider = Eip1193Provider & {
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}

export interface Session {
  address: string;
  chainId: number;
  role: "holder" | "issuer";
  expiresAt: number;
}

interface AppState {
  config?: PublicConfigResponse;
  configError?: string;
  // wallet
  walletAvailable: boolean;
  address?: string;
  chainId?: number;
  onExpectedChain: boolean;
  connect(): Promise<void>;
  switchToLocalChain(): Promise<void>;
  signer(): Promise<JsonRpcSigner>;
  readProvider(): BrowserProvider | JsonRpcProvider;
  // session
  session?: Session | null;
  refreshSession(): Promise<void>;
  signIn(role: "holder" | "issuer"): Promise<void>;
  signOut(): Promise<void>;
  // holder bundle (memory only)
  bundle?: HolderBundle;
  setBundle(b: HolderBundle | undefined): void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProviders");
  return v;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfigResponse>();
  const [configError, setConfigError] = useState<string>();
  const [walletAvailable, setWalletAvailable] = useState(false);
  const [address, setAddress] = useState<string>();
  const [chainId, setChainId] = useState<number>();
  const [session, setSession] = useState<Session | null>();
  const [bundle, setBundle] = useState<HolderBundle>();
  const identity = useRef<string>("");

  useEffect(() => {
    api<PublicConfigResponse>("GET", "/api/config")
      .then(setConfig)
      .catch((e: Error) => setConfigError(e.message));
  }, []);

  const refreshSession = useCallback(async () => {
    const r = await api<{ session: Session | null }>("GET", "/api/auth/session").catch(() => ({ session: null }));
    setSession(r.session);
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  // A change from one connected account/chain to another invalidates the server session (it was bound
  // to the old identity). Going from "not connected" to connected is not a change of identity.
  const onIdentityChange = useCallback(
    (nextAddress?: string, nextChain?: number) => {
      const key = nextAddress ? `${nextAddress}:${nextChain ?? ""}` : "";
      if (identity.current && identity.current !== key) {
        void api("POST", "/api/auth/logout", {}).finally(() => setSession(null));
      }
      if (key) identity.current = key;
      else if (identity.current) identity.current = "";
    },
    [],
  );

  // A session cookie left over from another wallet or chain (e.g. switched while the tab was closed) is ended.
  useEffect(() => {
    if (session && address && chainId !== undefined && (session.address !== address || session.chainId !== chainId)) {
      void api("POST", "/api/auth/logout", {}).finally(() => setSession(null));
    }
  }, [session, address, chainId]);

  useEffect(() => {
    const eth = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!eth) return;
    setWalletAvailable(true);
    let addr: string | undefined;
    let chain: number | undefined;
    const update = () => {
      setAddress(addr);
      setChainId(chain);
      onIdentityChange(addr, chain);
    };
    void Promise.all([eth.request({ method: "eth_accounts" }), eth.request({ method: "eth_chainId" })])
      .then(([accounts, cid]) => {
        const list = accounts as string[];
        addr = list[0] ? getAddress(list[0]) : undefined;
        chain = Number(cid);
        update();
      })
      .catch(() => undefined);
    const onAccounts = (...args: unknown[]) => {
      const list = (args[0] as string[]) ?? [];
      addr = list[0] ? getAddress(list[0]) : undefined;
      update();
    };
    const onChain = (...args: unknown[]) => {
      chain = Number(args[0] as string);
      update();
    };
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [onIdentityChange]);

  const connect = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) throw new Error("No injected wallet found. Install a browser wallet (e.g. MetaMask) or use the headless demo.");
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    setAddress(accounts[0] ? getAddress(accounts[0]) : undefined);
    setChainId(Number(await eth.request({ method: "eth_chainId" })));
  }, []);

  const switchToLocalChain = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth || !config) return;
    const hexId = "0x" + config.chainId.toString(16);
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    } catch (err) {
      if ((err as { code?: number }).code !== 4902) throw err;
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hexId,
            chainName: `Hardhat Local (${config.chainId})`,
            rpcUrls: [config.rpcUrl],
            nativeCurrency: { name: "Local test ETH", symbol: "ETH", decimals: 18 },
          },
        ],
      });
    }
  }, [config]);

  const signer = useCallback(async () => {
    if (!window.ethereum) throw new Error("No injected wallet found.");
    // "any" lets ethers follow chain switches instead of caching a stale network.
    const provider = new BrowserProvider(window.ethereum, "any");
    return provider.getSigner(address);
  }, [address]);

  const readProvider = useCallback(() => {
    if (window.ethereum && chainId === config?.chainId) return new BrowserProvider(window.ethereum, "any");
    return new JsonRpcProvider(config?.rpcUrl ?? "http://127.0.0.1:8545", undefined, { staticNetwork: true });
  }, [chainId, config]);

  const signIn = useCallback(
    async (role: "holder" | "issuer") => {
      if (!address || chainId === undefined) throw new Error("Connect your wallet first.");
      const { message } = await api<{ message: string }>("POST", "/api/auth/challenge", { address, chainId, role });
      const s = await signer();
      const signature = await s.signMessage(message);
      const r = await api<{ session: Session }>("POST", "/api/auth/verify", { message, signature });
      setSession(r.session);
    },
    [address, chainId, signer],
  );

  const signOut = useCallback(async () => {
    await api("POST", "/api/auth/logout", {});
    setSession(null);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      config,
      configError,
      walletAvailable,
      address,
      chainId,
      onExpectedChain: !!config && chainId === config.chainId,
      connect,
      switchToLocalChain,
      signer,
      readProvider,
      session,
      refreshSession,
      signIn,
      signOut,
      bundle,
      setBundle,
    }),
    [config, configError, walletAvailable, address, chainId, connect, switchToLocalChain, signer, readProvider, session, refreshSession, signIn, signOut, bundle],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
