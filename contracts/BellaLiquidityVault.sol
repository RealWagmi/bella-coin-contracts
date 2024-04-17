// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.23;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import { VRFV2WrapperConsumerBase } from "@chainlink/contracts/src/v0.8/vrf/VRFV2WrapperConsumerBase.sol";
import { IBella } from "./interfaces/IBella.sol";
import { INonfungiblePositionManager } from "./interfaces/uniswap/INonfungiblePositionManager.sol";
import { IUniswapV3Pool } from "./interfaces/uniswap/IUniswapV3Pool.sol";
import { TransferHelper } from "./libraries/TransferHelper.sol";

contract BellaLiquidityVault is VRFV2WrapperConsumerBase, Ownable, ERC721Holder {
    using TransferHelper for address;

    uint256 public constant BP = 10_000;
    uint256 public constant PUMP_BPS = 2500; // 25%
    uint32 public constant twapDuration = 10 minutes;
    uint256 public constant twapDeviation = 300; // 3%
    uint32 public constant callbackGasLimitDefault = 200000;
    uint256 public constant pumpInterval = 7 days;
    uint16 public constant requestConfirmations = 3;
    uint160 internal constant MIN_SQRT_RATIO_ADD_ONE = 4295128740;
    uint160 internal constant MAX_SQRT_RATIO_SUB_ONE =
        1461446703485210103287273052203988822378723970341;

    bool public zeroForTokenIn;
    address public wrappedNativeToken;
    INonfungiblePositionManager public positionManager;
    IUniswapV3Pool public bellaV3Pool;
    IBella public bellaToken;

    bool public pumpEnabled;

    uint256 public pumpLastTimestamp;
    uint256 public lastRequestId;
    uint256 public posTokenId;

    constructor(
        address linkAddress,
        address wrapperAddress
    ) VRFV2WrapperConsumerBase(linkAddress, wrapperAddress) {}

    event Pump(uint256 pampAmt, uint256 burnAmt);
    event PumpEnabled(bool enabled, uint256 requestId);
    event TryToEnablePump(uint256 requestId);

    error PriceDeviationTooHigh(uint256 deviation);

    /// @notice Initializes the contract with necessary addresses and tokenId.
    /// @dev Sets up token interfaces and associates the position with tokenId.
    /// This function can only be called by the owner of the contract (BellaDiceGame).
    /// @param zeroForBella If true, BELLA is treated as zero for tokenIn, else the wrapped native token.
    /// @param bellaTokenAddress The address of the BELLA token contract.
    /// @param wrappedNativeTokenAddress The address of the wrapped native token.
    /// @param positionManagerAddress The address of the Non-fungible Position Manager contract.
    /// @param bellaV3PoolAddress The address of the Uniswap V3 Pool for BELLA.
    /// @param tokenId The token ID of the Uniswap position to be managed.
    /// @return success A boolean value that indicates if the initialization was successful.
    function initialize(
        bool zeroForBella,
        address bellaTokenAddress,
        address wrappedNativeTokenAddress,
        address positionManagerAddress,
        address bellaV3PoolAddress,
        uint256 tokenId
    ) external onlyOwner returns (bool) {
        wrappedNativeToken = wrappedNativeTokenAddress;
        positionManager = INonfungiblePositionManager(positionManagerAddress);
        bellaV3Pool = IUniswapV3Pool(bellaV3PoolAddress);
        bellaToken = IBella(bellaTokenAddress);
        posTokenId = tokenId;
        zeroForTokenIn = !zeroForBella;
        pumpLastTimestamp = block.timestamp;
        return true;
    }

    /// @notice Attempts to enable the pump if certain conditions are met and calculates the cost for VRF request.
    /// The caller needs to approve enough LINK tokens before calling this function.
    /// @dev Emits a TryToEnablePump event upon successful execution.
    /// It sets the pumpLastTimestamp to the current block timestamp, calculates required amount of LINK
    /// based on provided callbackGasLimit or uses a default value, transfers LINK tokens from the caller to
    /// the contract, and makes a randomness request. Updates the lastRequestId with the new request ID.
    /// @param callbackGasLimit The gas limit to be used for the callback function when randomness is requested.
    /// If the provided gas limit is below the default, it will use the callbackGasLimitDefault.
    function tryToEnablePump(uint32 callbackGasLimit) external {
        require(posTokenId > 0, "not initialized");
        require(block.timestamp - pumpLastTimestamp < pumpInterval, "too early to enable pump");
        require(!pumpEnabled, "pump already enabled");
        pumpLastTimestamp = block.timestamp;
        if (callbackGasLimit < callbackGasLimitDefault) {
            callbackGasLimit = callbackGasLimitDefault;
        }
        // https://docs.chain.link/vrf/v2/estimating-costs
        uint256 requiredAmt = VRF_V2_WRAPPER.calculateRequestPrice(callbackGasLimit);
        // need to approve LINK token
        address(LINK).safeTransferFrom(msg.sender, address(this), requiredAmt);
        uint256 requestId = requestRandomness(callbackGasLimit, requestConfirmations, 1);
        lastRequestId = requestId;
        emit TryToEnablePump(requestId);
    }

    /**
     * @notice Callback function that is overridden to handle the VRF response.
     * @dev This internal function is executed by the VRFCoordinator when it receives a valid VRF response.
     * It enables or disables the pump based on the first random word received.
     * Only the last request ID is valid for changing the state. It emits the PumpEnabled event after setting the state.
     * The randomness logic here simply uses the modulo operation to turn the pump on or off depending on whether the first number in the `_randomWords` array is odd or even.
     * @param _requestId The requestId of the randomness request, which should match the `lastRequestId` stored by the contract upon requesting randomness.
     * @param _randomWords An array containing the random words provided by the VRF service as a response to the request.
     */
    function fulfillRandomWords(
        uint256 _requestId,
        uint256[] memory _randomWords
    ) internal override {
        require(_requestId == lastRequestId, "invalid callback");
        pumpEnabled = _randomWords[0] % 2 == 0;
        emit PumpEnabled(pumpEnabled, _requestId);
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
        uint256 pampAmt = (wrappedNativeToken.getBalance() * PUMP_BPS) / BP;
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
        wrappedNativeToken.safeTransfer(msg.sender, amountToPay);
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

        uint256 deviation = currentTick > avarageTick
            ? uint256(uint24(currentTick - avarageTick))
            : uint256(uint24(avarageTick - currentTick));
        if (deviation > (uint256(uint24(avarageTick)) * twapDeviation) / BP) {
            revert PriceDeviationTooHigh(deviation);
        }
    }
}
