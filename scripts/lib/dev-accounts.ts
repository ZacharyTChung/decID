import { HDNodeWallet, Mnemonic, type Provider } from "ethers";

/**
 * LOCAL DEVELOPMENT ACCOUNTS ONLY.
 *
 * These are derived from Hardhat's well-known public test mnemonic. Their
 * private keys are published in Hardhat's documentation and printed by
 * `hardhat node`, so they must never hold real funds or be used on any public
 * network. The app never asks for a seed phrase or private key: browser users
 * sign with their own injected wallet (EIP-1193). Only these headless scripts
 * use the keys directly.
 */
export const HARDHAT_TEST_MNEMONIC = "test test test test test test test test test test test junk";

export const DEV_ROLES = {
  deployer: 0, // registry admin
  issuerOperator: 1, // signs in to the issuer console
  holder: 2,
  otherHolder: 3, // used as an attacker / second holder in tests and the demo
} as const;

export function devWallet(index: number, provider?: Provider): HDNodeWallet {
  const w = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(HARDHAT_TEST_MNEMONIC), `m/44'/60'/0'/0/${index}`);
  return provider ? w.connect(provider) : w;
}
