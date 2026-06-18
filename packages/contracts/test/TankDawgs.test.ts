import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  TankDawgs,
  TankDawgsNFT,
  MockDDawgsToken,
  MockDDawgsNFT,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const STAKE = ethers.parseEther("100");
const GAME_ID = "TD-game-001";
const ABANDONMENT_TIMEOUT = 3600;

describe("TankDawgs", () => {
  let game: TankDawgs;
  let token: MockDDawgsToken;
  let nft: TankDawgsNFT;
  let chessNft: MockDDawgsNFT;
  let owner: HardhatEthersSigner;
  let signer: HardhatEthersSigner; // result signer (backend)
  let players: HardhatEthersSigner[];
  let outsider: HardhatEthersSigner;
  let company: HardhatEthersSigner;
  let burnPool: HardhatEthersSigner;

  beforeEach(async () => {
    const all = await ethers.getSigners();
    [owner, signer, company, burnPool, outsider] = all;
    players = all.slice(5, 11); // up to 6 NFT-holding players

    token = await (await ethers.getContractFactory("MockDDawgsToken")).deploy();
    nft = await (await ethers.getContractFactory("TankDawgsNFT")).deploy("");
    chessNft = await (await ethers.getContractFactory("MockDDawgsNFT")).deploy();

    const Factory = await ethers.getContractFactory("TankDawgs");
    game = (await upgrades.deployProxy(
      Factory,
      [await token.getAddress(), await nft.getAddress(), await chessNft.getAddress(), burnPool.address, company.address],
      { kind: "transparent" }
    )) as unknown as TankDawgs;
    await game.connect(owner).setResultSigner(signer.address);

    for (const p of players) {
      await token.mint(p.address, STAKE * 20n);
      await token.connect(p).approve(await game.getAddress(), ethers.MaxUint256);
      await nft.connect(p).mint();
    }
    await token.mint(outsider.address, STAKE * 20n);
    await token.connect(outsider).approve(await game.getAddress(), ethers.MaxUint256);
  });

  async function voucher(gameId: string, winner: string, who: HardhatEthersSigner = signer): Promise<string> {
    const domain = {
      name: "TankDawgs",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await game.getAddress(),
    };
    const types = { Result: [{ name: "gameId", type: "string" }, { name: "winner", type: "address" }] };
    return who.signTypedData(domain, types, { gameId, winner });
  }

  /** Create a game and fill it from `roster`. */
  async function fill(roster: HardhatEthersSigner[], teamSize: number, gameId = GAME_ID): Promise<void> {
    await game.connect(roster[0]).createGame(STAKE, roster.length, teamSize, gameId);
    for (const p of roster.slice(1)) await game.connect(p).joinGame(gameId);
  }

  describe("free-for-all payout", () => {
    it("1v1 winner self-claims 80% of the pot; company + burn get 10% each", async () => {
      const [a, b] = players;
      await fill([a, b], 0);
      const pot = STAKE * 2n;
      const before = await token.balanceOf(a.address);
      await game.connect(a).claimRewardSigned(GAME_ID, await voucher(GAME_ID, a.address));
      expect((await token.balanceOf(a.address)) - before).to.equal((pot * 80n) / 100n);
      expect(await token.balanceOf(company.address)).to.equal((pot * 10n) / 100n);
      expect(await token.balanceOf(burnPool.address)).to.equal((pot * 10n) / 100n);
      expect(await token.balanceOf(await game.getAddress())).to.equal(0n);
    });

    it("3-way FFA winner takes 80% of the 3-stake pot", async () => {
      const [a, b, c] = players;
      await fill([a, b, c], 0);
      const before = await token.balanceOf(c.address);
      await game.connect(c).claimRewardSigned(GAME_ID, await voucher(GAME_ID, c.address));
      expect((await token.balanceOf(c.address)) - before).to.equal((STAKE * 3n * 80n) / 100n);
    });

    it("rejects a forged voucher and double claims", async () => {
      const [a, b] = players;
      await fill([a, b], 0);
      const forged = await voucher(GAME_ID, a.address, outsider);
      await expect(game.connect(a).claimRewardSigned(GAME_ID, forged)).to.be.revertedWith("bad voucher");
      await game.connect(a).claimRewardSigned(GAME_ID, await voucher(GAME_ID, a.address));
      await expect(
        game.connect(a).claimRewardSigned(GAME_ID, await voucher(GAME_ID, a.address))
      ).to.be.revertedWith("already claimed");
    });
  });

  describe("2v2 team payout (split among winners)", () => {
    it("each winning member claims an equal share of the 80%; cuts taken once", async () => {
      const [a, b, c, d] = players; // team0 = a,b ; team1 = c,d
      await fill([a, b, c, d], 2);
      const [, maxPlayers, teamSize] = await game.getGame(GAME_ID);
      expect(maxPlayers).to.equal(4);
      expect(teamSize).to.equal(2);

      const pot = STAKE * 4n;
      const memberShare = (pot * 80n) / 100n / 2n; // 40% of pot each

      const aBefore = await token.balanceOf(a.address);
      const bBefore = await token.balanceOf(b.address);
      await game.connect(a).claimRewardSigned(GAME_ID, await voucher(GAME_ID, a.address));
      await game.connect(b).claimRewardSigned(GAME_ID, await voucher(GAME_ID, b.address));

      expect((await token.balanceOf(a.address)) - aBefore).to.equal(memberShare);
      expect((await token.balanceOf(b.address)) - bBefore).to.equal(memberShare);
      // Company + burn taken exactly once.
      expect(await token.balanceOf(company.address)).to.equal((pot * 10n) / 100n);
      expect(await token.balanceOf(burnPool.address)).to.equal((pot * 10n) / 100n);
      // Pot fully distributed.
      expect(await token.balanceOf(await game.getAddress())).to.equal(0n);
    });

    it("rejects bad teamSize / maxPlayers combos", async () => {
      const [a] = players;
      await expect(game.connect(a).createGame(STAKE, 4, 3, GAME_ID)).to.be.revertedWith("bad teamSize");
      await expect(game.connect(a).createGame(STAKE, 5, 2, GAME_ID)).to.be.revertedWith("bad teamSize");
      await game.connect(a).createGame(STAKE, 4, 2, GAME_ID); // 2v2 ok
    });
  });

  describe("lifecycle", () => {
    it("cancel refunds every joined player", async () => {
      const [a, b] = players;
      await game.connect(a).createGame(STAKE, 4, 2, GAME_ID);
      await game.connect(b).joinGame(GAME_ID);
      const aBefore = await token.balanceOf(a.address);
      await game.connect(a).cancelGame(GAME_ID);
      expect((await token.balanceOf(a.address)) - aBefore).to.equal(STAKE);
    });

    it("ownerWithdrawUnpaid sweeps only what's left after a partial team claim", async () => {
      const [a, b, c, d] = players;
      await fill([a, b, c, d], 2);
      const pot = STAKE * 4n;
      // Only one of the two winners claims; the other's share is left.
      await game.connect(a).claimRewardSigned(GAME_ID, await voucher(GAME_ID, a.address));
      await expect(game.connect(owner).ownerWithdrawUnpaid(GAME_ID)).to.be.revertedWith("claim window open");
      await time.increase(ABANDONMENT_TIMEOUT + 1);
      const compBefore = await token.balanceOf(company.address);
      await game.connect(owner).ownerWithdrawUnpaid(GAME_ID);
      // Remaining = the unclaimed member's 40% share.
      expect((await token.balanceOf(company.address)) - compBefore).to.equal((pot * 80n) / 100n / 2n);
      expect(await token.balanceOf(await game.getAddress())).to.equal(0n);
    });
  });

  describe("gating + admin", () => {
    it("rejects create/join without a Dawgs NFT", async () => {
      await expect(game.connect(outsider).createGame(STAKE, 2, 0, GAME_ID)).to.be.revertedWith(
        "must own a Dawgs NFT"
      );
    });
    it("only owner/operator can finishGame", async () => {
      const [a, b] = players;
      await fill([a, b], 0);
      await expect(game.connect(a).finishGame(GAME_ID, a.address)).to.be.revertedWith("not authorized");
      await game.connect(owner).finishGame(GAME_ID, a.address);
    });
    it("exposes wiring + MAX_PLAYERS", async () => {
      expect(await game.MAX_PLAYERS()).to.equal(8);
      expect(await game.rewardToken()).to.equal(await token.getAddress());
      expect(await game.companyWallet()).to.equal(company.address);
    });
    it("blocks create while paused", async () => {
      const [a] = players;
      await game.connect(owner).pause();
      await expect(game.connect(a).createGame(STAKE, 2, 0, GAME_ID)).to.be.revertedWithCustomError(
        game,
        "EnforcedPause"
      );
    });
  });
});
