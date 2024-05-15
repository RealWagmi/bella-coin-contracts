// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import { IAirnodeRrpV0 } from "@api3/airnode-protocol/contracts/rrp/interfaces/IAirnodeRrpV0.sol";
import { INonfungiblePositionManager } from "./interfaces/uniswap/INonfungiblePositionManager.sol";
import { IUniswapV3Pool } from "./interfaces/uniswap/IUniswapV3Pool.sol";
import { TransferHelper } from "./libraries/TransferHelper.sol";
import { IWETH } from "./interfaces/IWETH.sol";
import { TickMath } from "./vendor0.8/uniswap/TickMath.sol";
import { FullMath } from "./vendor0.8/uniswap/FullMath.sol";

contract BellaToken is ERC20, ERC721Holder {
    using TransferHelper for address;

    uint32 public constant TWAP_DURATION = 10 minutes;
    uint256 public constant TWAP_DEVIATION = 300; // 3%
    uint256 public constant BP = 10_000;
    uint256 public constant PUMP_BPS = 2500; // 25%
    uint256 public constant PUMP_INTERVAL = 7 days;
    uint256 public constant CALLBACK_GAS = 200000;
    uint256 public constant EMERGENCY_PUMP_INTERVAL = 60 days;

    IAirnodeRrpV0 public immutable airnodeRrp;
    address public immutable bellaDGAddress;

    bool public zeroForTokenIn;
    address public quoteTokenAddress;
    INonfungiblePositionManager public positionManager;
    IUniswapV3Pool public bellaV3Pool;

    bool public pumpEnabled;

    address payable public sponsorWallet;
    bytes32 public constant endpointIdUint256 =
        0xffd1bbe880e7b2c662f6c8511b15ff22d12a4a35d5c8c17202893a5f10e25284;
    address public constant airnode = 0x224e030f03Cd3440D88BD78C9BF5Ed36458A1A25;

    uint256 public pumpLastTimestamp;
    uint256 public posTokenId;
    mapping(bytes32 => bool) public pendingRequestIds;

    constructor(
        address airnodeRrpAddress,
        address _quoteTokenAddress,
        address _positionManagerAddress,
        address _sponsorWallet
    ) ERC20("Bella", "Bella") {
        airnodeRrp = IAirnodeRrpV0(airnodeRrpAddress);
        quoteTokenAddress = _quoteTokenAddress;
        positionManager = INonfungiblePositionManager(_positionManagerAddress);
        sponsorWallet = payable(_sponsorWallet);
        bellaDGAddress = msg.sender;
    }

    event Pump(uint256 pampAmt, uint256 burnAmt);
    event PumpEnabled(bool enabled, bytes32 requestId);
    event TryToEnablePump(bytes32 requestId);

    error PriceDeviationTooHigh(uint256 deviation);
    error AmountOfEthSentIsTooSmall(uint256 sent, uint256 minimum);

    /// @dev Reverts if the caller is not the Airnode RRP contract.
    /// Use it as a modifier for fulfill and error callback methods, but also
    /// check `requestId`.
    modifier onlyAirnodeRrp() {
        require(msg.sender == address(airnodeRrp), "f");
        _;
    }

    modifier onlyBellaDiceGame() {
        require(msg.sender == bellaDGAddress, "f");
        _;
    }

    receive() external payable {
        sponsorWallet.transfer(msg.value);
    }

    function mint(address account, uint256 amount) external onlyBellaDiceGame {
        _mint(account, amount);
    }

    function burn(uint256 value) external {
        _burn(msg.sender, value);
    }

    /**
     * @notice Initializes the BellaPool with the specified parameters.
     * @param zeroForBella If set to true, token0 will be used in the pool, otherwise token1.
     * @param bellaV3PoolAddress The address of the Uniswap V3 pool for BELLA.
     * @param tokenId The token ID used for position management within the Uniswap V3 pool.
     */
    function initialize(
        bool zeroForBella,
        address bellaV3PoolAddress,
        uint256 tokenId
    ) external onlyBellaDiceGame {
        bellaV3Pool = IUniswapV3Pool(bellaV3PoolAddress);
        posTokenId = tokenId;
        zeroForTokenIn = !zeroForBella;
        pumpLastTimestamp = block.timestamp;
    }

    /// @notice Determines if the current time is past the required interval to activate the pump.
    function isTimeToPump() public view returns (bool) {
        return block.timestamp > pumpLastTimestamp + PUMP_INTERVAL;
    }

    /// @notice Determines if the current time allows for an emergency activation of the pump.
    function isTimeToEmergencyEnablePump() public view returns (bool) {
        return block.timestamp > pumpLastTimestamp + EMERGENCY_PUMP_INTERVAL;
    }

    /**
     * @notice Activates the pump in an emergency, provided the conditions are met.
     * Requires that the current time is sufficient for an emergency enablement as determined by `isTimeToEmergencyEnablePump`.
     */
    function emergencyEnablePump() external {
        require(isTimeToEmergencyEnablePump(), "too early");
        pumpEnabled = true;
        pumpLastTimestamp = block.timestamp;
        emit PumpEnabled(pumpEnabled, 0);
    }

    /// @notice Attempts to enable the pump by sending a request to the Airnode.
    /// Requires payment that covers callback gas costs.
    /// Emits `TryToEnablePump` on success.
    /// @dev Makes a full request to Airnode using `makeFullRequest`.
    /// Checks that the pump has not already been enabled, that the position token ID is set,
    /// and it is the correct time to pump according to `isTimeToPump`.
    /// Transfers msg.value to the sponsor's wallet upon successful validation.
    function tryToEnablePump() external payable {
        require(posTokenId > 0, "n-i");
        require(!pumpEnabled, "already enabled");
        require(isTimeToPump(), "too early");

        uint256 minimumSend = tx.gasprice * CALLBACK_GAS;
        if (msg.value < minimumSend) {
            revert AmountOfEthSentIsTooSmall(msg.value, minimumSend);
        }

        bytes32 requestId = airnodeRrp.makeFullRequest(
            airnode,
            endpointIdUint256,
            bellaDGAddress, //sponsor
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
        require(pendingRequestIds[_requestId], "i-Id");
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
        uint256 pampAmt = (quoteTokenAddress.getBalance() * PUMP_BPS) / BP;
        if (pampAmt > 0) {
            _checkPriceDeviation(); // Internal check for price deviation

            // Perform the swap at the Bella V3 pool
            bellaV3Pool.swap(
                address(this), //recipient
                zeroForTokenIn,
                int256(pampAmt),
                zeroForTokenIn ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1,
                new bytes(0)
            );

            // Burn the acquired Bella tokens
            uint256 burnAmt = balanceOf(address(this));
            _burn(address(this), burnAmt);

            emit Pump(pampAmt, burnAmt);
        }
    }

    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata /*data*/
    ) external {
        require(msg.sender == address(bellaV3Pool), "i-c");
        if (amount0Delta <= 0 && amount1Delta <= 0) {
            revert("invalid swap");
        }

        uint256 amountToPay = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        quoteTokenAddress.safeTransfer(msg.sender, amountToPay);
    }

    function _checkPriceDeviation() private view returns (int24 currentTick) {
        (, currentTick, , , , , ) = bellaV3Pool.slot0();
        uint32[] memory secondsAgo = new uint32[](2);
        secondsAgo[0] = TWAP_DURATION;
        secondsAgo[1] = 0;

        (int56[] memory tickCumulatives, ) = bellaV3Pool.observe(secondsAgo);
        int56 TWAP_DURATIONInt56 = int56(uint56(TWAP_DURATION));

        int56 tickCumulativesDelta = tickCumulatives[1] - tickCumulatives[0];
        int24 avarageTick = int24(tickCumulativesDelta / TWAP_DURATIONInt56);

        if (tickCumulativesDelta < 0 && (tickCumulativesDelta % TWAP_DURATIONInt56 != 0))
            avarageTick--;

        uint256 deviationBps = _getPriceDiviation(
            TickMath.getSqrtRatioAtTick(currentTick),
            TickMath.getSqrtRatioAtTick(avarageTick)
        );

        if (deviationBps > TWAP_DEVIATION) {
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
        deviationBps = FullMath.mulDiv(ratioDeviation, BP, ratioAvg);
    }

    function _getRatio(uint160 sqrtPrice) private pure returns (uint256 ratio) {
        ratio = FullMath.mulDiv(sqrtPrice, sqrtPrice, 1 << 64);
    }
}
