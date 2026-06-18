// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @title TankDawgsClans — on-chain clan/group registry for the TankDawgs
///        ecosystem.
/// @notice Players form clans, join one at a time, and leave. Membership and
///         ownership are recorded on-chain (verifiable); the off-chain server
///         reads it to gate clan-only matches and plan inter-clan activities.
///
///         A wallet belongs to at most one clan. Rosters are reconstructed from
///         events off-chain (MemberJoined / MemberLeft), the same pattern the
///         NFT-avatar lookup uses — so there's no unbounded on-chain array to
///         enumerate. `memberCount` is kept on-chain for quick checks.
contract TankDawgsClans is Initializable, OwnableUpgradeable {
    struct Clan {
        address founder;
        string name;
        string tag; // short uppercase tag, e.g. "DAWG"
        uint64 createdAt;
        uint32 memberCount;
        bool exists;
    }

    uint256 public nextClanId; // first clan is id 1
    mapping(uint256 => Clan) private _clans;
    /// @notice clanId a wallet belongs to (0 = none).
    mapping(address => uint256) public clanOf;
    /// @notice Whether a tag is already taken (uppercased).
    mapping(string => bool) public tagTaken;

    /// @notice Max members per clan (kept modest; raise via upgrade if needed).
    uint32 public constant MAX_MEMBERS = 50;

    event ClanCreated(uint256 indexed clanId, address indexed founder, string name, string tag);
    event MemberJoined(uint256 indexed clanId, address indexed member);
    event MemberLeft(uint256 indexed clanId, address indexed member);
    event ClanDisbanded(uint256 indexed clanId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        nextClanId = 1;
    }

    // ─────────────────────────── views ───────────────────────────

    function getClan(uint256 clanId)
        external
        view
        returns (address founder, string memory name, string memory tag, uint64 createdAt, uint32 memberCount)
    {
        Clan storage c = _clans[clanId];
        require(c.exists, "no such clan");
        return (c.founder, c.name, c.tag, c.createdAt, c.memberCount);
    }

    function clanExists(uint256 clanId) external view returns (bool) {
        return _clans[clanId].exists;
    }

    // ─────────────────────────── lifecycle ───────────────────────────

    /// @notice Create a clan and become its founder + first member. Caller must
    ///         not already be in a clan; the tag must be free.
    function createClan(string calldata name, string calldata tag) external returns (uint256 clanId) {
        require(clanOf[msg.sender] == 0, "already in a clan");
        require(bytes(name).length > 0 && bytes(name).length <= 32, "bad name");
        uint256 tagLen = bytes(tag).length;
        require(tagLen >= 2 && tagLen <= 6, "bad tag");
        require(!tagTaken[tag], "tag taken");

        clanId = nextClanId++;
        _clans[clanId] = Clan({
            founder: msg.sender,
            name: name,
            tag: tag,
            createdAt: uint64(block.timestamp),
            memberCount: 1,
            exists: true
        });
        tagTaken[tag] = true;
        clanOf[msg.sender] = clanId;

        emit ClanCreated(clanId, msg.sender, name, tag);
        emit MemberJoined(clanId, msg.sender);
    }

    /// @notice Join an existing clan (must not already be in one).
    function joinClan(uint256 clanId) external {
        require(clanOf[msg.sender] == 0, "already in a clan");
        Clan storage c = _clans[clanId];
        require(c.exists, "no such clan");
        require(c.memberCount < MAX_MEMBERS, "clan full");

        c.memberCount += 1;
        clanOf[msg.sender] = clanId;
        emit MemberJoined(clanId, msg.sender);
    }

    /// @notice Leave your current clan. The founder leaving the last member
    ///         disbands it (frees the tag).
    function leaveClan() external {
        uint256 clanId = clanOf[msg.sender];
        require(clanId != 0, "not in a clan");
        Clan storage c = _clans[clanId];

        clanOf[msg.sender] = 0;
        c.memberCount -= 1;
        emit MemberLeft(clanId, msg.sender);

        if (c.memberCount == 0) {
            tagTaken[c.tag] = false;
            c.exists = false;
            emit ClanDisbanded(clanId);
        }
    }

    uint256[44] private __gap;
}
