// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title CredentialRegistry
/// @notice Public status registry for off-chain, issuer-signed credentials.
///
/// The registry never sees a credential. It stores a randomized commitment
///   commitment = keccak256(abi.encode(COMMITMENT_DOMAIN, salt, keccak256(tokenBytes)))
/// together with the holder, issuer, schema identifier, validity window and
/// revocation state. A registration is accepted only when it carries an EIP-712
/// authorization signed by a currently trusted issuer and is submitted by the
/// holder it names.
///
/// What this contract proves: a trusted issuer authorized this exact
/// (commitment, holder, schema, window) tuple and has not revoked it.
/// What it does NOT prove: anything about the contents of the off-chain
/// credential, or that anyone's real-world identity documents are authentic.
///
/// Issuer removal policy: removing an issuer increments its epoch. Records and
/// authorizations from an earlier epoch are permanently invalid, so re-adding an
/// issuer never resurrects credentials issued before the removal. Individual
/// revocations are permanent and are never cleared.
contract CredentialRegistry is AccessControl, EIP712 {
    /// @notice Documentation-only constant: the domain separator the off-chain
    /// commitment construction uses. The contract never recomputes commitments.
    bytes32 public constant COMMITMENT_DOMAIN = keccak256("did-mvp:credential-commitment:v1");

    bytes32 public constant REGISTRATION_TYPEHASH = keccak256(
        "RegistrationAuthorization(bytes32 commitment,address holder,address issuer,bytes32 schemaId,uint64 validFrom,uint64 expiresAt,uint64 issuerEpoch,uint64 deadline,bytes32 deploymentId)"
    );

    /// Status codes returned by credentialStatus. Ordered by check precedence.
    enum Status {
        None, // 0: no record for this commitment
        Active, // 1: valid right now
        Revoked, // 2: revoked by its issuer or an admin
        IssuerInactive, // 3: issuer removed, or record from an earlier issuer epoch
        NotYetValid, // 4: block.timestamp < validFrom
        Expired // 5: block.timestamp >= expiresAt
    }

    struct RegistrationAuthorization {
        bytes32 commitment;
        address holder;
        address issuer;
        bytes32 schemaId;
        uint64 validFrom;
        uint64 expiresAt;
        uint64 issuerEpoch;
        uint64 deadline;
        bytes32 deploymentId;
    }

    struct Record {
        address holder;
        address issuer;
        bytes32 schemaId;
        uint64 validFrom;
        uint64 expiresAt;
        uint64 issuerEpoch;
        uint64 registeredAt;
        bool revoked;
    }

    struct IssuerState {
        bool active;
        uint64 epoch;
    }

    mapping(bytes32 commitment => Record) private _records;
    mapping(address issuer => IssuerState) private _issuers;
    /// Unregistered authorizations an issuer has withdrawn (e.g. the holder's wallet was lost).
    mapping(bytes32 commitment => address issuer) private _cancelledBy;

    event IssuerAdded(address indexed issuer, uint64 epoch);
    event IssuerRemoved(address indexed issuer, uint64 newEpoch);
    event CredentialRegistered(
        bytes32 indexed commitment,
        address indexed holder,
        address indexed issuer,
        bytes32 schemaId,
        uint64 validFrom,
        uint64 expiresAt
    );
    event CredentialRevoked(bytes32 indexed commitment, address indexed revokedBy, bool adminOverride);
    event AuthorizationCancelled(bytes32 indexed commitment, address indexed issuer);

    error ZeroAddress();
    error ZeroDeploymentId();
    error WrongDeployment(bytes32 signed, bytes32 actual);
    error ZeroCommitment();
    error IssuerAlreadyActive(address issuer);
    error IssuerNotActive(address issuer);
    error StaleIssuerEpoch(uint64 signed, uint64 current);
    error SenderNotHolder(address sender, address holder);
    error AuthorizationExpired(uint64 deadline);
    error InvalidValidityWindow(uint64 validFrom, uint64 expiresAt);
    error CredentialAlreadyExpired(uint64 expiresAt);
    error SignerNotIssuer(address recovered, address issuer);
    error AlreadyRegistered(bytes32 commitment);
    error UnknownCredential(bytes32 commitment);
    error NotCredentialIssuer(address sender, address issuer);
    error AlreadyRevoked(bytes32 commitment);
    error AuthorizationWasCancelled(bytes32 commitment);

    /// @notice Random per-deployment value, signed into every authorization. A
    /// local chain restarts with the same deployer nonce, so the registry address
    /// (and thus the EIP-712 domain) repeats across restarts; this value does not,
    /// so authorizations from an earlier deployment can never be replayed here.
    bytes32 public immutable deploymentId;

    constructor(address admin, bytes32 deploymentId_) EIP712("CredentialRegistry", "1") {
        if (admin == address(0)) revert ZeroAddress();
        if (deploymentId_ == bytes32(0)) revert ZeroDeploymentId();
        deploymentId = deploymentId_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------- admin

    function addIssuer(address issuer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (issuer == address(0)) revert ZeroAddress();
        IssuerState storage s = _issuers[issuer];
        if (s.active) revert IssuerAlreadyActive(issuer);
        s.active = true;
        emit IssuerAdded(issuer, s.epoch);
    }

    /// @notice Removes an issuer and permanently invalidates every record and
    /// unsubmitted authorization from its current epoch.
    function removeIssuer(address issuer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IssuerState storage s = _issuers[issuer];
        if (!s.active) revert IssuerNotActive(issuer);
        s.active = false;
        s.epoch += 1;
        emit IssuerRemoved(issuer, s.epoch);
    }

    /// @notice Explicit admin override: revoke any registered credential.
    function adminRevoke(bytes32 commitment) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revoke(commitment, true);
    }

    // ---------------------------------------------------------------- holder

    /// @notice Registers an issuer-authorized credential commitment. Must be
    /// sent by the holder named in the authorization.
    function register(RegistrationAuthorization calldata auth, bytes calldata signature) external {
        if (auth.commitment == bytes32(0)) revert ZeroCommitment();
        if (auth.holder == address(0) || auth.issuer == address(0)) revert ZeroAddress();
        if (msg.sender != auth.holder) revert SenderNotHolder(msg.sender, auth.holder);
        if (auth.deploymentId != deploymentId) revert WrongDeployment(auth.deploymentId, deploymentId);
        if (block.timestamp > auth.deadline) revert AuthorizationExpired(auth.deadline);
        if (auth.validFrom >= auth.expiresAt) revert InvalidValidityWindow(auth.validFrom, auth.expiresAt);
        if (block.timestamp >= auth.expiresAt) revert CredentialAlreadyExpired(auth.expiresAt);

        IssuerState memory s = _issuers[auth.issuer];
        if (!s.active) revert IssuerNotActive(auth.issuer);
        if (auth.issuerEpoch != s.epoch) revert StaleIssuerEpoch(auth.issuerEpoch, s.epoch);

        // An issuer can withdraw an authorization before it is used (cancelAuthorization).
        if (_cancelledBy[auth.commitment] == auth.issuer) revert AuthorizationWasCancelled(auth.commitment);

        // Replay protection: a commitment can be registered exactly once, ever.
        // Revoked records keep occupying their slot, so they cannot be re-registered.
        if (_records[auth.commitment].holder != address(0)) revert AlreadyRegistered(auth.commitment);

        bytes32 digest = _hashTypedDataV4(hashAuthorization(auth));
        // OpenZeppelin ECDSA rejects malformed lengths, invalid v, and high-s (malleable) signatures.
        address recovered = ECDSA.recoverCalldata(digest, signature);
        if (recovered != auth.issuer) revert SignerNotIssuer(recovered, auth.issuer);

        _records[auth.commitment] = Record({
            holder: auth.holder,
            issuer: auth.issuer,
            schemaId: auth.schemaId,
            validFrom: auth.validFrom,
            expiresAt: auth.expiresAt,
            issuerEpoch: auth.issuerEpoch,
            registeredAt: uint64(block.timestamp),
            revoked: false
        });
        emit CredentialRegistered(
            auth.commitment, auth.holder, auth.issuer, auth.schemaId, auth.validFrom, auth.expiresAt
        );
    }

    // ---------------------------------------------------------------- issuer

    /// @notice Revokes a credential. Only the issuer that authorized it may call
    /// this; a removed issuer may still revoke its own records.
    function revoke(bytes32 commitment) external {
        Record storage r = _records[commitment];
        if (r.holder == address(0)) revert UnknownCredential(commitment);
        if (msg.sender != r.issuer) revert NotCredentialIssuer(msg.sender, r.issuer);
        _revoke(commitment, false);
    }

    /// @notice Withdraws an authorization this issuer signed but the holder has not registered
    /// yet, e.g. when the holder lost the wallet and the credential is reissued elsewhere.
    /// Scoped to the caller: it blocks only authorizations whose `issuer` is msg.sender,
    /// so one issuer cannot interfere with another's. Registered records use revoke().
    function cancelAuthorization(bytes32 commitment) external {
        if (!_issuers[msg.sender].active) revert IssuerNotActive(msg.sender);
        if (_records[commitment].holder != address(0)) revert AlreadyRegistered(commitment);
        _cancelledBy[commitment] = msg.sender;
        emit AuthorizationCancelled(commitment, msg.sender);
    }

    // ---------------------------------------------------------------- views

    function isAuthorizationCancelled(bytes32 commitment, address issuer) external view returns (bool) {
        return issuer != address(0) && _cancelledBy[commitment] == issuer;
    }

    function hashAuthorization(RegistrationAuthorization calldata auth) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                REGISTRATION_TYPEHASH,
                auth.commitment,
                auth.holder,
                auth.issuer,
                auth.schemaId,
                auth.validFrom,
                auth.expiresAt,
                auth.issuerEpoch,
                auth.deadline,
                auth.deploymentId
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function getRecord(bytes32 commitment) external view returns (Record memory) {
        return _records[commitment];
    }

    function issuerState(address issuer) external view returns (bool active, uint64 epoch) {
        IssuerState memory s = _issuers[issuer];
        return (s.active, s.epoch);
    }

    function credentialStatus(bytes32 commitment) public view returns (Status) {
        Record memory r = _records[commitment];
        if (r.holder == address(0)) return Status.None;
        if (r.revoked) return Status.Revoked;
        IssuerState memory s = _issuers[r.issuer];
        if (!s.active || s.epoch != r.issuerEpoch) return Status.IssuerInactive;
        if (block.timestamp < r.validFrom) return Status.NotYetValid;
        if (block.timestamp >= r.expiresAt) return Status.Expired;
        return Status.Active;
    }

    /// @notice True only if the record exists, is unrevoked, its issuer is
    /// active in the same epoch, the current time is inside [validFrom, expiresAt),
    /// and it belongs to `holder` with schema `schemaId`. Missing records are never valid.
    function isCredentialValid(bytes32 commitment, address holder, bytes32 schemaId) public view returns (bool) {
        Record memory r = _records[commitment];
        if (holder == address(0) || r.holder != holder || r.schemaId != schemaId) return false;
        return credentialStatus(commitment) == Status.Active;
    }

    // ---------------------------------------------------------------- internal

    function _revoke(bytes32 commitment, bool adminOverride) private {
        Record storage r = _records[commitment];
        if (r.holder == address(0)) revert UnknownCredential(commitment);
        if (r.revoked) revert AlreadyRevoked(commitment);
        r.revoked = true;
        emit CredentialRevoked(commitment, msg.sender, adminOverride);
    }
}
