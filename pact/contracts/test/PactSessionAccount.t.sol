// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PactAccountFactory, PactSessionAccount} from "../src/PactSessionAccount.sol";

interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

interface IPermit2 {
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

    function permit(address owner, PermitSingle memory permitSingle, bytes calldata signature) external;
    function allowance(address owner, address token, address spender)
        external
        view
        returns (uint160 amount, uint48 expiration, uint48 nonce);
}

contract PactSessionAccountTest is Test {
    bytes4 constant MAGIC = 0x1626ba7e;
    bytes4 constant INVALID = 0xffffffff;

    // Base mainnet: Flash settlement (verifying contract and Permit2 spender), Permit2, tokens.
    address constant FLASH = 0x5d00000873b6BF41539e6f5365B0Ff7d3c368f78;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant VAULT = 0x1074393effFCf1A15e306cD3931F48eDA9ABcd55;

    PactSessionAccount impl;
    PactAccountFactory factory;
    uint256 ownerPk = 0xA11CE;
    address owner;
    uint256 sessionPk = 0x5E55;
    address sessionKey;

    function setUp() public {
        vm.chainId(8453);
        vm.warp(1_790_000_000);
        factory = new PactAccountFactory(FLASH, PERMIT2);
        impl = PactSessionAccount(payable(factory.IMPLEMENTATION()));
        owner = vm.addr(ownerPk);
        sessionKey = vm.addr(sessionPk);
        vm.signAndAttachDelegation(address(impl), ownerPk);
    }

    function account() internal view returns (PactSessionAccount) {
        return PactSessionAccount(payable(owner));
    }

    function grant(uint48 expiresAt) internal {
        address[] memory spend = new address[](2);
        spend[0] = USDC;
        spend[1] = WETH;
        uint256[] memory perOrder = new uint256[](2);
        perOrder[0] = 50e6; // $50 per order
        perOrder[1] = 0.05 ether; // protective sells of what the copies bought
        uint256[] memory permitCap = new uint256[](2);
        permitCap[0] = 200e6;
        permitCap[1] = 0.2 ether;
        address[] memory receive_ = new address[](2);
        receive_[0] = WETH;
        receive_[1] = USDC;
        vm.prank(owner);
        account().grantSession(
            sessionKey,
            PactSessionAccount.Scope({
                expiresAt: expiresAt,
                spendTokens: spend,
                maxPerOrder: perOrder,
                maxPermit: permitCap,
                receiveTokens: receive_
            })
        );
    }

    function order(uint256 amount) internal view returns (PactSessionAccount.FlashOrder memory) {
        return PactSessionAccount.FlashOrder({
            swapper: owner,
            vault: VAULT,
            recipient: owner,
            fromToken: USDC,
            toToken: WETH,
            fromAmount: amount,
            salt: 42,
            deadline: block.timestamp + 1 hours
        });
    }

    function sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function sessionSig(uint8 kind, bytes memory payload, bytes32 digest, uint256 pk) internal view returns (bytes memory) {
        return abi.encode(kind, sessionKey, payload, sign(pk, digest));
    }

    function check(bytes32 digest, bytes memory sig) internal view returns (bytes4) {
        return IERC1271(owner).isValidSignature(digest, sig);
    }

    // ------------------------------------------------------------ Flash's real payload

    function test_digestMatchesFlashTypedData() public view {
        // A live Base quote's orderTypedData (DefinitiveFlashAllowance v1); digest from viem.
        PactSessionAccount.FlashOrder memory o = PactSessionAccount.FlashOrder({
            swapper: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8,
            vault: VAULT,
            recipient: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8,
            fromToken: USDC,
            toToken: WETH,
            fromAmount: 20000000,
            salt: 2168777390218388372292388557091935032106,
            deadline: 1793971269
        });
        assertEq(impl.flashOrderDigest(o), 0x3bbb00e74e97512c023b4777694685da731990f1499d0d37e320a1a596866ade);
    }

    // ------------------------------------------------------------ owner path unchanged

    function test_ownerEcdsaStillSigns() public view {
        bytes32 digest = account().flashOrderDigest(order(1_000e6));
        assertEq(check(digest, sign(ownerPk, digest)), MAGIC);
        assertEq(check(digest, sign(0xBAD, digest)), INVALID);
    }

    // ------------------------------------------------------------ session path

    function test_sessionSignsAnOrderInScope() public {
        grant(uint48(block.timestamp + 1 days));
        PactSessionAccount.FlashOrder memory o = order(25e6);
        bytes32 digest = account().flashOrderDigest(o);
        assertEq(check(digest, sessionSig(1, abi.encode(o), digest, sessionPk)), MAGIC);
    }

    function test_sessionCannotPayAnotherRecipient() public {
        grant(uint48(block.timestamp + 1 days));
        PactSessionAccount.FlashOrder memory o = order(25e6);
        o.recipient = address(0xBEEF);
        bytes32 digest = account().flashOrderDigest(o);
        assertEq(check(digest, sessionSig(1, abi.encode(o), digest, sessionPk)), INVALID);
    }

    function test_sessionCannotExceedThePerOrderCap() public {
        grant(uint48(block.timestamp + 1 days));
        PactSessionAccount.FlashOrder memory o = order(51e6);
        bytes32 digest = account().flashOrderDigest(o);
        assertEq(check(digest, sessionSig(1, abi.encode(o), digest, sessionPk)), INVALID);
    }

    function test_sessionCannotTradeOtherTokens() public {
        grant(uint48(block.timestamp + 1 days));
        PactSessionAccount.FlashOrder memory o = order(25e6);
        o.toToken = address(0xC0DE);
        bytes32 digest = account().flashOrderDigest(o);
        assertEq(check(digest, sessionSig(1, abi.encode(o), digest, sessionPk)), INVALID);
        o = order(25e6);
        o.fromToken = address(0xC0DE);
        digest = account().flashOrderDigest(o);
        assertEq(check(digest, sessionSig(1, abi.encode(o), digest, sessionPk)), INVALID);
    }

    function test_payloadMustBeWhatTheDigestCommitsTo() public {
        grant(uint48(block.timestamp + 1 days));
        // Show the validator a harmless order while the digest is for a different one.
        PactSessionAccount.FlashOrder memory shown = order(25e6);
        PactSessionAccount.FlashOrder memory signed = order(25e6);
        signed.recipient = address(0xBEEF);
        bytes32 digest = account().flashOrderDigest(signed);
        assertEq(check(digest, sessionSig(1, abi.encode(shown), digest, sessionPk)), INVALID);
    }

    function test_sessionExpiresRevokesAndBindsDeadline() public {
        uint48 end = uint48(block.timestamp + 2 hours);
        grant(end);
        PactSessionAccount.FlashOrder memory o = order(25e6);
        o.deadline = end + 1;
        bytes32 digest = account().flashOrderDigest(o);
        assertEq(check(digest, sessionSig(1, abi.encode(o), digest, sessionPk)), INVALID, "order outlives the session");

        o = order(25e6);
        digest = account().flashOrderDigest(o);
        bytes memory sig = sessionSig(1, abi.encode(o), digest, sessionPk);
        assertEq(check(digest, sig), MAGIC);
        assertEq(check(digest, sessionSig(1, abi.encode(o), digest, 0xBAD)), INVALID, "wrong session key");

        vm.prank(owner);
        account().revokeSession(sessionKey);
        assertEq(check(digest, sig), INVALID, "revoked");

        grant(end);
        assertEq(check(digest, sig), MAGIC, "re-granted");
        vm.warp(end + 1);
        assertEq(check(digest, sig), INVALID, "expired");
    }

    function test_onlyTheOwnerGrantsOrRevokes() public {
        PactSessionAccount.Scope memory scope;
        scope.expiresAt = uint48(block.timestamp + 1 days);
        vm.prank(address(0xBEEF));
        vm.expectRevert(PactSessionAccount.OnlySelf.selector);
        account().grantSession(sessionKey, scope);
        vm.prank(sessionKey);
        vm.expectRevert(PactSessionAccount.OnlySelf.selector);
        account().revokeSession(sessionKey);
    }

    function test_permitInScopeOnly() public {
        grant(uint48(block.timestamp + 1 days));
        PactSessionAccount.PermitSingle memory p = PactSessionAccount.PermitSingle({
            details: PactSessionAccount.PermitDetails({token: USDC, amount: 100e6, expiration: uint48(block.timestamp + 1 days), nonce: 0}),
            spender: FLASH,
            sigDeadline: block.timestamp + 1 hours
        });
        bytes32 digest = account().permitDigest(p);
        assertEq(check(digest, sessionSig(2, abi.encode(p), digest, sessionPk)), MAGIC);

        p.spender = address(0xBEEF);
        digest = account().permitDigest(p);
        assertEq(check(digest, sessionSig(2, abi.encode(p), digest, sessionPk)), INVALID, "other spender");

        // Flash's real shape: expiration and sigDeadline both at order deadline + 24 h.
        p.spender = FLASH;
        p.details.expiration = uint48(block.timestamp + 1 days + 1 hours);
        p.sigDeadline = block.timestamp + 1 days + 1 hours;
        digest = account().permitDigest(p);
        assertEq(check(digest, sessionSig(2, abi.encode(p), digest, sessionPk)), MAGIC, "within the 24h buffer");
        p.sigDeadline = block.timestamp + 3 days;
        digest = account().permitDigest(p);
        assertEq(check(digest, sessionSig(2, abi.encode(p), digest, sessionPk)), INVALID, "beyond the buffer");

        p.sigDeadline = block.timestamp + 1 hours;
        p.details.amount = type(uint160).max; // Flash's default unlimited permit
        digest = account().permitDigest(p);
        assertEq(check(digest, sessionSig(2, abi.encode(p), digest, sessionPk)), INVALID, "over the permit cap");
    }

    function test_nobodyCanClaimA7702Account() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(PactSessionAccount.AlreadyInitialized.selector);
        account().initialize(address(0xBEEF));
        assertEq(account().owner(), owner);
    }

    function test_smartWalletMode() public {
        uint256 walletOwnerPk = 0xB0B;
        address walletOwner = vm.addr(walletOwnerPk);
        address predicted = factory.accountOf(walletOwner);
        address wallet = factory.create(walletOwner);
        assertEq(wallet, predicted, "address known before creation");
        assertEq(factory.create(walletOwner), wallet, "idempotent");
        PactSessionAccount w = PactSessionAccount(payable(wallet));
        assertEq(w.owner(), walletOwner);
        vm.expectRevert(PactSessionAccount.AlreadyInitialized.selector);
        w.initialize(address(0xBEEF));

        // The owner's wallet signature is the owner path.
        PactSessionAccount.FlashOrder memory o = order(25e6);
        o.swapper = wallet;
        o.recipient = wallet;
        bytes32 digest = w.flashOrderDigest(o);
        assertEq(IERC1271(wallet).isValidSignature(digest, sign(walletOwnerPk, digest)), MAGIC);
        assertEq(IERC1271(wallet).isValidSignature(digest, sign(ownerPk, digest)), INVALID);

        // Only the owner grants a session; then the session signs inside the scope only.
        address[] memory spend = new address[](1);
        spend[0] = USDC;
        uint256[] memory cap = new uint256[](1);
        cap[0] = 50e6;
        address[] memory receive_ = new address[](1);
        receive_[0] = WETH;
        PactSessionAccount.Scope memory scope = PactSessionAccount.Scope({
            expiresAt: uint48(block.timestamp + 1 days), spendTokens: spend, maxPerOrder: cap, maxPermit: cap, receiveTokens: receive_
        });
        vm.prank(address(0xBEEF));
        vm.expectRevert(PactSessionAccount.OnlySelf.selector);
        w.grantSession(sessionKey, scope);
        vm.prank(walletOwner);
        w.grantSession(sessionKey, scope);
        bytes memory sig = abi.encode(uint8(1), sessionKey, abi.encode(o), sign(sessionPk, digest));
        assertEq(IERC1271(wallet).isValidSignature(digest, sig), MAGIC);
        o.recipient = walletOwner; // even the owner's EOA is "another recipient" for the session
        digest = w.flashOrderDigest(o);
        sig = abi.encode(uint8(1), sessionKey, abi.encode(o), sign(sessionPk, digest));
        assertEq(IERC1271(wallet).isValidSignature(digest, sig), INVALID);

        // execute is owner-only.
        vm.prank(sessionKey);
        vm.expectRevert(PactSessionAccount.OnlySelf.selector);
        w.execute(USDC, 0, "");
    }

    function test_cancelMessagesOnly() public {
        grant(uint48(block.timestamp + 1 days));
        bytes memory cancel = bytes(unicode"Definitive Flash v1 — Cancel Orders\nOrders:\nabc\ndef");
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n", vm.toString(cancel.length), cancel));
        assertEq(check(digest, sessionSig(3, cancel, digest, sessionPk)), MAGIC);
        bytes memory other = bytes("Transfer everything to 0xBEEF");
        digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n", vm.toString(other.length), other));
        assertEq(check(digest, sessionSig(3, other, digest, sessionPk)), INVALID);
    }
}

/// Against Base mainnet state: the real Permit2 accepts a session signature through the
/// delegated EOA's isValidSignature, and refuses one outside the scope.
contract PactSessionAccountForkTest is Test {
    address constant FLASH = 0x5d00000873b6BF41539e6f5365B0Ff7d3c368f78;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH = 0x4200000000000000000000000000000000000006;

    function test_fork_realPermit2AcceptsSessionPermit() public {
        if (!vm.envOr("PACT_FORK", false)) return;
        vm.createSelectFork("base");
        PactSessionAccount impl = PactSessionAccount(payable(new PactAccountFactory(FLASH, PERMIT2).IMPLEMENTATION()));
        uint256 ownerPk = 0xA11CE;
        uint256 sessionPk = 0x5E55;
        address owner = vm.addr(ownerPk);
        address key = vm.addr(sessionPk);
        vm.signAndAttachDelegation(address(impl), ownerPk);

        address[] memory spend = new address[](1);
        spend[0] = USDC;
        uint256[] memory perOrder = new uint256[](1);
        perOrder[0] = 50e6;
        uint256[] memory cap = new uint256[](1);
        cap[0] = 200e6;
        address[] memory receive_ = new address[](1);
        receive_[0] = WETH;
        vm.prank(owner);
        PactSessionAccount(payable(owner)).grantSession(
            key,
            PactSessionAccount.Scope({
                expiresAt: uint48(block.timestamp + 1 days),
                spendTokens: spend,
                maxPerOrder: perOrder,
                maxPermit: cap,
                receiveTokens: receive_
            })
        );

        (,, uint48 nonce) = IPermit2(PERMIT2).allowance(owner, USDC, FLASH);
        IPermit2.PermitSingle memory p = IPermit2.PermitSingle({
            details: IPermit2.PermitDetails({token: USDC, amount: 100e6, expiration: uint48(block.timestamp + 1 days), nonce: nonce}),
            spender: FLASH,
            sigDeadline: block.timestamp + 1 hours
        });
        PactSessionAccount.PermitSingle memory mine = PactSessionAccount.PermitSingle({
            details: PactSessionAccount.PermitDetails({token: USDC, amount: 100e6, expiration: p.details.expiration, nonce: nonce}),
            spender: FLASH,
            sigDeadline: p.sigDeadline
        });
        bytes32 digest = PactSessionAccount(payable(owner)).permitDigest(mine);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sessionPk, digest);
        bytes memory sig = abi.encode(uint8(2), key, abi.encode(mine), abi.encodePacked(r, s, v));

        IPermit2(PERMIT2).permit(owner, p, sig);
        (uint160 amount,,) = IPermit2(PERMIT2).allowance(owner, USDC, FLASH);
        assertEq(amount, 100e6, "Permit2 recorded the session-signed allowance");

        // Over the cap: Permit2's EIP-1271 call to the account says no.
        p.details.amount = 500e6;
        p.details.nonce = nonce + 1;
        mine.details.amount = 500e6;
        mine.details.nonce = nonce + 1;
        digest = PactSessionAccount(payable(owner)).permitDigest(mine);
        (v, r, s) = vm.sign(sessionPk, digest);
        sig = abi.encode(uint8(2), key, abi.encode(mine), abi.encodePacked(r, s, v));
        vm.expectRevert();
        IPermit2(PERMIT2).permit(owner, p, sig);
    }
}
