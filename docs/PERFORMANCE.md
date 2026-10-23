# Performance and gas

Measured with `npm run bench` (live stack: production build, Hardhat node with automine, SQLite) and `npm run test:gas` (Hardhat gas statistics over the contract tests). Machine: 4-core Intel Xeon @ 2.80 GHz, Node 22.22.0, Linux. The benchmark client, the app server and the chain share these 4 cores. Treat the numbers as a baseline for comparing changes, not as capacity figures. This is a local prototype.

## Verification latency: a finding and its fix

The first benchmark run showed a single verification taking **51 ms** (p50), although the cryptography takes about 3 ms:

| Step (profiled in-process) | Time |
| --- | --- |
| Ed25519 JWS verification | 0.3 ms |
| EIP-712 signature recovery | 2.6 ms |
| did:key resolution and trust policy load | 0.4 ms |
| `eth_blockNumber` | **12.3 ms** |
| Registry read (`getRecord` + `credentialStatus`) | **29.5 ms** |

Almost all of it was waiting on JSON-RPC. ethers' `JsonRpcProvider` holds every request for `batchStallTime` (10 ms by default) to batch it with later ones, and a verification made three dependent round trips: the block number, then the record and status, then `isCredentialValid`. The fix:

- `batchStallTime: 0`. Calls issued in the same tick are still sent as one JSON-RPC batch, without the 10 ms wait.
- `isCredentialValid` is read in the same batch as the record and status, at the same pinned block. That makes two round trips instead of three, and the block consistency is unchanged.

| | p50 | p95 | p99 | verifications/s (1 client) |
| --- | --- | --- | --- | --- |
| Before | 51.2 ms | 59.1 ms | 61.8 ms | 17.5 |
| After | 20.5 ms | 28.2 ms | 31.5 ms | 36.6 |

Revocation, which reads the record before sending, fell from 159 ms to 58 ms. Approval fell from 44 ms to 22 ms (p50).

## Under load (after the fix)

240 presentations per row, each with a fresh single-use challenge and a new EIP-712 proof. Every result was checked for correctness, and a revoked credential was confirmed rejected at the end.

| Concurrency | present p50 | present p95 | verifications/s |
| --- | --- | --- | --- |
| 1 | 20.5 ms | 28.2 ms | 36.6 |
| 8 | 83.8 ms | 105.8 ms | 77.1 |
| 32 | 291.3 ms | 316.6 ms | 85.1 |

Throughput levels off at about 80 verifications/s. That is CPU saturation of the shared machine (client-side signing, the Next.js server and the Hardhat node), not lock contention: latency grows linearly with concurrency and nothing fails. The verifier is stateless apart from the atomic, single-row challenge consumption, so it scales horizontally against one RPC endpoint. A shared challenge store would then be needed in place of the local SQLite file.

## Gas

| Transaction | Paid by | Gas |
| --- | --- | --- |
| `CredentialRegistry` deployment | deployer | 1,761,597 (7,700 bytes of runtime code) |
| `DemoGate` deployment | deployer | 368,938 |
| `register` | holder | ≈133,900 |
| `DemoGate.checkIn` | holder | 64,042 first, 46,942 after |
| `revoke` | issuer | 50,534 |
| `removeIssuer` | admin | 31,538 |
| `isCredentialValid` (view, as `eth_call`) | – | ≈33,300–37,600 |

`register` is the dominant per-credential cost. It writes one storage record (commitment → holder, issuer, schema, window, epoch, timestamps) and verifies an ECDSA signature. On a public L1 at 10 gwei that would be about 0.0013 ETH per credential. **This prototype does not deploy to any public network.** A production design would weigh an L2, batched registration, or no per-credential on-chain record at all (see the privacy-preserving status roadmap in SECURITY.md).
