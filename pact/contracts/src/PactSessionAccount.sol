// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title PactSessionAccount
/// @notice EIP-7702 delegate for a PACT follower's own EOA. It lets the follower hand PACT's
///         Autopilot a session key whose authority is enforced on chain, not by PACT.
///
/// Flash validates an order signature with EIP-1271 whenever the funder address has code, which
/// includes a 7702 delegation (Flash docs, "EIP-7702 delegated EOAs"). Flash's settlement
/// contract checks the same signature again at execution. So this contract decides what a
/// session key may sign.
///
/// ERC-1271 only passes a digest. A generic session validator therefore cannot see which tokens,
/// amount or recipient a digest commits to. This one requires the session signature to carry the
/// full payload, rebuilds the exact EIP-712 digest from it, and only then checks the scope:
///   - FlashOrder: swapper and recipient are this account, the spent token is allowed and at or
///     under its per-order cap, the received token is allowed, the deadline is inside the session.
///   - Permit2 PermitSingle: the spender is Flash's settlement contract, the token is allowed and
///     the amount is within its permit cap, the permit ends inside the session.
///   - Flash cancel messages (they only reduce exposure).
/// The owner path is unchanged: a plain 65-byte ECDSA signature by the owner's key is valid,
/// so the follower keeps signing in their wallet as before.
///
/// Two ways to use it, same rules:
///   - EIP-7702: the follower's EOA delegates to this code; the owner is the EOA itself.
///   - Dedicated smart wallet: a clone created by PactAccountFactory for an owner EOA (any
///     browser wallet can own one; most will not delegate a 7702 EOA to arbitrary code).
contract PactSessionAccount {
    bytes4 internal constant MAGIC = 0x1626ba7e;
    bytes4 internal constant INVALID = 0xffffffff;

    uint8 public constant KIND_FLASH_ORDER = 1;
    uint8 public constant KIND_PERMIT2 = 2;
    uint8 public constant KIND_CANCEL = 3;

    bytes32 internal constant FLASH_ORDER_TYPEHASH = keccak256(
        "FlashOrder(address swapper,address vault,address recipient,address fromToken,address toToken,uint256 fromAmount,uint256 salt,uint256 deadline)"
    );
    bytes32 internal constant PERMIT_DETAILS_TYPEHASH =
        keccak256("PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)");
    bytes32 internal constant PERMIT_SINGLE_TYPEHASH = keccak256(
        "PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
    );
    bytes internal constant CANCEL_PREFIX = unicode"Definitive Flash v1 — Cancel";
    /// Flash sizes Permit2 permits to the order plus a 24-hour buffer.
    uint256 internal constant PERMIT_EXPIRY_BUFFER = 1 days;

    /// Flash settlement contract: the EIP-712 verifying contract and the Permit2 spender.
    address public immutable FLASH;
    address public immutable PERMIT2;
    /// Only the factory may set an owner, and only on a clone it has just created. A 7702 EOA is
    /// never initialized, so nobody can claim one.
    address public immutable FACTORY;
    bytes32 internal immutable FLASH_DOMAIN;
    bytes32 internal immutable PERMIT2_DOMAIN;

    struct FlashOrder {
        address swapper;
        address vault;
        address recipient;
        address fromToken;
        address toToken;
        uint256 fromAmount;
        uint256 salt;
        uint256 deadline;
    }

    struct PermitDetails {
        address token;
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    struct PermitSingle {
        PermitDetails details;
        address spender;
        uint256 sigDeadline;
    }

    struct Scope {
        uint48 expiresAt;
        address[] spendTokens;
        uint256[] maxPerOrder;
        uint256[] maxPermit;
        address[] receiveTokens;
    }

    struct Session {
        uint48 expiresAt;
        mapping(address => uint256) maxPerOrder;
        mapping(address => uint256) maxPermit;
        mapping(address => bool) canReceive;
    }

    /// @custom:storage-location erc7201:pact.session-account
    struct Layout {
        address owner;
        uint256 grants;
        mapping(address key => bytes32 id) current;
        mapping(bytes32 id => Session) sessions;
    }

    // keccak256(abi.encode(uint256(keccak256("pact.session-account")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant LAYOUT_SLOT = 0x78292a9ed05907e71edde675f3fb34ec51432133fec99caaa5097adbda51ec00;

    event SessionGranted(address indexed key, bytes32 indexed id, uint48 expiresAt);
    event SessionRevoked(address indexed key, bytes32 indexed id);

    error OnlySelf();
    error BadScope();
    error AlreadyInitialized();
    error CallFailed();

    constructor(address flash, address permit2, address factory) {
        FLASH = flash;
        PERMIT2 = permit2;
        FACTORY = factory;
        FLASH_DOMAIN = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("DefinitiveFlashAllowance"),
                keccak256("1"),
                block.chainid,
                flash
            )
        );
        PERMIT2_DOMAIN = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
                keccak256("Permit2"),
                block.chainid,
                permit2
            )
        );
    }

    receive() external payable {}

    // ---------------------------------------------------------------- owner actions

    modifier onlySelf() {
        // 7702: the EOA calling its own address runs this code with msg.sender == itself.
        // Smart wallet: the owner EOA calls the wallet.
        if (msg.sender != address(this) && msg.sender != owner()) revert OnlySelf();
        _;
    }

    /// The signer of the owner path: the stored owner (smart wallet) or the EOA itself (7702).
    function owner() public view returns (address) {
        address o = _layout().owner;
        return o == address(0) ? address(this) : o;
    }

    /// Smart-wallet mode only, called once by the factory in the same transaction as the clone.
    function initialize(address owner_) external {
        Layout storage l = _layout();
        if (msg.sender != FACTORY || l.owner != address(0) || owner_ == address(0)) revert AlreadyInitialized();
        l.owner = owner_;
    }

    /// Owner calls from the wallet: token approvals to Permit2 or Flash, withdrawals.
    function execute(address target, uint256 value, bytes calldata data) external onlySelf returns (bytes memory out) {
        bool ok;
        (ok, out) = target.call{value: value}(data);
        if (!ok) revert CallFailed();
    }

    function grantSession(address key, Scope calldata scope) external onlySelf returns (bytes32 id) {
        if (
            key == address(0) || scope.expiresAt <= block.timestamp || scope.spendTokens.length != scope.maxPerOrder.length
                || scope.spendTokens.length != scope.maxPermit.length
        ) revert BadScope();
        Layout storage l = _layout();
        id = keccak256(abi.encode(key, ++l.grants));
        Session storage s = l.sessions[id];
        s.expiresAt = scope.expiresAt;
        for (uint256 i; i < scope.spendTokens.length; ++i) {
            s.maxPerOrder[scope.spendTokens[i]] = scope.maxPerOrder[i];
            s.maxPermit[scope.spendTokens[i]] = scope.maxPermit[i];
        }
        for (uint256 i; i < scope.receiveTokens.length; ++i) {
            s.canReceive[scope.receiveTokens[i]] = true;
        }
        l.current[key] = id;
        emit SessionGranted(key, id, scope.expiresAt);
    }

    /// Instant: Flash's onchain check at execution fails for every order this key signed.
    function revokeSession(address key) external onlySelf {
        Layout storage l = _layout();
        bytes32 id = l.current[key];
        delete l.current[key];
        emit SessionRevoked(key, id);
    }

    // ---------------------------------------------------------------- views

    function sessionOf(address key) external view returns (bytes32 id, uint48 expiresAt) {
        Layout storage l = _layout();
        id = l.current[key];
        expiresAt = id == bytes32(0) ? 0 : l.sessions[id].expiresAt;
    }

    function limitsOf(address key, address token)
        external
        view
        returns (uint256 maxPerOrder, uint256 maxPermit, bool canReceive)
    {
        Session storage s = _layout().sessions[_layout().current[key]];
        return (s.maxPerOrder[token], s.maxPermit[token], s.canReceive[token]);
    }

    function flashOrderDigest(FlashOrder memory o) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                FLASH_DOMAIN,
                keccak256(
                    abi.encode(
                        FLASH_ORDER_TYPEHASH,
                        o.swapper,
                        o.vault,
                        o.recipient,
                        o.fromToken,
                        o.toToken,
                        o.fromAmount,
                        o.salt,
                        o.deadline
                    )
                )
            )
        );
    }

    function permitDigest(PermitSingle memory p) public view returns (bytes32) {
        bytes32 details = keccak256(
            abi.encode(PERMIT_DETAILS_TYPEHASH, p.details.token, p.details.amount, p.details.expiration, p.details.nonce)
        );
        return keccak256(
            abi.encodePacked(
                "\x19\x01", PERMIT2_DOMAIN, keccak256(abi.encode(PERMIT_SINGLE_TYPEHASH, details, p.spender, p.sigDeadline))
            )
        );
    }

    // ---------------------------------------------------------------- ERC-1271

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (signature.length == 65) {
            return _recover(hash, signature) == owner() ? MAGIC : INVALID;
        }
        (uint8 kind, address key, bytes memory payload, bytes memory sessionSig) =
            abi.decode(signature, (uint8, address, bytes, bytes));
        Layout storage l = _layout();
        bytes32 id = l.current[key];
        if (id == bytes32(0)) return INVALID;
        Session storage s = l.sessions[id];
        if (block.timestamp > s.expiresAt) return INVALID;
        if (sessionSig.length != 65 || _recover(hash, sessionSig) != key) return INVALID;

        if (kind == KIND_FLASH_ORDER) {
            FlashOrder memory o = abi.decode(payload, (FlashOrder));
            if (flashOrderDigest(o) != hash) return INVALID;
            if (o.swapper != address(this) || o.recipient != address(this)) return INVALID;
            uint256 cap = s.maxPerOrder[o.fromToken];
            if (cap == 0 || o.fromAmount > cap) return INVALID;
            if (!s.canReceive[o.toToken]) return INVALID;
            if (o.deadline > s.expiresAt) return INVALID;
            return MAGIC;
        }
        if (kind == KIND_PERMIT2) {
            PermitSingle memory p = abi.decode(payload, (PermitSingle));
            if (permitDigest(p) != hash) return INVALID;
            if (p.spender != FLASH) return INVALID;
            uint256 cap = s.maxPermit[p.details.token];
            if (cap == 0 || p.details.amount > cap) return INVALID;
            // Flash sets both to the order deadline plus 24 hours. Using either after the
            // session ends still fails: the expiry check above runs on every onchain use.
            if (p.details.expiration > s.expiresAt + PERMIT_EXPIRY_BUFFER || p.sigDeadline > s.expiresAt + PERMIT_EXPIRY_BUFFER) {
                return INVALID;
            }
            return MAGIC;
        }
        if (kind == KIND_CANCEL) {
            if (_ethSignedMessageHash(payload) != hash || !_startsWith(payload, CANCEL_PREFIX)) return INVALID;
            return MAGIC;
        }
        return INVALID;
    }

    // ---------------------------------------------------------------- internals

    function _layout() internal pure returns (Layout storage l) {
        bytes32 slot = LAYOUT_SLOT;
        assembly {
            l.slot := slot
        }
    }

    function _recover(bytes32 hash, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        // Reject malleable signatures (upper-half s).
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(hash, v, r, s);
    }

    function _ethSignedMessageHash(bytes memory message) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n", _decimal(message.length), message));
    }

    function _startsWith(bytes memory data, bytes memory prefix) internal pure returns (bool) {
        if (data.length < prefix.length) return false;
        for (uint256 i; i < prefix.length; ++i) {
            if (data[i] != prefix[i]) return false;
        }
        return true;
    }

    function _decimal(uint256 value) internal pure returns (bytes memory out) {
        if (value == 0) return "0";
        uint256 digits;
        for (uint256 v = value; v != 0; v /= 10) ++digits;
        out = new bytes(digits);
        for (; value != 0; value /= 10) out[--digits] = bytes1(uint8(48 + (value % 10)));
    }
}

/// Creates a PACT smart wallet for an owner: an EIP-1167 clone of the implementation, at an
/// address that depends only on the owner (so PACT can show it before it exists).
contract PactAccountFactory {
    address public immutable IMPLEMENTATION;

    event AccountCreated(address indexed owner, address account);

    constructor(address flash, address permit2) {
        IMPLEMENTATION = address(new PactSessionAccount(flash, permit2, address(this)));
    }

    function accountOf(address owner) public view returns (address predicted) {
        bytes32 salt = bytes32(uint256(uint160(owner)));
        bytes32 codeHash = keccak256(_cloneCode());
        predicted = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, codeHash)))));
    }

    function create(address owner) external returns (address account) {
        account = accountOf(owner);
        if (account.code.length > 0) return account;
        bytes memory code = _cloneCode();
        bytes32 salt = bytes32(uint256(uint160(owner)));
        assembly {
            account := create2(0, add(code, 0x20), mload(code), salt)
        }
        PactSessionAccount(payable(account)).initialize(owner);
        emit AccountCreated(owner, account);
    }

    function _cloneCode() internal view returns (bytes memory) {
        return abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", IMPLEMENTATION, hex"5af43d82803e903d91602b57fd5bf3"
        );
    }
}
