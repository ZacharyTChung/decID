// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ReceiptAnchor
/// @notice Public checkpoints for append-only, hash-chained logs kept off-chain: each business's
/// decID Verify compliance receipts, and the issuer's audit log.
///
/// Off-chain, every log entry names the hash of the entry before it, so an edit in the middle
/// breaks the chain. Two things a hash chain alone cannot catch:
///   1. the operator re-signing and rewriting history (the chain is internally consistent again);
///   2. the newest entries being dropped (a shorter chain is still a valid chain).
/// Anchoring the head (hash of the newest entry) and the entry count here fixes both: anyone can
/// check a log against every checkpoint, and a checkpoint can never be rolled back or replaced.
///
/// Privacy: a stream id is a hash of a label such as "decid:receipts:<merchant id>", and a head
/// is a SHA-256 hash of a signed receipt. Neither contains personal data. Counts reveal how many
/// checks a business has run.
contract ReceiptAnchor is AccessControl {
    bytes32 public constant ANCHORER_ROLE = keccak256("ANCHORER_ROLE");

    struct Checkpoint {
        bytes32 head;
        uint64 count;
        uint64 anchoredAt;
    }

    mapping(bytes32 stream => Checkpoint) private _latest;
    mapping(bytes32 stream => mapping(uint64 count => bytes32 head)) private _heads;
    mapping(bytes32 stream => uint64) private _checkpoints;

    event Anchored(bytes32 indexed stream, uint64 indexed count, bytes32 head, address indexed anchorer);

    error EmptyHead();
    error CountNotIncreasing(uint64 previous, uint64 proposed);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Records that `stream` had `count` entries and its newest entry hashed to `head`.
    /// Counts must strictly increase: history can be extended, never rewritten or shortened.
    function anchor(bytes32 stream, uint64 count, bytes32 head) external onlyRole(ANCHORER_ROLE) {
        if (head == bytes32(0)) revert EmptyHead();
        uint64 previous = _latest[stream].count;
        if (count <= previous) revert CountNotIncreasing(previous, count);
        _latest[stream] = Checkpoint(head, count, uint64(block.timestamp));
        _heads[stream][count] = head;
        _checkpoints[stream] += 1;
        emit Anchored(stream, count, head, msg.sender);
    }

    /// @notice The most recent checkpoint of a stream (all zero if never anchored).
    function latest(bytes32 stream) external view returns (Checkpoint memory) {
        return _latest[stream];
    }

    /// @notice The head anchored for `stream` at exactly `count` entries (zero if none).
    function headAt(bytes32 stream, uint64 count) external view returns (bytes32) {
        return _heads[stream][count];
    }

    /// @notice How many checkpoints a stream has.
    function checkpointCount(bytes32 stream) external view returns (uint64) {
        return _checkpoints[stream];
    }
}
