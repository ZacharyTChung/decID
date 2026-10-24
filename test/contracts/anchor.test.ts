import { expect } from "chai";
import { network } from "hardhat";
import { Contract, keccak256, toUtf8Bytes, type Signer } from "ethers";

const { ethers, networkHelpers } = await network.create();
const { loadFixture } = networkHelpers;

const on = (c: Contract, s: Signer) => c.connect(s) as Contract;
const stream = (label: string) => keccak256(toUtf8Bytes(label));
const head = (n: number) => keccak256(toUtf8Bytes(`receipt-${n}`));

async function fixture() {
  const [admin, anchorer, outsider] = await ethers.getSigners();
  const anchor = (await ethers.deployContract("ReceiptAnchor", [admin!.address])) as unknown as Contract;
  await (await anchor.getFunction("grantRole")(await anchor.getFunction("ANCHORER_ROLE")(), anchorer!.address)).wait();
  return { anchor, admin: admin!, anchorer: anchorer!, outsider: outsider! };
}

describe("ReceiptAnchor", () => {
  it("records checkpoints and keeps every one of them", async () => {
    const { anchor, anchorer } = await loadFixture(fixture);
    const s = stream("decid:receipts:hopline");
    await expect(on(anchor, anchorer).getFunction("anchor")(s, 1, head(1)))
      .to.emit(anchor, "Anchored")
      .withArgs(s, 1, head(1), anchorer.address);
    await (await on(anchor, anchorer).getFunction("anchor")(s, 5, head(5))).wait();
    const latest = await anchor.getFunction("latest")(s);
    expect(latest.head).to.equal(head(5));
    expect(latest.count).to.equal(5n);
    expect(latest.anchoredAt).to.be.greaterThan(0n);
    expect(await anchor.getFunction("headAt")(s, 1)).to.equal(head(1));
    expect(await anchor.getFunction("headAt")(s, 5)).to.equal(head(5));
    expect(await anchor.getFunction("headAt")(s, 3)).to.equal(ethers.ZeroHash);
    expect(await anchor.getFunction("checkpointCount")(s)).to.equal(2n);
  });

  it("never lets history be rewritten or shortened", async () => {
    const { anchor, anchorer } = await loadFixture(fixture);
    const s = stream("decid:receipts:neonhall");
    await (await on(anchor, anchorer).getFunction("anchor")(s, 4, head(4))).wait();
    // Same count, different head: a rewrite.
    await expect(on(anchor, anchorer).getFunction("anchor")(s, 4, head(99))).to.be.revertedWithCustomError(anchor, "CountNotIncreasing").withArgs(4, 4);
    // Fewer entries: a truncation.
    await expect(on(anchor, anchorer).getFunction("anchor")(s, 2, head(2))).to.be.revertedWithCustomError(anchor, "CountNotIncreasing").withArgs(4, 2);
    expect((await anchor.getFunction("latest")(s)).head).to.equal(head(4));
  });

  it("rejects an empty head and a zero count", async () => {
    const { anchor, anchorer } = await loadFixture(fixture);
    const s = stream("x");
    await expect(on(anchor, anchorer).getFunction("anchor")(s, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(anchor, "EmptyHead");
    await expect(on(anchor, anchorer).getFunction("anchor")(s, 0, head(0))).to.be.revertedWithCustomError(anchor, "CountNotIncreasing");
  });

  it("only the anchorer role can anchor, and only the admin grants it", async () => {
    const { anchor, outsider, anchorer } = await loadFixture(fixture);
    await expect(on(anchor, outsider).getFunction("anchor")(stream("s"), 1, head(1))).to.be.revertedWithCustomError(anchor, "AccessControlUnauthorizedAccount");
    const role = await anchor.getFunction("ANCHORER_ROLE")();
    await expect(on(anchor, anchorer).getFunction("grantRole")(role, outsider.address)).to.be.revertedWithCustomError(anchor, "AccessControlUnauthorizedAccount");
  });

  it("keeps streams independent", async () => {
    const { anchor, anchorer } = await loadFixture(fixture);
    const a = stream("decid:receipts:a");
    const b = stream("decid:receipts:b");
    await (await on(anchor, anchorer).getFunction("anchor")(a, 10, head(10))).wait();
    await (await on(anchor, anchorer).getFunction("anchor")(b, 1, head(1))).wait();
    expect((await anchor.getFunction("latest")(a)).count).to.equal(10n);
    expect((await anchor.getFunction("latest")(b)).count).to.equal(1n);
  });
});
