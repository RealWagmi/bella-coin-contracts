// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0; 
import "@openzeppelin/contracts/access/Ownable.sol";
import { RrpRequesterV0 } from "@api3/airnode-protocol/contracts/rrp/requesters/RrpRequesterV0.sol";
import { QrngExample } from "./TestAirnodeCallback.sol";

contract FactoryForTestAirnode is RrpRequesterV0, Ownable {
    address sponsorWallet;
    address airnodeRrpAddressOptimism;
    uint counter;
    mapping(uint=>QrngExample) public games;

    constructor(address _airnodeRrpAddressOptimism) RrpRequesterV0(_airnodeRrpAddressOptimism) {
        airnodeRrpAddressOptimism = _airnodeRrpAddressOptimism;
    }

    function createGame() external onlyOwner {
        counter++;
        bytes32 salt = keccak256(abi.encode(msg.sender, counter));
        games[counter] = new QrngExample{ salt: salt }(
            airnodeRrpAddressOptimism,
            sponsorWallet
        );
        airnodeRrp.setSponsorshipStatus(address(games[counter]), true);
    }

    function setSponsor(address _sponsorWallet) external onlyOwner {
        sponsorWallet = _sponsorWallet;
    }

    receive() external payable{}
}