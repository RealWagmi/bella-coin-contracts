// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IBellaVault {
    function primarySetup(
        address _wrappedNativeTokenAddress,
        address _positionManagerAddress,
        address _sponsorWallet
    ) external;

    // Allows the dice game to mint tokens to a given address.
    function initialize(
        bool zeroForBella,
        address bellaTokenAddress,
        address bellaV3PoolAddress,
        uint256 tokenId
    ) external;
}
