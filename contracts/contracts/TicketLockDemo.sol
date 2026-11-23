// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title TicketLockDemo
/// @notice One non-upgradeable ERC-721 contract holding event records, ticket ownership,
///         signed transfer authorisation and single-use admission state.
/// @dev Holders and the event organiser authorise actions with EIP-712 signatures. Any caller
///      may submit a validly signed permit (the demo relayer does, paying gas); the caller gains
///      no authority over the signed fields. Only the immutable issuer creates events and mints.
contract TicketLockDemo is ERC721Enumerable, EIP712, ReentrancyGuard {
    using Strings for uint256;

    struct EventInfo {
        address organiser;
        uint64 capacity;
        uint64 mintedCount;
        uint64 checkedInCount;
    }

    struct TicketInfo {
        uint64 eventId;
        uint64 ticketNumber;
        uint64 checkedInAt;
        uint56 nonce;
        bool used;
    }

    /// @notice Read model returned by the ticket views.
    struct TicketView {
        uint256 tokenId;
        uint256 eventId;
        uint256 ticketNumber;
        address owner;
        bool used;
        uint256 checkedInAt;
        uint256 nonce;
    }

    struct TransferPermit {
        uint256 eventId;
        uint256 tokenId;
        address from;
        address to;
        uint256 ticketNonce;
        bytes32 requestId;
        uint256 issuedAt;
        uint256 deadline;
    }

    struct CheckInPermit {
        uint256 eventId;
        uint256 tokenId;
        address owner;
        address gate;
        uint256 ticketNonce;
        bytes32 requestId;
        uint256 issuedAt;
        uint256 deadline;
    }

    bytes32 public constant TRANSFER_PERMIT_TYPEHASH = keccak256(
        "TransferPermit(uint256 eventId,uint256 tokenId,address from,address to,uint256 ticketNonce,bytes32 requestId,uint256 issuedAt,uint256 deadline)"
    );
    bytes32 public constant CHECK_IN_PERMIT_TYPEHASH = keccak256(
        "CheckInPermit(uint256 eventId,uint256 tokenId,address owner,address gate,uint256 ticketNonce,bytes32 requestId,uint256 issuedAt,uint256 deadline)"
    );

    /// @notice Longest accepted validity window for a transfer permit, in seconds.
    uint256 public constant MAX_TRANSFER_VALIDITY = 300;
    /// @notice Longest accepted validity window for a check-in permit, in seconds.
    uint256 public constant MAX_CHECK_IN_VALIDITY = 120;

    /// @notice The only account allowed to create events and issue tickets.
    address public immutable issuer;

    uint256 private _nextEventId = 1;
    uint256 private _nextTokenId = 1;

    mapping(uint256 eventId => EventInfo) private _events;
    mapping(uint256 tokenId => TicketInfo) private _tickets;
    /// @notice Token issued for a consumed order ID; zero means the order ID is unused.
    mapping(bytes32 orderId => uint256 tokenId) public orderToken;
    /// @dev Block numbers in which a ticket was minted, transferred or checked in. Lets any
    ///      client fetch the ticket's logs with single-block queries instead of a range scan.
    mapping(uint256 tokenId => uint64[]) private _activityBlocks;

    event EventCreated(uint256 indexed eventId, address indexed organiser, uint256 capacity);
    event TicketIssued(
        uint256 indexed eventId,
        uint256 indexed tokenId,
        address indexed recipient,
        bytes32 orderId,
        uint256 ticketNumber
    );
    event TicketCheckedIn(
        uint256 indexed eventId,
        uint256 indexed tokenId,
        address indexed owner,
        address gate,
        bytes32 requestId,
        uint256 checkedInAt
    );

    error NotIssuer(address caller);
    error ZeroAddress();
    error ZeroCapacity();
    error UnknownEvent(uint256 eventId);
    error OrderAlreadyIssued(bytes32 orderId, uint256 tokenId);
    error EventSoldOut(uint256 eventId);
    error WrongEvent(uint256 tokenId, uint256 expectedEventId);
    error TicketAlreadyUsed(uint256 tokenId);
    error NotTicketOwner(uint256 tokenId, address claimedOwner);
    error InvalidRecipient(address recipient);
    error StaleNonce(uint256 tokenId, uint256 currentNonce);
    error UnauthorisedGate(uint256 eventId, address gate);
    error HolderIsGate(address account);
    error InvalidValidityWindow();
    error PermitNotYetValid(uint256 issuedAt);
    error PermitExpired(uint256 deadline);
    error InvalidOwnerSignature();
    error InvalidGateSignature();
    error BurnDisabled();

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert NotIssuer(msg.sender);
        _;
    }

    constructor(address issuer_) ERC721("TicketLock Demo", "TLOCK") EIP712("TicketLock Demo", "2") {
        if (issuer_ == address(0)) revert ZeroAddress();
        issuer = issuer_;
    }

    // ───────────────────────────── Issuer actions ─────────────────────────────

    /// @notice Record a new event. The organiser is also the event's only authorised gate.
    function createEvent(address organiser, uint64 capacity)
        external
        onlyIssuer
        nonReentrant
        returns (uint256 eventId)
    {
        if (organiser == address(0)) revert ZeroAddress();
        if (capacity == 0) revert ZeroCapacity();
        eventId = _nextEventId++;
        _events[eventId] = EventInfo({organiser: organiser, capacity: capacity, mintedCount: 0, checkedInCount: 0});
        emit EventCreated(eventId, organiser, capacity);
    }

    /// @notice Mint one ticket for an order. Each order ID can be consumed once.
    function issueTicket(uint256 eventId, address recipient, bytes32 orderId)
        external
        onlyIssuer
        nonReentrant
        returns (uint256 tokenId)
    {
        EventInfo storage ev = _events[eventId];
        if (ev.organiser == address(0)) revert UnknownEvent(eventId);
        if (recipient == address(0)) revert ZeroAddress();
        uint256 issued = orderToken[orderId];
        if (issued != 0) revert OrderAlreadyIssued(orderId, issued);
        if (ev.mintedCount >= ev.capacity) revert EventSoldOut(eventId);

        tokenId = _nextTokenId++;
        uint64 ticketNumber = ++ev.mintedCount;
        orderToken[orderId] = tokenId;
        _tickets[tokenId] =
            TicketInfo({eventId: uint64(eventId), ticketNumber: ticketNumber, checkedInAt: 0, nonce: 0, used: false});
        emit TicketIssued(eventId, tokenId, recipient, orderId, ticketNumber);

        // State is final before the receiver callback runs.
        _safeMint(recipient, tokenId);
    }

    // ───────────────────────────── Signed actions ─────────────────────────────

    /// @notice Transfer a ticket using the current owner's signed permit.
    function transferWithPermit(TransferPermit calldata permit, bytes calldata ownerSignature) external nonReentrant {
        _checkWindow(permit.issuedAt, permit.deadline, MAX_TRANSFER_VALIDITY);
        address owner = _checkTicket(permit.tokenId, permit.eventId, permit.from, permit.ticketNonce);
        if (permit.to == address(0) || permit.to == permit.from) revert InvalidRecipient(permit.to);

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    TRANSFER_PERMIT_TYPEHASH,
                    permit.eventId,
                    permit.tokenId,
                    permit.from,
                    permit.to,
                    permit.ticketNonce,
                    permit.requestId,
                    permit.issuedAt,
                    permit.deadline
                )
            )
        );
        if (!_isSignedBy(digest, ownerSignature, owner)) revert InvalidOwnerSignature();

        // The signature replaces the ERC-721 operator check; _update bumps the nonce.
        _safeTransfer(owner, permit.to, permit.tokenId, "");
    }

    /// @notice Consume a ticket. Needs the current owner's and the event organiser's
    ///         signatures over the same permit.
    function checkIn(CheckInPermit calldata permit, bytes calldata ownerSignature, bytes calldata gateSignature)
        external
        nonReentrant
    {
        _checkWindow(permit.issuedAt, permit.deadline, MAX_CHECK_IN_VALIDITY);
        address owner = _checkTicket(permit.tokenId, permit.eventId, permit.owner, permit.ticketNonce);
        EventInfo storage ev = _events[permit.eventId];
        if (permit.gate != ev.organiser) revert UnauthorisedGate(permit.eventId, permit.gate);
        // Admission always takes two parties: one signature must never satisfy both roles.
        if (owner == ev.organiser) revert HolderIsGate(owner);

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    CHECK_IN_PERMIT_TYPEHASH,
                    permit.eventId,
                    permit.tokenId,
                    permit.owner,
                    permit.gate,
                    permit.ticketNonce,
                    permit.requestId,
                    permit.issuedAt,
                    permit.deadline
                )
            )
        );
        if (!_isSignedBy(digest, ownerSignature, owner)) revert InvalidOwnerSignature();
        if (!_isSignedBy(digest, gateSignature, ev.organiser)) revert InvalidGateSignature();

        TicketInfo storage ticket = _tickets[permit.tokenId];
        ticket.used = true;
        ticket.checkedInAt = uint64(block.timestamp);
        ticket.nonce += 1;
        ev.checkedInCount += 1;
        _recordActivity(permit.tokenId);
        emit TicketCheckedIn(permit.eventId, permit.tokenId, owner, permit.gate, permit.requestId, block.timestamp);
    }

    // ───────────────────────────────── Reads ──────────────────────────────────

    function eventCount() external view returns (uint256) {
        return _nextEventId - 1;
    }

    function getEvent(uint256 eventId) external view returns (EventInfo memory) {
        EventInfo memory ev = _events[eventId];
        if (ev.organiser == address(0)) revert UnknownEvent(eventId);
        return ev;
    }

    function getTicket(uint256 tokenId) public view returns (TicketView memory) {
        address owner = _requireOwned(tokenId);
        TicketInfo memory t = _tickets[tokenId];
        return TicketView({
            tokenId: tokenId,
            eventId: t.eventId,
            ticketNumber: t.ticketNumber,
            owner: owner,
            used: t.used,
            checkedInAt: t.checkedInAt,
            nonce: t.nonce
        });
    }

    function ticketNonce(uint256 tokenId) external view returns (uint256) {
        _requireOwned(tokenId);
        return _tickets[tokenId].nonce;
    }

    /// @notice Every ticket currently held by an address, with its live state.
    function ticketsOf(address owner) external view returns (TicketView[] memory tickets) {
        uint256 count = balanceOf(owner);
        tickets = new TicketView[](count);
        for (uint256 i = 0; i < count; i++) {
            tickets[i] = getTicket(tokenOfOwnerByIndex(owner, i));
        }
    }

    /// @notice Block numbers holding this ticket's mint, transfer and check-in logs.
    function activityBlocks(uint256 tokenId) external view returns (uint64[] memory) {
        _requireOwned(tokenId);
        return _activityBlocks[tokenId];
    }

    /// @notice Fixed-style on-chain metadata. Admission validity is read from getTicket.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        TicketInfo memory t = _tickets[tokenId];
        string memory eventLabel = uint256(t.eventId).toString();
        string memory numberLabel = uint256(t.ticketNumber).toString();
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 360" font-family="Helvetica,Arial,sans-serif">',
            '<rect width="600" height="360" rx="24" fill="#0E1512"/>',
            '<rect x="36" y="36" width="52" height="52" rx="12" fill="#20E3A2"/>',
            '<text x="104" y="72" font-size="28" font-weight="700" fill="#FFFFFF">TicketLock</text>',
            '<text x="36" y="188" font-size="20" fill="#8FA39A">EVENT</text>',
            '<text x="36" y="250" font-size="64" font-weight="700" fill="#FFFFFF">#',
            eventLabel,
            '</text><text x="330" y="188" font-size="20" fill="#8FA39A">TICKET</text>',
            '<text x="330" y="250" font-size="64" font-weight="700" fill="#20E3A2">#',
            numberLabel,
            '</text><text x="36" y="316" font-size="18" fill="#8FA39A">General admission \u00b7 Demo ticket</text></svg>'
        );
        string memory json = string.concat(
            '{"name":"TicketLock Demo \u2014 Event #',
            eventLabel,
            " Ticket #",
            numberLabel,
            '","description":"Demo general-admission ticket. Read getTicket on the contract for live admission state.",',
            '"attributes":[{"trait_type":"Event ID","value":"',
            eventLabel,
            '"},{"trait_type":"Ticket number","value":"',
            numberLabel,
            '"}],"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    // ─────────────────────────────── Internals ────────────────────────────────

    /// @dev Single path for every mint and transfer, including standard ERC-721 methods.
    ///      Existing tickets cannot move once used, cannot be burned, and each successful
    ///      move bumps the nonce exactly once so earlier permits go stale.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0)) {
            if (to == address(0)) revert BurnDisabled();
            TicketInfo storage ticket = _tickets[tokenId];
            if (ticket.used) revert TicketAlreadyUsed(tokenId);
            ticket.nonce += 1;
        }
        _recordActivity(tokenId);
    }

    function _recordActivity(uint256 tokenId) private {
        uint64[] storage blocks = _activityBlocks[tokenId];
        uint64 current = uint64(block.number);
        if (blocks.length == 0 || blocks[blocks.length - 1] != current) blocks.push(current);
    }

    function _checkWindow(uint256 issuedAt, uint256 deadline, uint256 maxValidity) private view {
        if (deadline <= issuedAt || deadline - issuedAt > maxValidity) revert InvalidValidityWindow();
        if (block.timestamp < issuedAt) revert PermitNotYetValid(issuedAt);
        if (block.timestamp > deadline) revert PermitExpired(deadline);
    }

    /// @dev Shared permit checks: ticket exists, belongs to the signed event, is unused,
    ///      and the signed owner and nonce are current.
    function _checkTicket(uint256 tokenId, uint256 eventId, address claimedOwner, uint256 nonce)
        private
        view
        returns (address owner)
    {
        owner = _requireOwned(tokenId);
        TicketInfo storage ticket = _tickets[tokenId];
        if (ticket.eventId != eventId) revert WrongEvent(tokenId, ticket.eventId);
        if (ticket.used) revert TicketAlreadyUsed(tokenId);
        if (claimedOwner != owner) revert NotTicketOwner(tokenId, claimedOwner);
        if (nonce != ticket.nonce) revert StaleNonce(tokenId, ticket.nonce);
    }

    function _isSignedBy(bytes32 digest, bytes calldata signature, address expected) private pure returns (bool) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        return err == ECDSA.RecoverError.NoError && recovered == expected;
    }
}
