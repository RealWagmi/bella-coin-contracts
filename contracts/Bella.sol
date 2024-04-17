// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract Bella is ERC20, Ownable {
    uint8 private immutable _decimals;

    constructor(string memory _name, string memory _symbol, uint8 _dec) ERC20(_name, _symbol) {
        _decimals = _dec;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address account, uint256 amount) external onlyOwner {
        _mint(account, amount);
    }

    function burn(uint256 value) external {
        _burn(msg.sender, value);
    }
}
