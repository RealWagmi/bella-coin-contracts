//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0; 
import { IAirnodeRrpV0 } from "@api3/airnode-protocol/contracts/rrp/interfaces/IAirnodeRrpV0.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Example contract that uses Airnode RRP to receive QRNG services
/// @notice This contract is not secure. Do not use it in production. Refer to
/// the contract for more information.
/// @dev See README.md for more information.
contract QrngExample is Ownable {
    event RequestedUint256(bytes32 indexed requestId);
    event ReceivedUint256(bytes32 indexed requestId, uint256 response);
     IAirnodeRrpV0 public immutable airnodeRrp;
    // These variables can also be declared as `constant`/`immutable`.
    // However, this would mean that they would not be updatable.
    // Since it is impossible to ensure that a particular Airnode will be
    // indefinitely available, you are recommended to always implement a way
    // to update these parameters.
    bytes32 public constant endpointIdUint256 =
        0xffd1bbe880e7b2c662f6c8511b15ff22d12a4a35d5c8c17202893a5f10e25284;
    address public constant airnode = 0x224e030f03Cd3440D88BD78C9BF5Ed36458A1A25;
    address public sponsorWallet;

    mapping(bytes32 => bool) public expectingRequestWithIdToBeFulfilled;

    /// @dev RrpRequester sponsors itself, meaning that it can make requests
    /// that will be fulfilled by its sponsor wallet. See the Airnode protocol
    /// docs about sponsorship for more information.
    /// @param _airnodeRrpAddress Airnode RRP contract address
    constructor(address _airnodeRrpAddress, address _sponsorWallet) {
        airnodeRrp = IAirnodeRrpV0(_airnodeRrpAddress);
        sponsorWallet = _sponsorWallet;
    }

    modifier onlyAirnodeRrp() {
        require(msg.sender == address(airnodeRrp), "Caller not Airnode RRP");
        _;
    }


    /// @notice Requests a `uint256`
    /// @dev This request will be fulfilled by the contract's sponsor wallet,
    /// which means spamming it may drain the sponsor wallet. Implement
    /// necessary requirements to prevent this, e.g., you can require the user
    /// to pitch in by sending some ETH to the sponsor wallet, you can have
    /// the user use their own sponsor wallet, you can rate-limit users.
    function makeRequestUint256() external  {
        require(msg.sender == 0xe29cE6dBf260bd64B8882b2e9f84F66e4E5BC6e3);
        bytes32 requestId = airnodeRrp.makeFullRequest(
            airnode,
            endpointIdUint256,
            owner(), // sponsor
            sponsorWallet,
            address(this),
            this.fulfillUint256.selector,
            ""
        );
        expectingRequestWithIdToBeFulfilled[requestId] = true;
        emit RequestedUint256(requestId);
    }

    /// @notice Called by the Airnode through the AirnodeRrp contract to
    /// fulfill the request
    /// @dev Note the `onlyAirnodeRrp` modifier. You should only accept RRP
    /// fulfillments from this protocol contract. Also note that only
    /// fulfillments for the requests made by this contract are accepted, and
    /// a request cannot be responded to multiple times.
    /// @param requestId Request ID
    /// @param data ABI-encoded response
    function fulfillUint256(bytes32 requestId, bytes calldata data)
        external
        onlyAirnodeRrp
    {
        require(
            expectingRequestWithIdToBeFulfilled[requestId],
            "Request ID not known"
        );
        expectingRequestWithIdToBeFulfilled[requestId] = false;
        uint256 qrngUint256 = abi.decode(data, (uint256));
        // Do what you want with `qrngUint256` here...
        emit ReceivedUint256(requestId, qrngUint256);
    }

   
}