import { expect } from "chai";
import { network } from "hardhat";
import { Signature, keccak256, toUtf8Bytes, zeroPadValue, type Signer } from "ethers";
import { COMMITMENT_DOMAIN, SCHEMA_ID } from "../../src/lib/shared/constants";
import { REGISTRATION_TYPES, registryDomain, type RegistrationAuthorization } from "../../src/lib/shared/eip712";
import { commitmentFor } from "../../src/lib/shared/commitment";

const { ethers, networkHelpers } = await network.create();
const { time, loadFixture } = networkHelpers;

// Status enum mirrored from CredentialRegistry.Status.
const Status = { None: 0n, Active: 1n, Revoked: 2n, IssuerInactive: 3n, NotYetValid: 4n, Expired: 5n };
const DAY = 86_400;
const OTHER_SCHEMA = keccak256(toUtf8Bytes("https://did-mvp.invalid/schemas/other/v1.json"));
const SECP256K1_N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

let commitmentCounter = 0;
function freshCommitment(): string {
  commitmentCounter += 1;
  return keccak256(toUtf8Bytes(`test-commitment-${commitmentCounter}-${Date.now()}`));
}

async function fixture() {
  const [admin, issuer, holder, other, rogueIssuer, secondIssuer] = await ethers.getSigners();
  const registry = await ethers.deployContract("CredentialRegistry", [admin!.address]);
  const gate = await ethers.deployContract("DemoGate", [await registry.getAddress(), SCHEMA_ID]);
  await registry.connect(admin!).addIssuer(issuer!.address);
  await registry.connect(admin!).addIssuer(secondIssuer!.address);
  const chainId = (await ethers.provider.getNetwork()).chainId;
  return { registry, gate, admin: admin!, issuer: issuer!, holder: holder!, other: other!, rogueIssuer: rogueIssuer!, secondIssuer: secondIssuer!, chainId };
}

type Ctx = Awaited<ReturnType<typeof fixture>>;

async function makeAuth(ctx: Ctx, overrides: Partial<RegistrationAuthorization> = {}): Promise<RegistrationAuthorization> {
  const now = await time.latest();
  const [, epoch] = await ctx.registry.issuerState(overrides.issuer ?? ctx.issuer.address);
  return {
    commitment: freshCommitment(),
    holder: ctx.holder.address,
    issuer: ctx.issuer.address,
    schemaId: SCHEMA_ID,
    validFrom: now,
    expiresAt: now + 365 * DAY,
    issuerEpoch: Number(epoch),
    deadline: now + DAY,
    ...overrides,
  };
}

async function sign(ctx: Ctx, auth: RegistrationAuthorization, signer: Signer = ctx.issuer, domainOverride?: { chainId?: bigint; registry?: string }) {
  const domain = registryDomain(domainOverride?.chainId ?? ctx.chainId, domainOverride?.registry ?? (await ctx.registry.getAddress()));
  return signer.signTypedData(domain, REGISTRATION_TYPES, auth);
}

async function registered(ctx: Ctx, overrides: Partial<RegistrationAuthorization> = {}) {
  const auth = await makeAuth(ctx, overrides);
  const sig = await sign(ctx, auth);
  const holderSigner = auth.holder === ctx.other.address ? ctx.other : ctx.holder;
  await ctx.registry.connect(holderSigner).register(auth, sig);
  return auth;
}

describe("CredentialRegistry", () => {
  describe("constants", () => {
    it("exposes the same commitment domain separator as the off-chain code", async () => {
      const { registry } = await loadFixture(fixture);
      expect(await registry.COMMITMENT_DOMAIN()).to.equal(COMMITMENT_DOMAIN);
    });

    it("computes the same EIP-712 struct hash and domain as ethers", async () => {
      const ctx = await loadFixture(fixture);
      const auth = await makeAuth(ctx);
      const expected = ethers.TypedDataEncoder.hashStruct("RegistrationAuthorization", REGISTRATION_TYPES, auth);
      expect(await ctx.registry.hashAuthorization(auth)).to.equal(expected);
      expect(await ctx.registry.domainSeparator()).to.equal(
        ethers.TypedDataEncoder.hashDomain(registryDomain(ctx.chainId, await ctx.registry.getAddress())),
      );
    });
  });

  describe("admin and issuer management", () => {
    it("rejects issuer management and admin revocation by non-admins", async () => {
      const ctx = await loadFixture(fixture);
      const role = await ctx.registry.DEFAULT_ADMIN_ROLE();
      await expect(ctx.registry.connect(ctx.other).addIssuer(ctx.rogueIssuer.address))
        .to.be.revertedWithCustomError(ctx.registry, "AccessControlUnauthorizedAccount")
        .withArgs(ctx.other.address, role);
      await expect(ctx.registry.connect(ctx.issuer).removeIssuer(ctx.issuer.address))
        .to.be.revertedWithCustomError(ctx.registry, "AccessControlUnauthorizedAccount");
      const auth = await registered(ctx);
      await expect(ctx.registry.connect(ctx.issuer).adminRevoke(auth.commitment))
        .to.be.revertedWithCustomError(ctx.registry, "AccessControlUnauthorizedAccount");
    });

    it("rejects zero/duplicate issuer additions and removing an inactive issuer", async () => {
      const ctx = await loadFixture(fixture);
      await expect(ctx.registry.addIssuer(ethers.ZeroAddress)).to.be.revertedWithCustomError(ctx.registry, "ZeroAddress");
      await expect(ctx.registry.addIssuer(ctx.issuer.address)).to.be.revertedWithCustomError(ctx.registry, "IssuerAlreadyActive");
      await expect(ctx.registry.removeIssuer(ctx.rogueIssuer.address)).to.be.revertedWithCustomError(ctx.registry, "IssuerNotActive");
    });
  });

  describe("registration", () => {
    it("registers an authorized credential, emits a minimal event and gates access", async () => {
      const ctx = await loadFixture(fixture);
      const auth = await makeAuth(ctx);
      const sig = await sign(ctx, auth);
      await expect(ctx.registry.connect(ctx.holder).register(auth, sig))
        .to.emit(ctx.registry, "CredentialRegistered")
        .withArgs(auth.commitment, auth.holder, auth.issuer, auth.schemaId, auth.validFrom, auth.expiresAt);

      expect(await ctx.registry.credentialStatus(auth.commitment)).to.equal(Status.Active);
      expect(await ctx.registry.isCredentialValid(auth.commitment, ctx.holder.address, SCHEMA_ID)).to.equal(true);
      const rec = await ctx.registry.getRecord(auth.commitment);
      expect(rec.holder).to.equal(ctx.holder.address);
      expect(rec.issuer).to.equal(ctx.issuer.address);
      expect(rec.revoked).to.equal(false);

      await expect(ctx.gate.connect(ctx.holder).checkIn(auth.commitment))
        .to.emit(ctx.gate, "MemberCheckedIn")
        .withArgs(ctx.holder.address, auth.commitment, 1n);
      expect(await ctx.gate.checkIns(ctx.holder.address)).to.equal(1n);
    });

    it("rejects registration submitted by anyone other than the authorized holder", async () => {
      const ctx = await loadFixture(fixture);
      const auth = await makeAuth(ctx);
      const sig = await sign(ctx, auth);
      await expect(ctx.registry.connect(ctx.other).register(auth, sig))
        .to.be.revertedWithCustomError(ctx.registry, "SenderNotHolder")
        .withArgs(ctx.other.address, ctx.holder.address);
    });

    it("rejects authorizations from an address that was never authorized as issuer", async () => {
      const ctx = await loadFixture(fixture);
      const auth = await makeAuth(ctx, { issuer: ctx.rogueIssuer.address });
      const sig = await sign(ctx, auth, ctx.rogueIssuer);
      await expect(ctx.registry.connect(ctx.holder).register(auth, sig))
        .to.be.revertedWithCustomError(ctx.registry, "IssuerNotActive")
        .withArgs(ctx.rogueIssuer.address);
    });

    it("rejects a trusted issuer address signed by a different key", async () => {
      const ctx = await loadFixture(fixture);
      const auth = await makeAuth(ctx);
      const sig = await sign(ctx, auth, ctx.rogueIssuer);
      await expect(ctx.registry.connect(ctx.holder).register(auth, sig))
        .to.be.revertedWithCustomError(ctx.registry, "SignerNotIssuer")
        .withArgs(ctx.rogueIssuer.address, ctx.issuer.address);
    });

    for (const [field, mutate] of [
      ["commitment", (a: RegistrationAuthorization, c: Ctx) => ({ ...a, commitment: freshCommitment() })],
      ["holder", (a: RegistrationAuthorization, c: Ctx) => ({ ...a, holder: c.other.address })],
      ["issuer", (a: RegistrationAuthorization, c: Ctx) => ({ ...a, issuer: c.secondIssuer.address })],
      ["schemaId", (a: RegistrationAuthorization) => ({ ...a, schemaId: OTHER_SCHEMA })],
      ["validFrom", (a: RegistrationAuthorization) => ({ ...a, validFrom: a.validFrom - 1 })],
      ["expiresAt", (a: RegistrationAuthorization) => ({ ...a, expiresAt: a.expiresAt + DAY })],
      ["deadline", (a: RegistrationAuthorization) => ({ ...a, deadline: a.deadline + DAY })],
    ] as const) {
      it(`rejects an authorization whose signed ${field} was altered`, async () => {
        const ctx = await loadFixture(fixture);
        const auth = await makeAuth(ctx);
        const sig = await sign(ctx, auth);
        const altered = mutate(auth, ctx);
        const sender = altered.holder === ctx.other.address ? ctx.other : ctx.holder;
        await expect(ctx.registry.connect(sender).register(altered, sig)).to.be.revertedWithCustomError(ctx.registry, "SignerNotIssuer");
      });
    }

    it("rejects signatures over the wrong EIP-712 chain id or registry address", async () => {
      const ctx = await loadFixture(fixture);
      const auth = await makeAuth(ctx);
      const wrongChain = await sign(ctx, auth, ctx.issuer, { chainId: 1n });
      await expect(ctx.registry.connect(ctx.holder).register(auth, wrongChain)).to.be.revertedWithCustomError(ctx.registry, "SignerNotIssuer");
      const otherRegistry = await ethers.deployContract("CredentialRegistry", [ctx.admin.address]);
      const wrongContract = await sign(ctx, auth, ctx.issuer, { registry: await otherRegistry.getAddress() });
      await expect(ctx.registry.connect(ctx.holder).register(auth, wrongContract)).to.be.revertedWithCustomError(ctx.registry, "SignerNotIssuer");
    });

    it("rejects malformed and malleable (high-s) signatures via OpenZeppelin ECDSA", async () => {
      const ctx = await loadFixture(fixture);
      const auth = await makeAuth(ctx);
      const sig = Signature.from(await sign(ctx, auth));

      const highS = zeroPadValue(ethers.toBeHex(SECP256K1_N - BigInt(sig.s)), 32);
      const malleable = ethers.concat([sig.r, highS, ethers.toBeHex(sig.v === 27 ? 28 : 27)]);
      await expect(ctx.registry.connect(ctx.holder).register(auth, malleable)).to.be.revertedWithCustomError(ctx.registry, "ECDSAInvalidSignatureS");

      await expect(ctx.registry.connect(ctx.holder).register(auth, sig.compactSerialized)).to.be.revertedWithCustomError(
        ctx.registry,
        "ECDSAInvalidSignatureLength",
      );

      const badV = ethers.concat([sig.r, sig.s, "0x05"]);
      await expect(ctx.registry.connect(ctx.holder).register(auth, badV)).to.be.revertedWithCustomError(ctx.registry, "ECDSAInvalidSignature");

      // The canonical signature still works afterwards.
      await expect(ctx.registry.connect(ctx.holder).register(auth, sig.serialized)).to.emit(ctx.registry, "CredentialRegistered");
    });

    it("enforces the submission deadline, inclusive of the deadline second", async () => {
      const ctx = await loadFixture(fixture);
      const now = await time.latest();
      const onTime = await makeAuth(ctx, { deadline: now + 100 });
      await time.setNextBlockTimestamp(now + 100);
      await expect(ctx.registry.connect(ctx.holder).register(onTime, await sign(ctx, onTime))).to.emit(ctx.registry, "CredentialRegistered");

      const late = await makeAuth(ctx, { deadline: now + 200 });
      const lateSig = await sign(ctx, late);
      await time.setNextBlockTimestamp(now + 201);
      await expect(ctx.registry.connect(ctx.holder).register(late, lateSig))
        .to.be.revertedWithCustomError(ctx.registry, "AuthorizationExpired")
        .withArgs(now + 200);
    });

    it("rejects replay: a commitment can be registered only once", async () => {
      const ctx = await loadFixture(fixture);
      const auth = await makeAuth(ctx);
      const sig = await sign(ctx, auth);
      await ctx.registry.connect(ctx.holder).register(auth, sig);
      await expect(ctx.registry.connect(ctx.holder).register(auth, sig))
        .to.be.revertedWithCustomError(ctx.registry, "AlreadyRegistered")
        .withArgs(auth.commitment);
    });

    it("rejects invalid validity windows, already-expired credentials and zero values", async () => {
      const ctx = await loadFixture(fixture);
      const now = await time.latest();
      const inverted = await makeAuth(ctx, { validFrom: now + 10, expiresAt: now + 10 });
      await expect(ctx.registry.connect(ctx.holder).register(inverted, await sign(ctx, inverted)))
        .to.be.revertedWithCustomError(ctx.registry, "InvalidValidityWindow");

      const expired = await makeAuth(ctx, { validFrom: now - 100, expiresAt: now - 10 });
      await expect(ctx.registry.connect(ctx.holder).register(expired, await sign(ctx, expired)))
        .to.be.revertedWithCustomError(ctx.registry, "CredentialAlreadyExpired");

      const zero = await makeAuth(ctx, { commitment: ethers.ZeroHash });
      await expect(ctx.registry.connect(ctx.holder).register(zero, await sign(ctx, zero))).to.be.revertedWithCustomError(ctx.registry, "ZeroCommitment");
    });
  });

  describe("validity and gate enforcement", () => {
    it("treats a nonexistent record as invalid everywhere", async () => {
      const ctx = await loadFixture(fixture);
      const missing = freshCommitment();
      expect(await ctx.registry.credentialStatus(missing)).to.equal(Status.None);
      expect(await ctx.registry.isCredentialValid(missing, ctx.holder.address, SCHEMA_ID)).to.equal(false);
      expect(await ctx.registry.isCredentialValid(missing, ethers.ZeroAddress, ethers.ZeroHash)).to.equal(false);
      await expect(ctx.gate.connect(ctx.holder).checkIn(missing))
        .to.be.revertedWithCustomError(ctx.gate, "AccessDenied")
        .withArgs(Status.None, false);
    });

    it("rejects a different wallet using someone else's valid credential", async () => {
      const ctx = await loadFixture(fixture);
      const auth = await registered(ctx);
      expect(await ctx.registry.isCredentialValid(auth.commitment, ctx.other.address, SCHEMA_ID)).to.equal(false);
      await expect(ctx.gate.connect(ctx.other).checkIn(auth.commitment))
        .to.be.revertedWithCustomError(ctx.gate, "AccessDenied")
        .withArgs(Status.Active, true);
    });

    it("rejects a valid credential of the wrong schema at the gate", async () => {
      const ctx = await loadFixture(fixture);
      const auth = await registered(ctx, { schemaId: OTHER_SCHEMA });
      expect(await ctx.registry.isCredentialValid(auth.commitment, ctx.holder.address, OTHER_SCHEMA)).to.equal(true);
      expect(await ctx.registry.isCredentialValid(auth.commitment, ctx.holder.address, SCHEMA_ID)).to.equal(false);
      await expect(ctx.gate.connect(ctx.holder).checkIn(auth.commitment))
        .to.be.revertedWithCustomError(ctx.gate, "AccessDenied")
        .withArgs(Status.Active, true);
    });

    it("enforces validFrom and expiresAt at the exact boundaries", async () => {
      const ctx = await loadFixture(fixture);
      const now = await time.latest();
      const validFrom = now + 1000;
      const expiresAt = now + 2000;
      const auth = await registered(ctx, { validFrom, expiresAt });
      expect(await ctx.registry.credentialStatus(auth.commitment)).to.equal(Status.NotYetValid);

      await time.setNextBlockTimestamp(validFrom - 1);
      await expect(ctx.gate.connect(ctx.holder).checkIn(auth.commitment))
        .to.be.revertedWithCustomError(ctx.gate, "AccessDenied")
        .withArgs(Status.NotYetValid, false);

      await time.setNextBlockTimestamp(validFrom);
      await expect(ctx.gate.connect(ctx.holder).checkIn(auth.commitment)).to.emit(ctx.gate, "MemberCheckedIn");

      await time.setNextBlockTimestamp(expiresAt - 1);
      await expect(ctx.gate.connect(ctx.holder).checkIn(auth.commitment)).to.emit(ctx.gate, "MemberCheckedIn");

      await time.setNextBlockTimestamp(expiresAt);
      await expect(ctx.gate.connect(ctx.holder).checkIn(auth.commitment))
        .to.be.revertedWithCustomError(ctx.gate, "AccessDenied")
        .withArgs(Status.Expired, false);
      // The reverted call was never mined; mine the block at expiresAt so views see that timestamp.
      await networkHelpers.mine();
      expect(await time.latest()).to.equal(expiresAt);
      expect(await ctx.registry.credentialStatus(auth.commitment)).to.equal(Status.Expired);
      expect(await ctx.registry.isCredentialValid(auth.commitment, ctx.holder.address, SCHEMA_ID)).to.equal(false);
    });
  });

  describe("revocation", () => {
    it("lets the issuing issuer revoke, after which status and the gate fail", async () => {
      const ctx = await loadFixture(fixture);
      const auth = await registered(ctx);
      await expect(ctx.registry.connect(ctx.issuer).revoke(auth.commitment))
        .to.emit(ctx.registry, "CredentialRevoked")
        .withArgs(auth.commitment, ctx.issuer.address, false);
      expect(await ctx.registry.credentialStatus(auth.commitment)).to.equal(Status.Revoked);
      expect(await ctx.registry.isCredentialValid(auth.commitment, ctx.holder.address, SCHEMA_ID)).to.equal(false);
      await expect(ctx.gate.connect(ctx.holder).checkIn(auth.commitment))
        .to.be.revertedWithCustomError(ctx.gate, "AccessDenied")
        .withArgs(Status.Revoked, false);
      await expect(ctx.registry.connect(ctx.issuer).revoke(auth.commitment)).to.be.revertedWithCustomError(ctx.registry, "AlreadyRevoked");
    });

    it("rejects revocation by the holder, another trusted issuer, or for unknown records", async () => {
      const ctx = await loadFixture(fixture);
      const auth = await registered(ctx);
      await expect(ctx.registry.connect(ctx.holder).revoke(auth.commitment))
        .to.be.revertedWithCustomError(ctx.registry, "NotCredentialIssuer")
        .withArgs(ctx.holder.address, ctx.issuer.address);
      await expect(ctx.registry.connect(ctx.secondIssuer).revoke(auth.commitment)).to.be.revertedWithCustomError(ctx.registry, "NotCredentialIssuer");
      await expect(ctx.registry.connect(ctx.issuer).revoke(freshCommitment())).to.be.revertedWithCustomError(ctx.registry, "UnknownCredential");
    });

    it("supports an explicit, evented admin override revocation", async () => {
      const ctx = await loadFixture(fixture);
      const auth = await registered(ctx);
      await expect(ctx.registry.connect(ctx.admin).adminRevoke(auth.commitment))
        .to.emit(ctx.registry, "CredentialRevoked")
        .withArgs(auth.commitment, ctx.admin.address, true);
      expect(await ctx.registry.credentialStatus(auth.commitment)).to.equal(Status.Revoked);
    });

    it("keeps a revoked credential unusable: re-registration is rejected", async () => {
      const ctx = await loadFixture(fixture);
      const auth = await makeAuth(ctx);
      const sig = await sign(ctx, auth);
      await ctx.registry.connect(ctx.holder).register(auth, sig);
      await ctx.registry.connect(ctx.issuer).revoke(auth.commitment);
      await expect(ctx.registry.connect(ctx.holder).register(auth, sig)).to.be.revertedWithCustomError(ctx.registry, "AlreadyRegistered");
      // Even a freshly signed authorization for the same commitment cannot resurrect it.
      const again = { ...auth, deadline: auth.deadline + 1 };
      await expect(ctx.registry.connect(ctx.holder).register(again, await sign(ctx, again))).to.be.revertedWithCustomError(
        ctx.registry,
        "AlreadyRegistered",
      );
      expect(await ctx.registry.credentialStatus(auth.commitment)).to.equal(Status.Revoked);
    });
  });

  describe("issuer removal policy", () => {
    it("invalidates credentials on removal and does not restore them when the issuer is re-added", async () => {
      const ctx = await loadFixture(fixture);
      const auth = await registered(ctx);
      const pendingAuth = await makeAuth(ctx); // signed before removal, never submitted
      const pendingSig = await sign(ctx, pendingAuth);

      await expect(ctx.registry.connect(ctx.admin).removeIssuer(ctx.issuer.address))
        .to.emit(ctx.registry, "IssuerRemoved")
        .withArgs(ctx.issuer.address, 1n);
      expect(await ctx.registry.credentialStatus(auth.commitment)).to.equal(Status.IssuerInactive);
      await expect(ctx.gate.connect(ctx.holder).checkIn(auth.commitment))
        .to.be.revertedWithCustomError(ctx.gate, "AccessDenied")
        .withArgs(Status.IssuerInactive, false);
      await expect(ctx.registry.connect(ctx.holder).register(pendingAuth, pendingSig)).to.be.revertedWithCustomError(ctx.registry, "IssuerNotActive");

      // A removed issuer may still revoke its own records.
      await expect(ctx.registry.connect(ctx.issuer).revoke(auth.commitment)).to.emit(ctx.registry, "CredentialRevoked");

      await ctx.registry.connect(ctx.admin).addIssuer(ctx.issuer.address);
      expect(await ctx.registry.credentialStatus(auth.commitment)).to.equal(Status.Revoked);
      await expect(ctx.registry.connect(ctx.holder).register(pendingAuth, pendingSig))
        .to.be.revertedWithCustomError(ctx.registry, "StaleIssuerEpoch")
        .withArgs(0n, 1n);

      // Unrevoked records from the old epoch stay invalid too.
      const ctx2 = await loadFixture(fixture);
      const old = await registered(ctx2);
      await ctx2.registry.connect(ctx2.admin).removeIssuer(ctx2.issuer.address);
      await ctx2.registry.connect(ctx2.admin).addIssuer(ctx2.issuer.address);
      expect(await ctx2.registry.credentialStatus(old.commitment)).to.equal(Status.IssuerInactive);
      expect(await ctx2.registry.isCredentialValid(old.commitment, ctx2.holder.address, SCHEMA_ID)).to.equal(false);

      // New authorizations in the new epoch work.
      const fresh = await registered(ctx2);
      expect(fresh.issuerEpoch).to.equal(1);
      await expect(ctx2.gate.connect(ctx2.holder).checkIn(fresh.commitment)).to.emit(ctx2.gate, "MemberCheckedIn");
    });
  });

  describe("privacy of on-chain data", () => {
    it("never places the credential token or salt in calldata or events", async () => {
      const ctx = await loadFixture(fixture);
      const token = "eyJhbGciOiJFZDI1NTE5In0.eyJTRU5USU5FTCI6IlNZTi1QUklWQUNZLTk5In0.c2ln";
      const salt = "0x" + "ab".repeat(32);
      const commitment = commitmentFor(token, salt);
      const auth = await makeAuth(ctx, { commitment });
      const tx = await ctx.registry.connect(ctx.holder).register(auth, await sign(ctx, auth));
      const receipt = await tx.wait();
      const haystack = [tx.data, ...receipt!.logs.flatMap((l) => [l.data, ...l.topics])].join("").toLowerCase();
      expect(haystack).to.not.include(Buffer.from(token).toString("hex"));
      expect(haystack).to.not.include(salt.slice(2));
      expect(haystack).to.include(commitment.slice(2).toLowerCase());
    });
  });
});
