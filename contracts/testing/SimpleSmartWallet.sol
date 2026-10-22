// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title SimpleSmartWallet (TEST FIXTURE ONLY)
/// @notice A minimal contract account used to test smart-account holders. One owner key
/// signs for it via EIP-1271 and can make calls through it, so `msg.sender` at the
/// registry and gate is the wallet itself.
///
/// Not for real use: production smart accounts (Safe, ERC-4337 accounts, passkey wallets)
/// add replay protection such as ERC-7739 nested typed-data hashing, multiple signers,
/// modules and recovery. This fixture deliberately validates the raw hash.
contract SimpleSmartWallet is IERC1271 {
    address public immutable owner;

    error NotOwner();

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecoverCalldata(hash, signature);
        return err == ECDSA.RecoverError.NoError && recovered == owner ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }

    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        if (msg.sender != owner) revert NotOwner();
        bool ok;
        (ok, result) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }
}
