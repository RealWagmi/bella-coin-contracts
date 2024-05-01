// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.23;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import { RrpRequesterV0 } from "@api3/airnode-protocol/contracts/rrp/requesters/RrpRequesterV0.sol";
import { IBella } from "./interfaces/IBella.sol";
import { INonfungiblePositionManager } from "./interfaces/uniswap/INonfungiblePositionManager.sol";
import { IUniswapV3Pool } from "./interfaces/uniswap/IUniswapV3Pool.sol";
import { TransferHelper } from "./libraries/TransferHelper.sol";
import { IWETH } from "./interfaces/IWETH.sol";
import { TickMath } from "./vendor0.8/uniswap/TickMath.sol";
import { FullMath } from "./vendor0.8/uniswap/FullMath.sol";

contract BellaLiquidityVault is RrpRequesterV0, Ownable, ERC721Holder {
    using TransferHelper for address;

    uint256 public constant BP = 10_000;
    uint256 public constant PUMP_BPS = 2500; // 25%
    uint32 public constant twapDuration = 10 minutes;
    uint256 public constant twapDeviation = 300; // 3%
    uint256 public constant pumpInterval = 7 days;
    uint256 public constant CALLBACK_GAS = 300000;
    uint256 public constant emergencyPumpInterval = 180 days;
    uint160 internal constant MIN_SQRT_RATIO_ADD_ONE = 4295128740;
    uint160 internal constant MAX_SQRT_RATIO_SUB_ONE =
        1461446703485210103287273052203988822378723970341;

    bool public zeroForTokenIn;
    address public wrappedNativeTokenAddress;
    INonfungiblePositionManager public positionManager;
    IUniswapV3Pool public bellaV3Pool;
    IBella public bellaToken;

    bool public pumpEnabled;

    address payable public sponsorWallet;
    bytes32 public constant endpointIdUint256 =
        0xfb6d017bb87991b7495f563db3c8cf59ff87b09781947bb1e417006ad7f55a78;
    address public constant airnode = 0x9d3C147cA16DB954873A498e0af5852AB39139f2;

    uint256 public pumpLastTimestamp;
    uint256 public posTokenId;
    mapping(bytes32 => bool) public pendingRequestIds;

    constructor(address airnodeRrpAddress) RrpRequesterV0(airnodeRrpAddress) {}

    event Pump(uint256 pampAmt, uint256 burnAmt);
    event PumpEnabled(bool enabled, bytes32 requestId);
    event TryToEnablePump(bytes32 requestId);

    error PriceDeviationTooHigh(uint256 deviation);
    error AmountOfEthSentIsTooSmall(uint256 sent, uint256 minimum);

    receive() external payable {
        IWETH(wrappedNativeTokenAddress).deposit{ value: msg.value }();
    }

    /**
     * @notice Configures the contract with fundamental elements required for the game mechanics to function properly.
     * @dev Only callable by the owner of the contract. Sets the addresses for the wrapped native token, position manager,
     * sponsor wallet, as well as the Airnode address and its corresponding endpoint ID used for uint256 data type responses.
     * @param _wrappedNativeTokenAddress The address of the wrapped native token contract.
     * @param _positionManagerAddress The address of the position manager contract, responsible for managing non-fungible positions.
     * @param _sponsorWallet The address of the sponsor's wallet, which will provide funds necessary for the game operation.
     * @custom:modifier onlyOwner Restricts this function to be callable solely by the owner of the contract.
     */
    function primarySetup(
        address _wrappedNativeTokenAddress,
        address _positionManagerAddress,
        address _sponsorWallet
    ) external onlyOwner {
        wrappedNativeTokenAddress = _wrappedNativeTokenAddress;
        positionManager = INonfungiblePositionManager(_positionManagerAddress);
        sponsorWallet = payable(_sponsorWallet);
    }

    /// @notice Initializes the contract with necessary addresses and tokenId.
    /// @dev Sets up token interfaces and associates the position with tokenId.
    /// This function can only be called by the owner of the contract (BellaDiceGame).
    /// @param zeroForBella If true, BELLA is treated as zero for tokenIn, else the wrapped native token.
    /// @param bellaTokenAddress The address of the BELLA token contract.
    /// @param bellaV3PoolAddress The address of the Uniswap V3 Pool for BELLA.
    /// @param tokenId The token ID of the Uniswap position to be managed.
    function initialize(
        bool zeroForBella,
        address bellaTokenAddress,
        address bellaV3PoolAddress,
        uint256 tokenId
    ) external onlyOwner {
        bellaV3Pool = IUniswapV3Pool(bellaV3PoolAddress);
        bellaToken = IBella(bellaTokenAddress);
        posTokenId = tokenId;
        zeroForTokenIn = !zeroForBella;
        pumpLastTimestamp = block.timestamp;
    }

    /// @notice Determines if the current time is past the required interval to activate the pump.
    function isTimeToPump() public view returns (bool) {
        return block.timestamp > pumpLastTimestamp + pumpInterval;
    }

    /// @notice Determines if the current time allows for an emergency activation of the pump.
    function isTimeToEmergencyEnablePump() public view returns (bool) {
        return block.timestamp > pumpLastTimestamp + emergencyPumpInterval;
    }

    /**
     * @notice Activates the pump in an emergency, provided the conditions are met.
     * Requires that the current time is sufficient for an emergency enablement as determined by `isTimeToEmergencyEnablePump`.
     */
    function emergencyEnablePump() external {
        require(isTimeToEmergencyEnablePump(), "too early to enable pump");
        pumpEnabled = true;
        pumpLastTimestamp = block.timestamp;
        emit PumpEnabled(pumpEnabled, 0);
    }

    /// @notice Attempts to enable the pump if certain conditions are met and calculates the cost for VRF request.
    /// The caller needs to approve enough LINK tokens before calling this function.
    /// @dev Emits a TryToEnablePump event upon successful execution.
    /// It sets the pumpLastTimestamp to the current block timestamp, calculates required amount of LINK
    /// based on provided callbackGasLimit or uses a default value, transfers LINK tokens from the caller to
    /// the contract, and makes a randomness request. Updates the lastRequestId with the new request ID.
    /// If the provided gas limit is below the default, it will use the callbackGasLimitDefault.
    function tryToEnablePump() external payable {
        require(posTokenId > 0, "not initialized");
        require(!pumpEnabled, "pump already enabled");
        require(isTimeToPump(), "too early to enable pump");
        // require(!airnodeRrp.requestIsAwaitingFulfillment(lastRrequestId), "request pending");

        uint256 minimumSend = tx.gasprice * CALLBACK_GAS;
        if (msg.value < minimumSend) {
            revert AmountOfEthSentIsTooSmall(msg.value, minimumSend);
        }

        bytes32 requestId = airnodeRrp.makeFullRequest(
            airnode,
            endpointIdUint256,
            address(this),
            sponsorWallet,
            address(this),
            this.fulfillRandomWords.selector,
            ""
        );
        pendingRequestIds[requestId] = true;

        emit TryToEnablePump(requestId);
        sponsorWallet.transfer(msg.value);

        //subscribe to the AirnodeRrpV0 contract event FailedRequest(airnode, requestId, errorMessage) to identify the error
    }

    /**
     * @notice Processes the random number provided by the Airnode and determines if it is time to enable the pump.
     * @dev This callback function is meant to be called only by the authorized Airnode through the RRP protocol.
     * The function decodes the random data, updates the pump's last timestamp, and sets the `pumpEnabled` state.
     * @param _requestId The identifier of the fulfilled request, logged for tracking purposes.
     * @param _data Encoded random data received from the Airnode.
     * @custom:modifier onlyAirnodeRrp Ensures that only a response from the linked Airnode can invoke this function.
     */
    function fulfillRandomWords(bytes32 _requestId, bytes calldata _data) external onlyAirnodeRrp {
        require(pendingRequestIds[_requestId], "Invalid requestId");
        if (isTimeToPump()) {
            pumpLastTimestamp = block.timestamp;
            uint256 qrngUint256 = abi.decode(_data, (uint256));
            pumpEnabled = qrngUint256 % 2 == 0;
            emit PumpEnabled(pumpEnabled, _requestId);
        }
        delete pendingRequestIds[_requestId];
    }

    /**
     * @notice Executes the pump operation which collects fees, performs a swap, and burns the received tokens.
     * @dev This function encapsulates the entire pump logic which includes:
     * 1. Collecting accumulated fees from a Uniswap V3 position,
     * 2. Calculating the pamp amount based on the balance of wrapped native tokens and defined basis points (BPS),
     * 3. Checking for price deviations before swapping,
     * 4. Performing the swap at the Bella V3 Pool,
     * 5. Burning the acquired Bella tokens.
     * It first checks if the pumping action is enabled by ensuring `pumpEnabled` is true, then disables pumping to prevent reentrancy.
     * After collecting fees, it calculates the pump amount and proceeds with a token swap if the amount is greater than zero.
     * Upon successful execution, a Pump event is emitted with the amount swapped and burned.
     * Reverts if the pump is not enabled or other preconditions are not met during the process.
     * Assumes the presence of a INonfungiblePositionManager interface to interact with Uniswap V3 positions.
     */
    function pump() external {
        require(pumpEnabled, "pump not enabled");
        pumpEnabled = false;
        positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: posTokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        // Calculate the pamp amount based on the wrapped native token balance and BPS
        uint256 pampAmt = (wrappedNativeTokenAddress.getBalance() * PUMP_BPS) / BP;
        if (pampAmt > 0) {
            _checkPriceDeviation(); // Internal check for price deviation

            // Perform the swap at the Bella V3 pool
            bellaV3Pool.swap(
                address(this), //recipient
                zeroForTokenIn,
                int256(pampAmt),
                zeroForTokenIn ? MIN_SQRT_RATIO_ADD_ONE : MAX_SQRT_RATIO_SUB_ONE,
                new bytes(0)
            );

            // Burn the acquired Bella tokens
            uint256 burnAmt = address(bellaToken).getBalance();
            bellaToken.burn(burnAmt);

            emit Pump(pampAmt, burnAmt);
        }
    }

    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata /*data*/
    ) external {
        require(msg.sender == address(bellaV3Pool), "Invalid caller");
        if (amount0Delta <= 0 && amount1Delta <= 0) {
            revert("Invalid swap");
        }

        uint256 amountToPay = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        wrappedNativeTokenAddress.safeTransfer(msg.sender, amountToPay);
    }

    function _checkPriceDeviation() private view returns (int24 currentTick) {
        (, currentTick, , , , , ) = bellaV3Pool.slot0();
        uint32[] memory secondsAgo = new uint32[](2);
        secondsAgo[0] = twapDuration;
        secondsAgo[1] = 0;

        (int56[] memory tickCumulatives, ) = bellaV3Pool.observe(secondsAgo);
        int56 twapDurationInt56 = int56(uint56(twapDuration));

        int56 tickCumulativesDelta = tickCumulatives[1] - tickCumulatives[0];
        int24 avarageTick = int24(tickCumulativesDelta / twapDurationInt56);

        if (tickCumulativesDelta < 0 && (tickCumulativesDelta % twapDurationInt56 != 0))
            avarageTick--;

        uint256 deviationBps = _getPriceDiviation(
            TickMath.getSqrtRatioAtTick(currentTick),
            TickMath.getSqrtRatioAtTick(avarageTick)
        );

        if (deviationBps > twapDeviation) {
            revert PriceDeviationTooHigh(deviationBps);
        }
    }

    function _getPriceDiviation(
        uint160 sqrtPrice,
        uint160 sqrtPriceAvg
    ) private pure returns (uint256 deviationBps) {
        uint256 ratio = _getRatio(sqrtPrice);
        uint256 ratioAvg = _getRatio(sqrtPriceAvg);
        uint256 ratioDeviation = ratio > ratioAvg
            ? uint256(ratio - ratioAvg)
            : uint256(ratioAvg - ratio);
        deviationBps = (ratioDeviation * BP) / ratioAvg;
    }

    function _getRatio(uint160 sqrtPrice) private pure returns (uint256 ratio) {
        if (sqrtPrice <= type(uint128).max) {
            ratio = uint256(sqrtPrice) * sqrtPrice;
        } else {
            ratio = FullMath.mulDiv(sqrtPrice, sqrtPrice, 1 << 64);
        }
    }
}
