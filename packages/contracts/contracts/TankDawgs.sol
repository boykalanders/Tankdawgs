// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
// Constructor-free, transient-storage guard (EIP-1153, Cancun+) — proxy-safe;
// OZ 5.6 no longer ships an upgradeable ReentrancyGuard variant.
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title TankDawgs — wagered N-player artillery staking/escrow
/// @notice Multi-player generalisation of the ChessDawgs/PoolDawgs escrow: a
///         game holds 2…MAX_PLAYERS players who each stake the same amount into
///         one pot (pot = stake × players). The single last-tank-standing winner
///         takes 80%; 10% to the company wallet, 10% burned. NFT-gated, same as
///         the rest of the Dawgs ecosystem (TankDawgs pass OR grandfathered
///         ChessDawgs NFT).
///
///         The trusted backend is the sole authority on outcomes: it simulates
///         every shot server-side and either signs an EIP-712 win voucher the
///         winner self-redeems (claimRewardSigned — no relayer gas, signing-only
///         key) or, as a backstop, the operator calls finishGame directly. There
///         is deliberately NO on-chain timer; the turn clock is enforced
///         off-chain.
contract TankDawgs is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    EIP712Upgradeable,
    ReentrancyGuardTransient
{
    using SafeERC20 for IERC20;

    /// @notice Up to 8-player battles (1v1 … 8-way free-for-all).
    uint8 public constant MAX_PLAYERS = 8;

    struct Game {
        address[] players;
        uint8 maxPlayers;
        uint256 stake; // per-player stake
        bool isCompleted;
        address winner;
        bool rewardClaimed;
    }

    /// @notice Grace window (template value: 1 hour) — after it, an unclaimed
    ///         payout may be swept via ownerWithdrawUnpaid.
    uint256 public constant ABANDONMENT_TIMEOUT = 3600;

    uint256 private constant WINNER_PERCENT = 80;
    uint256 private constant COMPANY_PERCENT = 10;
    uint256 private constant BURN_PERCENT = 10;

    IERC20 public rewardToken;
    /// @notice Primary gate NFT — the TankDawgs membership pass (TankDawgsNFT).
    IERC721 public DDawgsNFT;
    /// @notice Grandfather exception — holders of the existing ChessDawgs NFT
    ///         may play without minting a TankDawgs pass. Optional (may be zero).
    IERC721 public chessDawgsNFT;
    /// @notice Burn destination — receives the 10% burn cut, as in ChessDawgs.
    address public poolAddress;
    address public companyWallet;

    mapping(string => Game) private _games;
    mapping(string => mapping(address => bool)) public playerJoined;
    mapping(string => mapping(address => bool)) public playerPaid;
    mapping(string => uint256) private completedAt;

    /// @notice Low-privilege relayer key allowed to settle games (finishGame).
    ///         It can record outcomes but CANNOT move funds, change wallets/gate,
    ///         pause, or upgrade. Set/rotated by the owner.
    address public operator;

    /// @notice Backend signer for win vouchers. The backend NEVER sends a
    ///         settlement tx; it signs an EIP-712 Result(gameId, winner) voucher
    ///         off-chain, and the winner redeems it via claimRewardSigned.
    address public resultSigner;

    bytes32 private constant RESULT_TYPEHASH =
        keccak256("Result(string gameId,address winner)");

    event GameCreated(string gameId, address indexed creator, uint256 stake, uint8 maxPlayers);
    event GameJoined(string gameId, address indexed player, uint8 seat);
    event GameFinished(string gameId, address winner, uint256 reward);
    event GameCancelled(string gameId, uint256 refundedPlayers);
    event ChessDawgsNFTUpdated(address indexed nft);
    event DDawgsNFTUpdated(address indexed nft);
    event OperatorUpdated(address indexed operator);
    event ResultSignerUpdated(address indexed signer);

    /// @notice Relayer authority: the owner OR the dedicated operator may settle
    ///         games. Admin powers stay owner-only.
    modifier onlyRelayer() {
        require(msg.sender == owner() || msg.sender == operator, "not authorized");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _rewardToken,
        address _dDawgsNFT,
        address _chessDawgsNFT,
        address _poolAddress,
        address _companyWallet
    ) external initializer {
        require(_rewardToken != address(0), "zero token");
        require(_dDawgsNFT != address(0), "zero nft");
        require(_poolAddress != address(0), "zero pool");
        require(_companyWallet != address(0), "zero company");

        __Ownable_init(msg.sender);
        __Pausable_init();
        __EIP712_init("TankDawgs", "1");

        rewardToken = IERC20(_rewardToken);
        DDawgsNFT = IERC721(_dDawgsNFT);
        chessDawgsNFT = IERC721(_chessDawgsNFT); // may be zero
        poolAddress = _poolAddress;
        companyWallet = _companyWallet;
    }

    /// @notice The play gate: a wallet may play if it holds the TankDawgs
    ///         membership NFT OR (grandfather) a ChessDawgs NFT.
    function ownsNFT(address account) public view returns (bool) {
        if (DDawgsNFT.balanceOf(account) > 0) return true;
        if (address(chessDawgsNFT) != address(0) && chessDawgsNFT.balanceOf(account) > 0) {
            return true;
        }
        return false;
    }

    // ─────────────────────────── views ───────────────────────────

    /// @notice Full game record (the auto getter can't return the players array).
    function getGame(string memory gameId)
        external
        view
        returns (
            address[] memory players,
            uint8 maxPlayers,
            uint256 stake,
            bool isCompleted,
            address winner,
            bool rewardClaimed
        )
    {
        Game storage g = _games[gameId];
        return (g.players, g.maxPlayers, g.stake, g.isCompleted, g.winner, g.rewardClaimed);
    }

    function playersOf(string memory gameId) external view returns (address[] memory) {
        return _games[gameId].players;
    }

    function playerCount(string memory gameId) external view returns (uint256) {
        return _games[gameId].players.length;
    }

    /// @notice A game is active (playable) once its roster is full.
    function isActive(string memory gameId) public view returns (bool) {
        Game storage g = _games[gameId];
        return g.players.length == g.maxPlayers && g.maxPlayers > 0 && !g.isCompleted;
    }

    function _isPlayer(Game storage g, address who) private view returns (bool) {
        uint256 n = g.players.length;
        for (uint256 i = 0; i < n; i++) if (g.players[i] == who) return true;
        return false;
    }

    // ─────────────────────────── game lifecycle ───────────────────────────

    /// @notice Open a table for `maxPlayers` (2…8) at `stake` each. The creator
    ///         takes seat 0 and escrows the first stake.
    function createGame(uint256 stake, uint8 maxPlayers, string memory gameId)
        external
        whenNotPaused
        nonReentrant
        returns (string memory)
    {
        require(bytes(gameId).length > 0, "empty gameId");
        require(_games[gameId].maxPlayers == 0, "gameId taken");
        require(stake > 0, "zero stake");
        require(maxPlayers >= 2 && maxPlayers <= MAX_PLAYERS, "bad maxPlayers");
        require(ownsNFT(msg.sender), "must own a Dawgs NFT");

        Game storage g = _games[gameId];
        g.maxPlayers = maxPlayers;
        g.stake = stake;
        g.players.push(msg.sender);
        playerJoined[gameId][msg.sender] = true;

        rewardToken.safeTransferFrom(msg.sender, address(this), stake);
        emit GameCreated(gameId, msg.sender, stake, maxPlayers);
        emit GameJoined(gameId, msg.sender, 0);
        return gameId;
    }

    /// @notice Take an open seat and escrow the stake. The game goes active when
    ///         the final seat fills.
    function joinGame(string memory gameId) external whenNotPaused nonReentrant {
        Game storage g = _games[gameId];
        require(g.maxPlayers != 0, "no such game");
        require(!g.isCompleted, "game completed");
        require(g.players.length < g.maxPlayers, "game full");
        require(!playerJoined[gameId][msg.sender], "already joined");
        require(ownsNFT(msg.sender), "must own a Dawgs NFT");

        uint8 seat = uint8(g.players.length);
        g.players.push(msg.sender);
        playerJoined[gameId][msg.sender] = true;

        rewardToken.safeTransferFrom(msg.sender, address(this), g.stake);
        emit GameJoined(gameId, msg.sender, seat);
    }

    /// @notice Creator may withdraw a not-yet-full table; every joined player is
    ///         refunded their stake.
    function cancelGame(string memory gameId) external nonReentrant {
        Game storage g = _games[gameId];
        require(g.maxPlayers != 0, "no such game");
        require(g.players.length > 0 && g.players[0] == msg.sender, "not your game");
        require(g.players.length < g.maxPlayers, "game already active");
        require(!g.isCompleted, "game completed");

        uint256 stake = g.stake;
        address[] memory roster = g.players;
        delete _games[gameId];
        for (uint256 i = 0; i < roster.length; i++) {
            playerJoined[gameId][roster[i]] = false;
            rewardToken.safeTransfer(roster[i], stake);
        }
        emit GameCancelled(gameId, roster.length);
    }

    /// @notice Backend authority reports the winner (backstop to the voucher
    ///         path). Covers KO wins, resignations, and turn-clock forfeits.
    function finishGame(string memory gameId, address winner) external onlyRelayer {
        Game storage g = _games[gameId];
        require(isActive(gameId), "game not active");
        require(_isPlayer(g, winner), "winner not a player");

        g.isCompleted = true;
        g.winner = winner;
        completedAt[gameId] = block.timestamp;

        emit GameFinished(gameId, winner, _winnerShare(g.stake, g.players.length));
    }

    /// @notice Winner-driven claim with a backend voucher. The backend signs an
    ///         EIP-712 Result(gameId, winner) off-chain (no transaction); the
    ///         winner submits it here, the contract validates recovered signer ==
    ///         resultSigner, then settles + pays out in one winner-paid tx.
    function claimRewardSigned(string memory gameId, bytes calldata signature)
        external
        nonReentrant
    {
        Game storage g = _games[gameId];
        require(isActive(gameId), "game not active");
        require(!g.rewardClaimed, "already claimed");
        require(_isPlayer(g, msg.sender), "not a player");
        require(resultSigner != address(0), "signer unset");

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(RESULT_TYPEHASH, keccak256(bytes(gameId)), msg.sender))
        );
        require(ECDSA.recover(digest, signature) == resultSigner, "bad voucher");

        g.isCompleted = true;
        g.winner = msg.sender;
        g.rewardClaimed = true;
        completedAt[gameId] = block.timestamp;
        playerPaid[gameId][msg.sender] = true;

        _payout(g, msg.sender);
        emit GameFinished(gameId, msg.sender, _winnerShare(g.stake, g.players.length));
    }

    /// @notice Winner pulls the pot after finishGame settled it (backstop path).
    function claimReward(string memory gameId) external nonReentrant {
        Game storage g = _games[gameId];
        require(g.isCompleted, "no win to claim");
        require(msg.sender == g.winner, "not the winner");
        require(!g.rewardClaimed, "already claimed");

        g.rewardClaimed = true;
        playerPaid[gameId][msg.sender] = true;
        _payout(g, msg.sender);
    }

    // ─────────────────────────── safety nets / admin ───────────────────────────

    /// @notice If the winner never claims (e.g. UI bug), the owner can sweep the
    ///         whole pot to the company wallet after the timeout.
    function ownerWithdrawUnpaid(string memory gameId)
        external
        onlyOwner
        nonReentrant
    {
        Game storage g = _games[gameId];
        require(g.isCompleted, "game not completed");
        require(!g.rewardClaimed, "already paid");
        require(
            block.timestamp > completedAt[gameId] + ABANDONMENT_TIMEOUT,
            "claim window open"
        );

        g.rewardClaimed = true;
        uint256 pot = g.stake * g.players.length;
        rewardToken.safeTransfer(companyWallet, pot);
        emit GameFinished(gameId, companyWallet, pot);
    }

    function setCompanyWallet(address _companyWallet) external onlyOwner {
        require(_companyWallet != address(0), "zero company");
        companyWallet = _companyWallet;
    }

    function setChessDawgsNFT(address _chessDawgsNFT) external onlyOwner {
        chessDawgsNFT = IERC721(_chessDawgsNFT);
        emit ChessDawgsNFTUpdated(_chessDawgsNFT);
    }

    function setDDawgsNFT(address _dDawgsNFT) external onlyOwner {
        require(_dDawgsNFT != address(0), "zero nft");
        DDawgsNFT = IERC721(_dDawgsNFT);
        emit DDawgsNFTUpdated(_dDawgsNFT);
    }

    function setOperator(address _operator) external onlyOwner {
        operator = _operator;
        emit OperatorUpdated(_operator);
    }

    function setResultSigner(address _signer) external onlyOwner {
        resultSigner = _signer;
        emit ResultSignerUpdated(_signer);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Rescue stray ETH sent to the contract (template parity).
    function withdrawETH(address payable to) external onlyOwner {
        require(to != address(0), "zero address");
        (bool ok, ) = to.call{value: address(this).balance}("");
        require(ok, "ETH transfer failed");
    }

    receive() external payable {}

    fallback() external payable {}

    // ─────────────────────────── internals ───────────────────────────

    /// @notice Pay the 80/10/10 split of the full pot to winner/company/burn.
    function _payout(Game storage g, address winner) private {
        uint256 pot = g.stake * g.players.length;
        rewardToken.safeTransfer(winner, (pot * WINNER_PERCENT) / 100);
        rewardToken.safeTransfer(companyWallet, (pot * COMPANY_PERCENT) / 100);
        rewardToken.safeTransfer(poolAddress, (pot * BURN_PERCENT) / 100);
    }

    function _winnerShare(uint256 stake, uint256 nPlayers) private pure returns (uint256) {
        return (stake * nPlayers * WINNER_PERCENT) / 100;
    }

    uint256[39] private __gap;
}
