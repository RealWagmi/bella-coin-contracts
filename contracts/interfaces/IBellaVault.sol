// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IBellaVault {
    // Allows the dice game to mint tokens to a given address.
    function initialize(
        bool zeroForBella,
        address bellaTokenAddress,
        address wrappedNativeTokenAddress,
        address positionManagerAddress,
        address bellaV3PoolAddress,
        uint256 tokenId
    ) external returns (bool);

    function owner() external view returns (address);
}
