// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IBella is IERC20Metadata {
    // Allows the dice game to mint tokens to a given address.
    function mint(address account, uint256 amount) external;

    // Allows burning tokens from the caller's balance.
    function burn(uint256 value) external;
}
