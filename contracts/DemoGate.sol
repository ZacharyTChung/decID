// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CredentialRegistry} from "./CredentialRegistry.sol";

/// @title DemoGate
/// @notice One real gated action: a "verified member" check-in that only a
/// wallet holding a currently valid credential of the required schema can perform.
/// The gate trusts the registry's state; it never sees the credential itself.
contract DemoGate {
    CredentialRegistry public immutable registry;
    bytes32 public immutable requiredSchema;

    mapping(address member => uint256) public checkIns;

    event MemberCheckedIn(address indexed member, bytes32 indexed commitment, uint256 count);

    /// `status` is CredentialRegistry.Status; `wrongHolderOrSchema` distinguishes
    /// a record that exists and may be active but belongs to someone else or another schema.
    error AccessDenied(CredentialRegistry.Status status, bool wrongHolderOrSchema);

    constructor(CredentialRegistry registry_, bytes32 requiredSchema_) {
        registry = registry_;
        requiredSchema = requiredSchema_;
    }

    function checkIn(bytes32 commitment) external returns (uint256 count) {
        if (!registry.isCredentialValid(commitment, msg.sender, requiredSchema)) {
            CredentialRegistry.Record memory r = registry.getRecord(commitment);
            bool mismatch = r.holder != address(0) && (r.holder != msg.sender || r.schemaId != requiredSchema);
            revert AccessDenied(registry.credentialStatus(commitment), mismatch);
        }
        count = ++checkIns[msg.sender];
        emit MemberCheckedIn(msg.sender, commitment, count);
    }
}
