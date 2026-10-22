// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CredentialRegistry} from "../../contracts/CredentialRegistry.sol";
import {DemoGate} from "../../contracts/DemoGate.sol";

/// Property-based (fuzz) tests for the registry's security properties. Each test runs on
/// many random inputs (see `test.solidity.fuzz` in hardhat.config.ts). They complement the
/// example-based tests in test/contracts/registry.test.ts.
contract CredentialRegistryFuzzTest is Test {
    CredentialRegistry internal registry;
    DemoGate internal gate;
    uint256 internal constant ISSUER_KEY = 0xA11CE;
    address internal issuer;
    bytes32 internal constant SCHEMA = keccak256("https://did-mvp.invalid/schemas/identity-verified/v1.json");
    uint64 internal constant T0 = 1_800_000_000;

    function setUp() public {
        vm.warp(T0);
        registry = new CredentialRegistry(address(this), keccak256("fuzz-deployment"));
        issuer = vm.addr(ISSUER_KEY);
        registry.addIssuer(issuer);
        gate = new DemoGate(registry, SCHEMA);
    }

    // ------------------------------------------------------------------ helpers

    function _auth(bytes32 commitment, address holder, uint64 validFrom, uint64 expiresAt)
        internal
        view
        returns (CredentialRegistry.RegistrationAuthorization memory a)
    {
        (, uint64 epoch) = registry.issuerState(issuer);
        a = CredentialRegistry.RegistrationAuthorization({
            commitment: commitment,
            holder: holder,
            issuer: issuer,
            schemaId: SCHEMA,
            validFrom: validFrom,
            expiresAt: expiresAt,
            issuerEpoch: epoch,
            deadline: uint64(block.timestamp) + 1 days,
            deploymentId: registry.deploymentId()
        });
    }

    function _sign(uint256 key, CredentialRegistry.RegistrationAuthorization memory a) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.domainSeparator(), registry.hashAuthorization(a)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _register(bytes32 commitment, address holder, uint64 validFrom, uint64 expiresAt)
        internal
        returns (CredentialRegistry.RegistrationAuthorization memory a)
    {
        a = _auth(commitment, holder, validFrom, expiresAt);
        bytes memory sig = _sign(ISSUER_KEY, a);
        vm.prank(holder);
        registry.register(a, sig);
    }

    function _holder(address h) internal pure returns (address) {
        return h == address(0) ? address(1) : h;
    }

    function _commitment(bytes32 c) internal pure returns (bytes32) {
        return c == bytes32(0) ? bytes32(uint256(1)) : c;
    }

    // ------------------------------------------------------------------ properties

    /// A commitment that was never registered is never valid, for any holder or schema.
    function testFuzz_MissingRecordIsNeverValid(bytes32 commitment, address holder, bytes32 schema) public view {
        assertFalse(registry.isCredentialValid(commitment, holder, schema));
        assertEq(uint8(registry.credentialStatus(commitment)), uint8(CredentialRegistry.Status.None));
    }

    /// A registered credential is valid only for its own holder and schema.
    function testFuzz_ValidityIsBoundToHolderAndSchema(bytes32 c, address h, address other, bytes32 otherSchema) public {
        c = _commitment(c);
        h = _holder(h);
        vm.assume(other != h && otherSchema != SCHEMA);
        _register(c, h, T0, T0 + 365 days);
        assertTrue(registry.isCredentialValid(c, h, SCHEMA));
        assertFalse(registry.isCredentialValid(c, other, SCHEMA));
        assertFalse(registry.isCredentialValid(c, h, otherSchema));
    }

    /// Validity is exactly the half-open window [validFrom, expiresAt).
    function testFuzz_ValidityWindowIsHalfOpen(uint32 startOffset, uint32 duration, uint64 probe) public {
        uint64 validFrom = T0 + uint64(startOffset);
        uint64 expiresAt = validFrom + uint64(bound(duration, 1, type(uint32).max));
        bytes32 c = keccak256(abi.encode(startOffset, duration));
        _register(c, address(0xBEEF), validFrom, expiresAt);
        probe = uint64(bound(probe, T0, uint256(expiresAt) + 365 days));
        vm.warp(probe);
        bool expected = probe >= validFrom && probe < expiresAt;
        assertEq(registry.isCredentialValid(c, address(0xBEEF), SCHEMA), expected);
    }

    /// A commitment can be registered once, ever: any later attempt (any holder, fresh signature) reverts.
    function testFuzz_CommitmentIsSingleUse(bytes32 c, address h, address h2) public {
        c = _commitment(c);
        h = _holder(h);
        h2 = _holder(h2);
        _register(c, h, T0, T0 + 30 days);
        CredentialRegistry.RegistrationAuthorization memory again = _auth(c, h2, T0, T0 + 60 days);
        bytes memory sig = _sign(ISSUER_KEY, again);
        vm.prank(h2);
        vm.expectRevert(abi.encodeWithSelector(CredentialRegistry.AlreadyRegistered.selector, c));
        registry.register(again, sig);
    }

    /// No key other than the trusted issuer's can authorize a registration.
    function testFuzz_OnlyTheIssuerKeyAuthorizes(uint256 key, bytes32 c) public {
        key = bound(key, 1, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140);
        vm.assume(key != ISSUER_KEY);
        c = _commitment(c);
        CredentialRegistry.RegistrationAuthorization memory a = _auth(c, address(0xBEEF), T0, T0 + 30 days);
        bytes memory sig = _sign(key, a);
        vm.prank(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSelector(CredentialRegistry.SignerNotIssuer.selector, vm.addr(key), issuer));
        registry.register(a, sig);
    }

    /// Once revoked, a credential is invalid at every later time, and the gate refuses it.
    function testFuzz_RevocationIsPermanent(bytes32 c, uint64 later) public {
        c = _commitment(c);
        _register(c, address(0xBEEF), T0, T0 + 365 days);
        vm.prank(issuer);
        registry.revoke(c);
        vm.warp(bound(later, T0, uint256(T0) + 10 * 365 days));
        assertFalse(registry.isCredentialValid(c, address(0xBEEF), SCHEMA));
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        gate.checkIn(c);
    }

    /// Only the record's issuer can revoke; any other caller is rejected.
    function testFuzz_OnlyTheIssuerRevokes(bytes32 c, address caller) public {
        c = _commitment(c);
        vm.assume(caller != issuer);
        _register(c, address(0xBEEF), T0, T0 + 365 days);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(CredentialRegistry.NotCredentialIssuer.selector, caller, issuer));
        registry.revoke(c);
    }

    /// A cancellation by a different (also trusted) issuer never blocks this issuer's authorization.
    function testFuzz_CancellationIsScopedToTheCancellingIssuer(bytes32 c, address otherIssuer) public {
        c = _commitment(c);
        vm.assume(otherIssuer != issuer && otherIssuer != address(0));
        registry.addIssuer(otherIssuer);
        vm.prank(otherIssuer);
        registry.cancelAuthorization(c);
        _register(c, address(0xBEEF), T0, T0 + 30 days);
        assertTrue(registry.isCredentialValid(c, address(0xBEEF), SCHEMA));
    }
}
