// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {PactAccountFactory} from "../src/PactSessionAccount.sol";

/// forge script script/Deploy.s.sol --rpc-url base --broadcast --private-key $DEPLOYER_KEY
/// Same Flash settlement contract and Permit2 on Base and Arc (checked against live quotes).
contract Deploy is Script {
    address constant FLASH = 0x5d00000873b6BF41539e6f5365B0Ff7d3c368f78;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function run() external {
        vm.startBroadcast();
        PactAccountFactory factory = new PactAccountFactory(FLASH, PERMIT2);
        vm.stopBroadcast();
        console.log("PactAccountFactory", address(factory));
        console.log("PactSessionAccount implementation (7702 delegate)", factory.IMPLEMENTATION());
    }
}
