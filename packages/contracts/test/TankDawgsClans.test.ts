import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { TankDawgsClans } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("TankDawgsClans", () => {
  let clans: TankDawgsClans;
  let a: HardhatEthersSigner;
  let b: HardhatEthersSigner;
  let c: HardhatEthersSigner;

  beforeEach(async () => {
    [a, b, c] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("TankDawgsClans");
    clans = (await upgrades.deployProxy(Factory, [], { kind: "transparent" })) as unknown as TankDawgsClans;
  });

  it("creates a clan, founder becomes first member", async () => {
    await expect(clans.connect(a).createClan("Deputy Dawgs", "DAWG"))
      .to.emit(clans, "ClanCreated")
      .withArgs(1, a.address, "Deputy Dawgs", "DAWG")
      .and.to.emit(clans, "MemberJoined")
      .withArgs(1, a.address);
    expect(await clans.clanOf(a.address)).to.equal(1);
    const [founder, name, tag, , memberCount] = await clans.getClan(1);
    expect(founder).to.equal(a.address);
    expect(name).to.equal("Deputy Dawgs");
    expect(tag).to.equal("DAWG");
    expect(memberCount).to.equal(1);
  });

  it("lets others join and tracks the member count", async () => {
    await clans.connect(a).createClan("Deputy Dawgs", "DAWG");
    await expect(clans.connect(b).joinClan(1)).to.emit(clans, "MemberJoined").withArgs(1, b.address);
    expect(await clans.clanOf(b.address)).to.equal(2n - 1n); // clan id 1
    const [, , , , memberCount] = await clans.getClan(1);
    expect(memberCount).to.equal(2);
  });

  it("enforces one clan per wallet and unique tags", async () => {
    await clans.connect(a).createClan("Deputy Dawgs", "DAWG");
    await expect(clans.connect(a).createClan("Other", "OTHR")).to.be.revertedWith("already in a clan");
    await expect(clans.connect(b).createClan("Clones", "DAWG")).to.be.revertedWith("tag taken");
    await clans.connect(b).joinClan(1);
    await expect(clans.connect(b).joinClan(1)).to.be.revertedWith("already in a clan");
  });

  it("rejects bad names/tags and unknown clans", async () => {
    await expect(clans.connect(a).createClan("", "DAWG")).to.be.revertedWith("bad name");
    await expect(clans.connect(a).createClan("Ok", "D")).to.be.revertedWith("bad tag");
    await expect(clans.connect(a).joinClan(99)).to.be.revertedWith("no such clan");
  });

  it("leaving frees the slot; the last member disbands the clan and frees the tag", async () => {
    await clans.connect(a).createClan("Deputy Dawgs", "DAWG");
    await clans.connect(b).joinClan(1);

    await expect(clans.connect(b).leaveClan()).to.emit(clans, "MemberLeft").withArgs(1, b.address);
    expect(await clans.clanOf(b.address)).to.equal(0);
    expect(await clans.clanExists(1)).to.equal(true);

    // Founder is the last one out → clan disbands, tag freed.
    await expect(clans.connect(a).leaveClan()).to.emit(clans, "ClanDisbanded").withArgs(1);
    expect(await clans.clanExists(1)).to.equal(false);
    // Tag can be reused now.
    await clans.connect(c).createClan("New Dawgs", "DAWG");
  });

  it("can't leave when not in a clan", async () => {
    await expect(clans.connect(a).leaveClan()).to.be.revertedWith("not in a clan");
  });
});
