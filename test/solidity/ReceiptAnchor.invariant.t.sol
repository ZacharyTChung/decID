// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ReceiptAnchor} from "../../contracts/ReceiptAnchor.sol";

/// Random sequences of anchoring attempts, including rewrites and truncations (which must
/// revert). After every call the invariants below must hold.
contract AnchorHandler is Test {
    ReceiptAnchor public immutable anchor;
    bytes32[3] public streams = [keccak256("s0"), keccak256("s1"), keccak256("s2")];

    /// What a correct anchor must report, tracked independently.
    mapping(bytes32 => uint64) public ghostCount;
    mapping(bytes32 => mapping(uint64 => bytes32)) public ghostHead;
    mapping(bytes32 => uint64[]) internal ghostCounts;
    /// Rewrites or truncations that unexpectedly succeeded. Must stay 0.
    uint256 public unexpectedAccepts;

    constructor() {
        anchor = new ReceiptAnchor(address(this));
        anchor.grantRole(anchor.ANCHORER_ROLE(), address(this));
    }

    function countsOf(uint256 i) external view returns (uint64[] memory) {
        return ghostCounts[streams[i % 3]];
    }

    /// Extend a stream by 1..50 entries with a fresh head.
    function extend(uint8 s, uint8 by, bytes32 h) external {
        if (h == bytes32(0)) h = keccak256("nonzero");
        bytes32 stream = streams[s % 3];
        uint64 next = ghostCount[stream] + uint64(bound(by, 1, 50));
        anchor.anchor(stream, next, h);
        ghostCount[stream] = next;
        ghostHead[stream][next] = h;
        ghostCounts[stream].push(next);
    }

    /// Try to rewrite the current checkpoint or move a stream backwards: must revert.
    function rewrite(uint8 s, uint8 back, bytes32 h) external {
        bytes32 stream = streams[s % 3];
        uint64 current = ghostCount[stream];
        uint64 target = current - uint64(bound(back, 0, current));
        if (h == bytes32(0)) h = keccak256("other");
        try anchor.anchor(stream, target, h) {
            unexpectedAccepts += 1;
        } catch {}
    }
}

contract ReceiptAnchorInvariantTest is Test {
    AnchorHandler internal handler;

    function setUp() public {
        handler = new AnchorHandler();
        targetContract(address(handler));
    }

    /// No rewrite or truncation was ever accepted.
    function invariant_historyIsAppendOnly() public view {
        assertEq(handler.unexpectedAccepts(), 0);
    }

    /// The latest checkpoint and every past checkpoint match what was anchored.
    function invariant_checkpointsNeverChange() public view {
        for (uint256 i = 0; i < 3; i++) {
            bytes32 stream = handler.streams(i);
            ReceiptAnchor.Checkpoint memory l = handler.anchor().latest(stream);
            assertEq(l.count, handler.ghostCount(stream));
            uint64[] memory counts = handler.countsOf(i);
            assertEq(handler.anchor().checkpointCount(stream), counts.length);
            for (uint256 j = 0; j < counts.length; j++) {
                assertEq(handler.anchor().headAt(stream, counts[j]), handler.ghostHead(stream, counts[j]));
            }
        }
    }
}
