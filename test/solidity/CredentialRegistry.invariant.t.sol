// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CredentialRegistry} from "../../contracts/CredentialRegistry.sol";

/// Drives random sequences of registry operations. The invariant test below checks
/// system-wide properties after every call of every sequence.
contract RegistryHandler is Test {
    CredentialRegistry public immutable registry;
    uint256 internal constant ISSUER_KEY = 0xB0B;
    address public immutable issuer;
    bytes32 public constant SCHEMA = keccak256("schema:v1");

    bytes32[] public commitments;
    mapping(bytes32 => bool) public ghostRevoked;
    /// Replayed registrations that unexpectedly succeeded. Must stay 0.
    uint256 public unexpectedReRegistrations;
    uint256 internal nonce;

    address[3] internal holders = [address(0xA1), address(0xA2), address(0xA3)];

    constructor() {
        registry = new CredentialRegistry(address(this), keccak256("invariant-deployment"));
        issuer = vm.addr(ISSUER_KEY);
        registry.addIssuer(issuer);
    }

    function commitmentCount() external view returns (uint256) {
        return commitments.length;
    }

    function _signed(bytes32 c, address holder, uint64 expiresAt)
        internal
        view
        returns (CredentialRegistry.RegistrationAuthorization memory a, bytes memory sig)
    {
        (, uint64 epoch) = registry.issuerState(issuer);
        a = CredentialRegistry.RegistrationAuthorization({
            commitment: c,
            holder: holder,
            issuer: issuer,
            schemaId: SCHEMA,
            validFrom: uint64(block.timestamp),
            expiresAt: expiresAt,
            issuerEpoch: epoch,
            deadline: uint64(block.timestamp) + 1 days,
            deploymentId: registry.deploymentId()
        });
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.domainSeparator(), registry.hashAuthorization(a)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ISSUER_KEY, digest);
        sig = abi.encodePacked(r, s, v);
    }

    // ------------------------------------------------------------------ actions

    function register(uint8 holderSeed, uint32 duration) external {
        (bool active, ) = registry.issuerState(issuer);
        if (!active) return; // registration requires an active issuer; covered by other tests
        bytes32 c = keccak256(abi.encode("commitment", nonce++));
        address holder = holders[holderSeed % 3];
        uint64 expiresAt = uint64(block.timestamp) + uint64(bound(duration, 1, 30 days));
        (CredentialRegistry.RegistrationAuthorization memory a, bytes memory sig) = _signed(c, holder, expiresAt);
        vm.prank(holder);
        registry.register(a, sig);
        commitments.push(c);
    }

    function revoke(uint256 index) external {
        if (commitments.length == 0) return;
        bytes32 c = commitments[index % commitments.length];
        if (ghostRevoked[c]) return;
        vm.prank(issuer);
        registry.revoke(c);
        ghostRevoked[c] = true;
    }

    function removeIssuer() external {
        (bool active, ) = registry.issuerState(issuer);
        if (active) registry.removeIssuer(issuer);
    }

    function addIssuer() external {
        (bool active, ) = registry.issuerState(issuer);
        if (!active) registry.addIssuer(issuer);
    }

    function passTime(uint32 secondsForward) external {
        vm.warp(block.timestamp + bound(secondsForward, 0, 10 days));
    }

    /// Attempts to register an existing commitment again with a fresh, validly signed authorization.
    function replay(uint256 index, uint8 holderSeed) external {
        if (commitments.length == 0) return;
        (bool active, ) = registry.issuerState(issuer);
        if (!active) return;
        bytes32 c = commitments[index % commitments.length];
        address holder = holders[holderSeed % 3];
        (CredentialRegistry.RegistrationAuthorization memory a, bytes memory sig) = _signed(c, holder, uint64(block.timestamp) + 1 days);
        vm.prank(holder);
        try registry.register(a, sig) {
            unexpectedReRegistrations++;
        } catch {}
    }
}

contract CredentialRegistryInvariantTest is Test {
    RegistryHandler internal handler;
    CredentialRegistry internal registry;

    function setUp() public {
        vm.warp(1_800_000_000);
        handler = new RegistryHandler();
        registry = handler.registry();
        targetContract(address(handler));
    }

    /// A revoked credential is never valid again, whatever happened afterwards.
    function invariant_RevokedIsNeverValid() public view {
        for (uint256 i = 0; i < handler.commitmentCount(); i++) {
            bytes32 c = handler.commitments(i);
            if (!handler.ghostRevoked(c)) continue;
            CredentialRegistry.Record memory r = registry.getRecord(c);
            assertFalse(registry.isCredentialValid(c, r.holder, handler.SCHEMA()));
            assertEq(uint8(registry.credentialStatus(c)), uint8(CredentialRegistry.Status.Revoked));
        }
    }

    /// Validity implies every precondition: not revoked, issuer active in the same epoch, inside the window.
    function invariant_ValidImpliesAllConditions() public view {
        (bool active, uint64 epoch) = registry.issuerState(handler.issuer());
        for (uint256 i = 0; i < handler.commitmentCount(); i++) {
            bytes32 c = handler.commitments(i);
            CredentialRegistry.Record memory r = registry.getRecord(c);
            if (!registry.isCredentialValid(c, r.holder, handler.SCHEMA())) continue;
            assertFalse(r.revoked);
            assertTrue(active);
            assertEq(r.issuerEpoch, epoch);
            assertGe(block.timestamp, r.validFrom);
            assertLt(block.timestamp, r.expiresAt);
        }
    }

    /// Records from an earlier issuer epoch (issuer removed since) never become valid again.
    function invariant_RemovalIsNeverUndone() public view {
        (, uint64 epoch) = registry.issuerState(handler.issuer());
        for (uint256 i = 0; i < handler.commitmentCount(); i++) {
            bytes32 c = handler.commitments(i);
            CredentialRegistry.Record memory r = registry.getRecord(c);
            if (r.issuerEpoch < epoch) assertFalse(registry.isCredentialValid(c, r.holder, handler.SCHEMA()));
        }
    }

    /// No commitment was ever registered twice.
    function invariant_NoReRegistration() public view {
        assertEq(handler.unexpectedReRegistrations(), 0);
    }
}
