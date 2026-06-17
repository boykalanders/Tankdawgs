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

// Shares of an N-player pot (pot = stake × players).
const winnerShare = (n: bigint) => (STAKE * n * 80n) / 100n;
const companyShare = (n: bigint) => (STAKE * n * 10n) / 100n;
const burnShare = (n: bigint) => (STAKE * n * 10n) / 100n;

describe("TankDawgs", () => {
  let game: TankDawgs;
  let token: MockDDawgsToken;
  let nft: TankDawgsNFT; // TankDawgs membership pass (gate)
  let chessNft: MockDDawgsNFT; // grandfathered ChessDawgs NFT
  let owner: HardhatEthersSigner; // backend relayer / deployer
  let p1: HardhatEthersSigner;
  let p2: HardhatEthersSigner;
  let p3: HardhatEthersSigner;
  let outsider: HardhatEthersSigner; // no NFT at all
  let chessHolder: HardhatEthersSigner; // only the ChessDawgs NFT
  let company: HardhatEthersSigner;
  let burnPool: HardhatEthersSigner;

  beforeEach(async () => {
    [owner, p1, p2, p3, outsider, chessHolder, company, burnPool] = await ethers.getSigners();

    token = await (await ethers.getContractFactory("MockDDawgsToken")).deploy();
    nft = await (await ethers.getContractFactory("TankDawgsNFT")).deploy("");
    chessNft = await (await ethers.getContractFactory("MockDDawgsNFT")).deploy();

    const TankDawgsFactory = await ethers.getContractFactory("TankDawgs");
    game = (await upgrades.deployProxy(
      TankDawgsFactory,
      [
        await token.getAddress(),
        await nft.getAddress(),
        await chessNft.getAddress(),
        burnPool.address,
        company.address,
      ],
      { kind: "transparent" }
    )) as unknown as TankDawgs;

    for (const player of [p1, p2, p3]) {
      await token.mint(player.address, STAKE * 10n);
      await token.connect(player).approve(await game.getAddress(), ethers.MaxUint256);
      await nft.connect(player).mint(); // mint a TankDawgs pass
    }
    await token.mint(outsider.address, STAKE * 10n);
    await token.connect(outsider).approve(await game.getAddress(), ethers.MaxUint256);
    await token.mint(chessHolder.address, STAKE * 10n);
    await token.connect(chessHolder).approve(await game.getAddress(), ethers.MaxUint256);
    await chessNft.mint(chessHolder.address);
  });

  /** Create a `max`-seat game and fill it from the given signers. */
  async function createAndFill(
    players: HardhatEthersSigner[],
    gameId = GAME_ID
  ): Promise<string> {
    await game.connect(players[0]).createGame(STAKE, players.length, gameId);
    for (const p of players.slice(1)) await game.connect(p).joinGame(gameId);
    return gameId;
  }

  describe("1v1: create → join → finish → claim", () => {
    it("escrows both stakes and pays 80/10/10 on claim", async () => {
      await createAndFill([p1, p2]);
      expect(await token.balanceOf(await game.getAddress())).to.equal(STAKE * 2n);

      await expect(game.connect(owner).finishGame(GAME_ID, p1.address))
        .to.emit(game, "GameFinished")
        .withArgs(GAME_ID, p1.address, winnerShare(2n));

      const before = await token.balanceOf(p1.address);
      await game.connect(p1).claimReward(GAME_ID);

      expect((await token.balanceOf(p1.address)) - before).to.equal(winnerShare(2n));
      expect(await token.balanceOf(company.address)).to.equal(companyShare(2n));
      expect(await token.balanceOf(burnPool.address)).to.equal(burnShare(2n));
      expect(await token.balanceOf(await game.getAddress())).to.equal(0n);
      expect(await game.playerPaid(GAME_ID, p1.address)).to.equal(true);
    });

    it("rejects double-claim and non-winner claims", async () => {
      await createAndFill([p1, p2]);
      await game.connect(owner).finishGame(GAME_ID, p1.address);
      await game.connect(p1).claimReward(GAME_ID);
      await expect(game.connect(p1).claimReward(GAME_ID)).to.be.revertedWith("already claimed");
      await expect(game.connect(p2).claimReward(GAME_ID)).to.be.revertedWith("not the winner");
    });
  });

  describe("N-player (free-for-all) pot", () => {
    it("escrows every stake and pays the winner 80% of the whole pot", async () => {
      await createAndFill([p1, p2, p3]);
      expect(await token.balanceOf(await game.getAddress())).to.equal(STAKE * 3n);

      const [players, maxPlayers] = await game.getGame(GAME_ID);
      expect(players.length).to.equal(3);
      expect(maxPlayers).to.equal(3);
      expect(await game.isActive(GAME_ID)).to.equal(true);

      const before = await token.balanceOf(p2.address);
      await game.connect(owner).finishGame(GAME_ID, p2.address);
      await game.connect(p2).claimReward(GAME_ID);
      expect((await token.balanceOf(p2.address)) - before).to.equal(winnerShare(3n));
      expect(await token.balanceOf(company.address)).to.equal(companyShare(3n));
      expect(await token.balanceOf(burnPool.address)).to.equal(burnShare(3n));
    });

    it("is not active until the final seat fills", async () => {
      await game.connect(p1).createGame(STAKE, 3, GAME_ID);
      await game.connect(p2).joinGame(GAME_ID);
      expect(await game.isActive(GAME_ID)).to.equal(false);
      await expect(game.connect(owner).finishGame(GAME_ID, p1.address)).to.be.revertedWith(
        "game not active"
      );
      await game.connect(p3).joinGame(GAME_ID);
      expect(await game.isActive(GAME_ID)).to.equal(true);
    });

    it("rejects a full game, double joins, and bad seat counts", async () => {
      await expect(game.connect(p1).createGame(STAKE, 1, GAME_ID)).to.be.revertedWith(
        "bad maxPlayers"
      );
      await expect(game.connect(p1).createGame(STAKE, 9, GAME_ID)).to.be.revertedWith(
        "bad maxPlayers"
      );
      await createAndFill([p1, p2]); // 2-seat, now full
      await expect(game.connect(p3).joinGame(GAME_ID)).to.be.revertedWith("game full");
      await game.connect(p1).createGame(STAKE, 3, "TD-2");
      await expect(game.connect(p1).joinGame("TD-2")).to.be.revertedWith("already joined");
    });
  });

  describe("authority", () => {
    it("only owner/operator can finishGame", async () => {
      await createAndFill([p1, p2]);
      await expect(game.connect(p1).finishGame(GAME_ID, p1.address)).to.be.revertedWith(
        "not authorized"
      );
    });

    it("a dedicated operator may settle, but not touch admin functions", async () => {
      await createAndFill([p1, p2]);
      await game.connect(owner).setOperator(outsider.address);
      await game.connect(outsider).finishGame(GAME_ID, p1.address);
      const [, , , isCompleted, winner] = await game.getGame(GAME_ID);
      expect(isCompleted).to.equal(true);
      expect(winner).to.equal(p1.address);
      await expect(
        game.connect(outsider).setCompanyWallet(outsider.address)
      ).to.be.revertedWithCustomError(game, "OwnableUnauthorizedAccount");
    });

    it("winner must be a player", async () => {
      await createAndFill([p1, p2]);
      await expect(
        game.connect(owner).finishGame(GAME_ID, outsider.address)
      ).to.be.revertedWith("winner not a player");
    });

    it("cannot finish a completed game", async () => {
      await createAndFill([p1, p2]);
      await game.connect(owner).finishGame(GAME_ID, p1.address);
      await expect(game.connect(owner).finishGame(GAME_ID, p2.address)).to.be.revertedWith(
        "game not active"
      );
    });
  });

  describe("voucher self-claim", () => {
    it("winner self-claims with a backend voucher; forged vouchers are rejected", async () => {
      await createAndFill([p1, p2, p3]);
      await game.connect(owner).setResultSigner(company.address);
      const domain = {
        name: "TankDawgs",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await game.getAddress(),
      };
      const types = {
        Result: [
          { name: "gameId", type: "string" },
          { name: "winner", type: "address" },
        ],
      };
      const voucher = await company.signTypedData(domain, types, {
        gameId: GAME_ID,
        winner: p3.address,
      });

      const before = await token.balanceOf(p3.address);
      await game.connect(p3).claimRewardSigned(GAME_ID, voucher);
      const [, , , isCompleted, winner, rewardClaimed] = await game.getGame(GAME_ID);
      expect(isCompleted).to.equal(true);
      expect(winner).to.equal(p3.address);
      expect(rewardClaimed).to.equal(true);
      expect((await token.balanceOf(p3.address)) - before).to.equal(winnerShare(3n));

      await createAndFill([p1, p2], "TD-forge");
      const forged = await outsider.signTypedData(domain, types, {
        gameId: "TD-forge",
        winner: p1.address,
      });
      await expect(
        game.connect(p1).claimRewardSigned("TD-forge", forged)
      ).to.be.revertedWith("bad voucher");
    });
  });

  describe("gating and creation rules", () => {
    it("rejects create/join without any Dawgs NFT", async () => {
      await expect(game.connect(outsider).createGame(STAKE, 2, GAME_ID)).to.be.revertedWith(
        "must own a Dawgs NFT"
      );
      await game.connect(p1).createGame(STAKE, 2, GAME_ID);
      await expect(game.connect(outsider).joinGame(GAME_ID)).to.be.revertedWith(
        "must own a Dawgs NFT"
      );
    });

    it("ownsNFT reflects pass, chess grandfather, and neither", async () => {
      expect(await game.ownsNFT(p1.address)).to.equal(true);
      expect(await game.ownsNFT(chessHolder.address)).to.equal(true);
      expect(await game.ownsNFT(outsider.address)).to.equal(false);
    });

    it("a ChessDawgs-NFT holder may play without a TankDawgs pass", async () => {
      expect(await nft.balanceOf(chessHolder.address)).to.equal(0n);
      await expect(game.connect(chessHolder).createGame(STAKE, 2, GAME_ID)).to.emit(
        game,
        "GameCreated"
      );
      await expect(game.connect(p1).joinGame(GAME_ID)).to.emit(game, "GameJoined");
    });

    it("owner can clear the grandfather exception", async () => {
      await game.connect(owner).setChessDawgsNFT(ethers.ZeroAddress);
      expect(await game.ownsNFT(chessHolder.address)).to.equal(false);
    });

    it("rejects zero stake, empty/duplicate gameId", async () => {
      await expect(game.connect(p1).createGame(0, 2, GAME_ID)).to.be.revertedWith("zero stake");
      await expect(game.connect(p1).createGame(STAKE, 2, "")).to.be.revertedWith("empty gameId");
      await game.connect(p1).createGame(STAKE, 2, GAME_ID);
      await expect(game.connect(p2).createGame(STAKE, 2, GAME_ID)).to.be.revertedWith(
        "gameId taken"
      );
    });
  });

  describe("cancel", () => {
    it("refunds every joined player and frees the gameId", async () => {
      await game.connect(p1).createGame(STAKE, 3, GAME_ID);
      await game.connect(p2).joinGame(GAME_ID);
      const p1Before = await token.balanceOf(p1.address);
      const p2Before = await token.balanceOf(p2.address);

      await expect(game.connect(p1).cancelGame(GAME_ID))
        .to.emit(game, "GameCancelled")
        .withArgs(GAME_ID, 2);
      expect((await token.balanceOf(p1.address)) - p1Before).to.equal(STAKE);
      expect((await token.balanceOf(p2.address)) - p2Before).to.equal(STAKE);

      // Deleted game frees the id for reuse.
      await game.connect(p3).createGame(STAKE, 2, GAME_ID);
    });

    it("cannot cancel once the table is full, and only the creator can cancel", async () => {
      await createAndFill([p1, p2]);
      await expect(game.connect(p1).cancelGame(GAME_ID)).to.be.revertedWith(
        "game already active"
      );
      await game.connect(p1).createGame(STAKE, 2, "TD-x");
      await expect(game.connect(p2).cancelGame("TD-x")).to.be.revertedWith("not your game");
    });
  });

  describe("ownerWithdrawUnpaid safety net", () => {
    it("sweeps the whole unclaimed pot to the company only after the timeout", async () => {
      await createAndFill([p1, p2]);
      await game.connect(owner).finishGame(GAME_ID, p1.address);
      await expect(game.connect(owner).ownerWithdrawUnpaid(GAME_ID)).to.be.revertedWith(
        "claim window open"
      );
      await time.increase(ABANDONMENT_TIMEOUT + 1);
      await game.connect(owner).ownerWithdrawUnpaid(GAME_ID);
      expect(await token.balanceOf(company.address)).to.equal(STAKE * 2n);
      expect(await token.balanceOf(await game.getAddress())).to.equal(0n);
    });

    it("cannot sweep a pot the winner already claimed", async () => {
      await createAndFill([p1, p2]);
      await game.connect(owner).finishGame(GAME_ID, p1.address);
      await game.connect(p1).claimReward(GAME_ID);
      await time.increase(ABANDONMENT_TIMEOUT + 1);
      await expect(game.connect(owner).ownerWithdrawUnpaid(GAME_ID)).to.be.revertedWith(
        "already paid"
      );
    });
  });

  describe("admin", () => {
    it("blocks create while paused", async () => {
      await game.connect(owner).pause();
      await expect(
        game.connect(p1).createGame(STAKE, 2, GAME_ID)
      ).to.be.revertedWithCustomError(game, "EnforcedPause");
      await game.connect(owner).unpause();
      await expect(game.connect(p1).createGame(STAKE, 2, GAME_ID)).to.emit(game, "GameCreated");
    });

    it("rescues stray ETH via withdrawETH", async () => {
      await owner.sendTransaction({ to: await game.getAddress(), value: ethers.parseEther("1") });
      const before = await ethers.provider.getBalance(company.address);
      await game.connect(owner).withdrawETH(company.address);
      expect((await ethers.provider.getBalance(company.address)) - before).to.equal(
        ethers.parseEther("1")
      );
    });

    it("exposes wiring + MAX_PLAYERS", async () => {
      expect(await game.MAX_PLAYERS()).to.equal(8);
      expect(await game.rewardToken()).to.equal(await token.getAddress());
      expect(await game.DDawgsNFT()).to.equal(await nft.getAddress());
      expect(await game.poolAddress()).to.equal(burnPool.address);
      expect(await game.companyWallet()).to.equal(company.address);
    });
  });
});
