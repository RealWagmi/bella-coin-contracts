// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.23;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { VRFV2WrapperConsumerBase } from "@chainlink/contracts/src/v0.8/vrf/VRFV2WrapperConsumerBase.sol";
import { IWETH } from "./interfaces/IWETH.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { Bella } from "./Bella.sol";
import { IBellaVault } from "./interfaces/IBellaVault.sol";
import { INonfungiblePositionManager } from "./interfaces/uniswap/INonfungiblePositionManager.sol";
import { IUniswapV3Pool } from "./interfaces/uniswap/IUniswapV3Pool.sol";
import { IUniswapV3Factory } from "./interfaces/uniswap/IUniswapV3Factory.sol";
import { TickMath } from "./vendor0.8/uniswap/TickMath.sol";
import { Babylonian } from "./vendor0.8/uniswap/Babylonian.sol";
import { SafeCast } from "./vendor0.8/uniswap/SafeCast.sol";
import { LiquidityAmounts, FullMath } from "./vendor0.8/uniswap/LiquidityAmounts.sol";
import { AmountsLiquidity } from "./libraries/AmountsLiquidity.sol";
import { TransferHelper } from "./libraries/TransferHelper.sol";

// import "hardhat/console.sol";

contract BellaDiceGame is VRFV2WrapperConsumerBase, Ownable {
    using TransferHelper for address;
    using EnumerableSet for EnumerableSet.UintSet;
    using SafeCast for uint256;

    struct GameRound {
        bool fulfilled; // whether the request has been successfully fulfilled
        address user;
        uint256 totalBet;
        uint256 totalWinnings;
        uint256[] betAmts;
        uint256[] diceRollResult;
    }

    uint8 public constant decimals = 18;
    uint256 public constant WIN69_MULTIPLIER = 10;
    uint256 public constant GAME_PERIOD = 10 days;
    uint256 public constant maxWaitingTime = 7 days;
    // Cannot exceed VRFV2Wrapper.getConfig().maxNumWords.
    uint256 public constant MAX_NUM_WORDS = 3;
    // The default is 3, but you can set this higher.
    uint16 public constant requestConfirmations = 3;
    uint24 public constant bellaPoolV3feeTiers = 10000;
    int24 public constant bellaPoolV3TickSpacing = 200;

    address public immutable bellaLiquidityVaultAddress;
    INonfungiblePositionManager public immutable positionManager;
    IUniswapV3Factory public immutable factory;
    Bella public bellaToken;
    IUniswapV3Pool public bellaV3Pool;
    /// @notice Wrapped native token on current network
    address public immutable wrappedNativeToken;
    uint256 public immutable oneNativeToken;
    /// @notice Timestamp when the geme ower
    uint256 public endTime;
    uint256 uniPosTokenId;

    // Test and adjust
    // this limit based on the network that you select, the size of the request,
    // and the processing of the callback request in the fulfillRandomWords()
    // function.
    uint32 callbackGasLimit = 200000;
    /// @notice Initial rate of tokens per wrappedNativeToken
    uint256 public initialTokenRate;
    string public constant name = "Bella Dice Game";
    string public symbol = "BellaPoints";
    // The total supply of points in existence
    uint256 public totalSupply;
    uint256 public lastgameId;
    uint256 public delpoyRequestId;
    // Maps an address to their current balance
    mapping(address => uint256) private userBalances;
    // Maps a game ID to its round information
    mapping(uint256 => GameRound) public gameRounds; /* gameId --> GameRound */
    // Maps an address to their game IDs
    mapping(address => EnumerableSet.UintSet) private userGameIds;

    constructor(
        address linkAddress,
        address wrapperAddress,
        address wrappedNativeTokenAddress,
        address liquidityVaultAddress,
        address positionManagerAddress,
        address factoryAddress
    ) VRFV2WrapperConsumerBase(linkAddress, wrapperAddress) {
        require(liquidityVaultAddress != address(0), "liquidityVaultAddress zero");
        bellaLiquidityVaultAddress = liquidityVaultAddress;
        wrappedNativeToken = wrappedNativeTokenAddress;
        oneNativeToken = 10 ** IERC20Metadata(wrappedNativeTokenAddress).decimals();
        positionManager = INonfungiblePositionManager(positionManagerAddress);
        factory = IUniswapV3Factory(factoryAddress);
    }

    event MintBellaPoints(address recipient, uint256 pointsAmount);
    event BurnBellaPoints(address from, uint256 pointsAmount);
    event StartGame(uint256 initialTokenRate);
    event Bet(uint256 gameId, address user, uint256 totalBetAmt);
    event DiceRollResult(address user, uint256 gameId);
    event Redeem(address user, uint256 amount);
    event BellaDeployed(address bellaToken, address bellaV3Pool);
    event DistributeLiquidity(uint256 tokenId);
    event EmergencyWithdraw(address user, uint256 pointsAmount, uint256 withdrawAmt);
    event EmergencyFulFilledLastBet(address user, uint256 gameId);

    error NotEnoughLINK(uint256 balanceLink, uint256 requiredAmt);

    // Modifiers
    modifier shouldGameIsNotOver() {
        require(gameNotOver(), "game over");
        _;
    }

    modifier shouldGameIsOver() {
        require(gameOver(), "game is NOT over");
        _;
    }

    /**
     * @notice Allows the sending of Ether to the contract to purchase tokens automatically at the current rate.
     * @dev When Ether is sent to the contract, it calculates the token amount, and wraps the Ether into weth9.
     */
    receive() external payable shouldGameIsNotOver {
        uint256 amount = calculatePointsAmount(msg.value);
        _mintPoints(msg.sender, amount);
        IWETH(wrappedNativeToken).deposit{ value: msg.value }();
    }

    /**
     * Allow withdraw of Link tokens from the contract
     */
    function withdrawLink() external onlyOwner {
        address(LINK).safeTransfer(owner(), address(LINK).getBalance());
    }

    /// @notice Sets a new callback gas limit
    /// @dev Require that the caller must be contract owner
    /// @param _callbackGasLimit The new gas limit to set for callbacks
    function setCallbackGasLimit(uint32 _callbackGasLimit) external onlyOwner {
        callbackGasLimit = _callbackGasLimit;
    }

    /**
     * @notice Initializes a new game with a given token rate.
     * @dev This function sets the initial token rate for a game and starts the countdown for the game period.
     * It can only be called once as it requires the `initialTokenRate` to be zero and the incoming rate `_initialTokenRate` to be positive.
     * Also, it ensures that the BellaVault is owned by this contract before proceeding.
     * The `GAME_PERIOD` constant defines how long the game will last from the point of starting.
     * Once the requirements are satisfied, the game begins by setting the `initialTokenRate` and `endTime`.
     * It emits a `StartGame` event upon successful execution.
     * The `onlyOwner` modifier restricts the function to be callable only by the contract owner.
     * Reverts if trying to set an initial token rate more than once or if it's not greater than zero,
     * or if the BellaVault is not owned by this contract.
     *
     * @param _initialTokenRate The exchange rate at which the game starts, specified in desired tokens per unit of payment token.
     */
    function startGame(uint256 _initialTokenRate) external onlyOwner {
        require(initialTokenRate == 0 && _initialTokenRate > 0, "only once");
        require(
            IBellaVault(bellaLiquidityVaultAddress).owner() == address(this),
            "vault not owned by this contract"
        );
        require(address(LINK).getBalance() > 0, "no LINK");
        initialTokenRate = _initialTokenRate;
        endTime = block.timestamp + GAME_PERIOD;
        emit StartGame(_initialTokenRate);
    }

    /**
     * @notice Fulfill the last bet of a user in case of an emergency. This action can only be taken by the contract owner.
     *         It sets the `fulfilled` flag to true, mints points to the user equivalent to their total bet, and then resets the total bet.
     * @dev This function finds the last game information for the user, checks whether the round exists and if it's unfulfilled,
     *      marks it as fulfilled, mints points, and sets the total bet to zero.
     *      Emits the {EmergencyFulFilledLastBet} event upon completion.
     *      The function requires that the user has at least one unfulfilled game round and that the caller is the contract owner.
     * @param user The address of the user whose last bet needs to be emergency fulfilled.
     */
    function emergencyFulFilledLastBet(address user) external onlyOwner {
        (uint256 id, GameRound memory mRound) = getUserLastGameInfo(user);
        require(mRound.user != address(0), "round not found");
        require(mRound.fulfilled == false, "forbidden");
        GameRound storage round = gameRounds[id];
        round.fulfilled = true;
        _mintPoints(user, round.totalBet);
        round.totalBet = 0;
        emit EmergencyFulFilledLastBet(user, id);
    }

    /// @notice Retrieves the balance of a given account
    /// @dev Returns the current balance stored in `userBalances`
    /// @param account The address of the user whose balance we want to retrieve
    /// @return The balance of the user
    function balanceOf(address account) public view returns (uint256) {
        return userBalances[account];
    }

    /// @notice Retrieves the list of game IDs associated with a given user
    /// @dev Fetches the array of game IDs from `userGameIds` using `.values()`
    /// @param user The address of the user whose game IDs we want to retrieve
    /// @return ids An array of game IDs that the user participated in
    function getUserGameIds(address user) public view returns (uint256[] memory ids) {
        ids = userGameIds[user].values();
    }

    /// @notice Retrieves the number of games a user has participated in
    /// @dev Calculates the length of the user's game IDs set
    /// @param user The address of the user whose number of games we want to know
    /// @return num The number of games the user has participated in
    function getUserGamesNumber(address user) public view returns (uint256 num) {
        num = userGameIds[user].length();
    }

    // @notice Retrieves the last game information for a given user
    /// @dev Fetches the last game ID and corresponding round info from `userGameIds` and `gameRounds`
    /// @param user The address of the user whose last game information we want to retrieve
    /// @return id The ID of the last game the user participated in
    /// @return round The GameRound struct containing the details of the game round
    function getUserLastGameInfo(
        address user
    ) public view returns (uint256 id, GameRound memory round) {
        EnumerableSet.UintSet storage set = userGameIds[user];
        uint256 length = set.length();
        if (length > 0) {
            id = set.at(length - 1);
            round = gameRounds[id];
        }
    }

    /// @notice Determines whether the game is still ongoing or not
    /// @dev Compares the current block timestamp against `endTime`; also ensures that the game has started by requiring `_endTime` to be non-zero
    /// @return Whether the current time is before the game's end time (`true`) or after (`false`)
    function gameNotOver() public view returns (bool) {
        uint256 _endTime = endTime;
        require(_endTime > 0, "game not started yet");
        return block.timestamp < _endTime;
    }

    /**
     * @notice Checks if the game has been concluded based on the time limit.
     * @dev Returns true if the current block timestamp exceeds the end time of the game by 10 minutes.
     *      This implies a grace period of 10 minutes after the official end time before declaring the game over.
     *      The function requires that `endTime` is set and the game has started, otherwise it reverts with an error message.
     *
     * @return A boolean value indicating whether the game is over (true) or not (false).
     */
    function gameOver() public view returns (bool) {
        uint256 _endTime = endTime;
        require(_endTime > 0, "game not started yet");
        return block.timestamp > _endTime + 10 minutes;
    }

    /**
     * @notice Calculates the points amount a user receives for a given payment.
     * @param paymentAmount Amount of the payment currency (e.g., ETH) used to purchase tokens.
     * @return purchaseAmount The resulting amount of tokens that can be purchased with the specified `paymentAmount`.
     */
    function calculatePointsAmount(
        uint256 paymentAmount
    ) public view returns (uint256 purchaseAmount) {
        purchaseAmount = (paymentAmount * initialTokenRate) / oneNativeToken;
    }

    /**
     * @notice Calculates the payment amount required for purchasing a specific amount of bella points.
     * @param desiredPointsAmount The desired amount of bella points.
     * @return paymentAmount The corresponding amount of payment currency needed to purchase the bella points.
     */
    function calculatePaymentAmount(
        uint256 desiredPointsAmount
    ) public view returns (uint256 paymentAmount) {
        uint256 _initialTokenRate = initialTokenRate;
        uint256 intermediate = (desiredPointsAmount * oneNativeToken);
        paymentAmount = intermediate / _initialTokenRate;
        //round up
        if (paymentAmount == 0 || intermediate % _initialTokenRate > 0) {
            paymentAmount += 1;
        }
    }

    /// @notice This function allows a user to place a bet if the current game is not over.
    /// @dev Emits the `Bet` event upon successful execution of the function, burns points from the sender's balance,
    /// calculates the required LINK for the VRF request, and sets up the new game round.
    /// The caller of this function should ensure the last game round has been fulfilled.
    /// Also, the caller must have enough points to cover the total bet amount and the contract must have enough LINK to fulfill the VRF request.
    /// @param betAmts An array of bet amounts that the user wishes to wager on the next game round.
    /// Each amount must be greater than zero.
    /// @return gameId The unique identifier for the game that the bet was placed on.
    /// @custom:modifier shouldGameIsNotOver Ensures that the game is still ongoing before allowing the bet.
    function bet(uint256[] memory betAmts) external shouldGameIsNotOver returns (uint256 gameId) {
        {
            (, GameRound memory round) = getUserLastGameInfo(msg.sender);
            require(round.fulfilled || round.totalBet == 0, "last round not fulfilled");
        }
        uint32 numWords = uint32(betAmts.length);
        require(numWords > 0 && numWords <= MAX_NUM_WORDS, "invalid betAmts");
        uint256 totalBetAmt;
        for (uint i; i < betAmts.length; ) {
            require(betAmts[i] > 0, "zero amount");
            totalBetAmt += betAmts[i];
            unchecked {
                ++i;
            }
        }
        require(totalBetAmt <= balanceOf(msg.sender), "points are not enough");
        _burnPoints(msg.sender, totalBetAmt);
        {
            uint256 requiredAmt = VRF_V2_WRAPPER.calculateRequestPrice(callbackGasLimit);
            uint256 balanceLink = LINK.balanceOf(address(this));
            if (balanceLink < requiredAmt) {
                revert NotEnoughLINK(balanceLink, requiredAmt);
            }
        }

        gameId = requestRandomness(callbackGasLimit, requestConfirmations, numWords);

        gameRounds[gameId] = GameRound({
            fulfilled: false,
            user: msg.sender,
            totalBet: totalBetAmt,
            totalWinnings: 0,
            betAmts: betAmts,
            diceRollResult: new uint256[](betAmts.length)
        });
        userGameIds[msg.sender].add(gameId);
        lastgameId = gameId;
        emit Bet(gameId, msg.sender, totalBetAmt);
    }

    /**
     * @notice Deploys the Bella token once the game is over.
     * @dev This function deploys the Bella token by requesting randomness from Chainlink's VRF (Verifiable Random Function)
     * and transferring the required amount of LINK tokens for the VRF request. It ensures that the deployment happens only once
     * by requiring that the `bellaToken` address is not already set. The `shouldGameIsOver` modifier ensures that the contract's state
     * allows for the Bella token to be deployed, typically after the game has concluded.
     *
     * Reverts if the bellaToken has been set prior to this call meaning the Bella token has already been deployed.
     * Note: The LINK token must be approved by the caller to cover the fee for the randomness request.
     *
     * @param gasLimit The maximum gas price allowed for the callback of the randomness request.
     */
    function deployBalla(uint32 gasLimit) external shouldGameIsOver {
        require(address(bellaToken) == address(0), "bellaToken already set");
        // https://docs.chain.link/vrf/v2/estimating-costs
        uint256 requiredAmt = VRF_V2_WRAPPER.calculateRequestPrice(callbackGasLimit);
        // need to approve LINK token
        address(LINK).safeTransferFrom(msg.sender, address(this), requiredAmt);
        delpoyRequestId = requestRandomness(gasLimit, requestConfirmations, 1);
    }

    /**
     * @notice Distributes liquidity to Bella's liquidity pool.
     * @dev This function manages the distribution of Bella and Wrapped Native Token (e.g., WETH) liquidity
     * to the Uniswap V3 pool represented by `bellaV3Pool`. It ensures that there is a Bella token address set
     * (ensuring `deployBalla` was called), mints Bella tokens, approves the necessary tokens for the positionManager,
     * and then provides liquidity by minting a new position in the liquidity pool. Finally, it transfers any remaining
     * Wrapped Native Token balance to the Bella liquidity vault and initializes it with the provided parameters.
     *
     * Reverts if the bellaToken has not been set, indicating deployBalla() should be called first.
     * Also reverts if the Bella vault's initialization fails post-liquidity provision.
     */
    function distributeLiquidity() external {
        require(address(bellaToken) != address(0), "call deployBalla() first");

        // Determine the ordering of token addresses for Bella and Wrapped Native Token
        bool zeroForBella = address(bellaToken) < wrappedNativeToken;
        address token0 = zeroForBella ? address(bellaToken) : wrappedNativeToken;
        address token1 = zeroForBella ? wrappedNativeToken : address(bellaToken);
        // Retrieve the full range of liquidity ticks for adding liquidity
        (int24 tickLower, int24 tickUpper) = _getFullTickRange();
        // Get the current price and balances required for providing liquidity
        (uint160 sqrtPriceX96, , , , , , ) = bellaV3Pool.slot0();
        uint256 weth9Balance = wrappedNativeToken.getBalance();
        (uint256 amount0, uint256 amount1) = _getAmounts(
            zeroForBella,
            tickLower,
            tickUpper,
            sqrtPriceX96,
            weth9Balance
        );
        // Mint Bella tokens required to add liquidity
        bellaToken.mint(address(this), zeroForBella ? amount0 : amount1);
        // Approve tokens for liquidity provision to the positionManager
        token0.safeApprove(address(positionManager), amount0);
        token1.safeApprove(address(positionManager), amount1);
        // Provide liquidity to the pool via positionManager and receive an NFT token ID
        (uint256 tokenId, , , ) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: bellaPoolV3feeTiers,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: bellaLiquidityVaultAddress,
                deadline: block.timestamp
            })
        );
        // Transfer any remaining Wrapped Native Token balance to the Bella liquidity vault
        weth9Balance = wrappedNativeToken.getBalance();
        wrappedNativeToken.safeTransfer(bellaLiquidityVaultAddress, weth9Balance);
        // Initialize the Bella vault with the newly created liquidity position; revert if failed
        require(
            IBellaVault(bellaLiquidityVaultAddress).initialize(
                zeroForBella,
                address(bellaToken),
                wrappedNativeToken,
                address(positionManager),
                address(bellaV3Pool),
                tokenId
            ),
            "vault initialization failed"
        );
        uniPosTokenId = tokenId;
        emit DistributeLiquidity(tokenId);
    }

    /// @notice This function is called as a callback from Chainlink's VRF to provide
    /// randomness for the game logic and updates the corresponding game round with results.
    /// @dev Iterates over `_randomWords`, interprets each as a dice roll, calculates winnings,
    /// and mints reward points if applicable. Emits `DiceRollResult` event upon completion.
    /// @param _gameId The unique identifier of the game round to fulfill.
    /// @param _randomWords An array of random words returned by the VRF callback.
    /// Each element represents a die roll outcome which is calculated as `(_randomWords[i] % 6) + 1`.
    /// @custom:require "round not found" The game round must be initiated before it can be fulfilled.
    /// @custom:require "invalid randomWords" The number of random words provided must match the number
    /// of dice rolls expected for the round (i.e., the length of `diceRollResult` array in the GameRound struct).
    function fulfillRandomWords(uint256 _gameId, uint256[] memory _randomWords) internal override {
        if (delpoyRequestId != _gameId) {
            GameRound storage round = gameRounds[_gameId];
            require(round.user == address(0), "round not found");
            uint256 length = _randomWords.length;
            require(length == round.diceRollResult.length, "invalid randomWords");
            uint256 totalWinnings;
            uint256 sum69;
            bool sixFound;
            for (uint i; i < length; ) {
                uint256 num = (_randomWords[i] % 6) + 1;
                if (num == 2 || num == 4 || num == 6) {
                    totalWinnings += round.betAmts[i] * num;
                    if (length == 3) {
                        if (num == 6 && !sixFound) {
                            sixFound = true;
                        } else {
                            sum69 += num;
                        }
                    }
                }
                round.diceRollResult[i] = num;
                unchecked {
                    ++i;
                }
            }
            if (length == 3 && sum69 == 9 && sixFound) {
                totalWinnings = 0;
                for (uint i; i < length; ) {
                    totalWinnings += round.betAmts[i] * WIN69_MULTIPLIER;
                }
            }

            round.totalWinnings = totalWinnings;
            round.fulfilled = true;
            _mintPoints(round.user, totalWinnings);

            emit DiceRollResult(round.user, _gameId);
        } else if (address(bellaToken) == address(0)) {
            bytes32 salt = keccak256(abi.encode(_randomWords[0], address(this)));
            bellaToken = new Bella{ salt: salt }("Bella", "Bella", decimals);
            bellaV3Pool = IUniswapV3Pool(
                factory.createPool(address(bellaToken), wrappedNativeToken, bellaPoolV3feeTiers)
            );
            uint160 sqrtPriceX96 = _calculateSqrtPriceX96();
            bellaV3Pool.initialize(sqrtPriceX96);
            emit BellaDeployed(address(bellaToken), address(bellaV3Pool));
        }
    }

    /**
     * @notice Allows users to purchase a specified amount of bella points.
     * @param desiredAmountOut The exact amount of bella points the user wants to purchase.
     */
    function purchasePoints(uint256 desiredAmountOut) external shouldGameIsNotOver {
        _mintPoints(msg.sender, desiredAmountOut);
        uint256 paymentAmount = calculatePaymentAmount(desiredAmountOut);
        wrappedNativeToken.safeTransferFrom(msg.sender, address(this), paymentAmount);
    }

    /// @notice Redeem points for Bella tokens.
    /// @dev Burns points from the redeemer's balance and mints equivalent Bella tokens.
    ///      Emits a Redeem event upon success.
    ///      Requires the game to be over.
    ///      Requires the bellaToken to have been set and the caller to have a non-zero point balance.
    function redeem() external shouldGameIsOver {
        require(uniPosTokenId != 0, "not distributed liquidity");
        uint256 amount = balanceOf(msg.sender);
        require(amount > 0, "zero balance");
        _burnPoints(msg.sender, amount);
        bellaToken.mint(msg.sender, amount);
        emit Redeem(msg.sender, amount);
    }

    /**
     * @notice Allows users to withdraw their funds from the contract in emergency situations.
     * @dev Withdraws Wrapped Native Token proportional to the user's share of the total supply. Can only be called after
     *      a certain time period defined by `endTime + maxWaitingTime` has passed and if no Uniswap position token (uniPosTokenId)
     *      is associated with the contract. It calculates the amount to withdraw based on the balance of `msg.sender` relative
     *      to the total supply, burns the user's points (shares), and transfers the calculated Wrapped Native Token amount to
     *      `msg.sender`.
     *
     * Requirements:
     * - The current block timestamp must be greater than endTime plus maxWaitingTime.
     * - The uniPosTokenId must be 0 (no active Uniswap position).
     * - The `msg.sender` must have a non-zero balance within the contract.
     *
     * Emits an `EmergencyWithdraw` event indicating who withdrew, how many points were burned, and the amount withdrawn.
     */
    function emergencyWithdraw() external {
        require(block.timestamp > (endTime + maxWaitingTime) && uniPosTokenId == 0, "forbidden");
        uint256 amount = balanceOf(msg.sender);
        require(amount > 0, "zero balance");
        uint256 balance = wrappedNativeToken.getBalance();
        uint256 withdrawAmt = FullMath.mulDiv(balance, amount, totalSupply);
        _burnPoints(msg.sender, amount);
        wrappedNativeToken.safeTransfer(msg.sender, withdrawAmt);
        emit EmergencyWithdraw(msg.sender, amount, withdrawAmt);
    }

    /**
     * @dev Calculates the square root of the price, scaled by 2^96.
     *      The calculation is done by obtaining the square root of the product of the total number of Bella tokens
     *      and Wrapped Native Tokens, divided by 2 to get an average. This is used to calculate a normalized price of tokens
     *      in terms of each other, which can be useful for certain financial operations such as providing liquidity or pricing swaps.
     *      The function determines the order of division based on the addresses of `bellaToken` and `wrappedNativeToken` to ensure
     *      a consistent result regardless of the pair ordering.
     *
     * @return sqrtPriceX96 The square root of the calculated price, represented as a fixed-point number with 96 bits
     *                      representing the fractional part. This format is commonly used for representing prices in Uniswap v3.
     */
    function _calculateSqrtPriceX96() private view returns (uint160 sqrtPriceX96) {
        bool zeroForBella = address(bellaToken) < wrappedNativeToken;
        uint256 halfBella = totalSupply / 2;
        uint256 halfNativeToken = wrappedNativeToken.getBalance() / 2;

        uint256 sqrtPrice = zeroForBella
            ? uint160(Babylonian.sqrt(FullMath.mulDiv(1 << 192, halfNativeToken, halfBella)))
            : uint160(Babylonian.sqrt(FullMath.mulDiv(1 << 192, halfBella, halfNativeToken)));
        sqrtPriceX96 = sqrtPrice.toUint160();
    }

    /**
     * @dev Computes the amounts of `token0` and `token1` that correspond to a given liquidity range.
     *      The amounts are calculated based on the current price, specified as `sqrtPriceX96`, along with
     *      a range defined by `tickLower` and `tickUpper`. The balance of WETH (or similar wrapped token) is passed
     *      in `weth9Balance`. This function accommodates for scenarios where you need to calculate amounts when adding
     *      or removing liquidity from Uniswap v3 positions.
     *
     * @param zeroForBella If true, Bella token's address is lower than WETH and it is treated as `token0`.
     *                     If false, it is treated as `token1`.
     * @param tickLower The lower end of the tick range for the Uniswap v3 position.
     * @param tickUpper The upper end of the tick range for the Uniswap v3 position.
     * @param sqrtPriceX96 The square root of the current price for the position, scaled by 2^96.
     * @param weth9Balance The balance of the Wrapped Ether (or equivalent) token involved in the position.
     * @return amount0 The computed amount of `token0` (Bella if `zeroForBella` is true), rounded up.
     * @return amount1 The computed amount of `token1` (Bella if `zeroForBella` is false), rounded up.
     */
    function _getAmounts(
        bool zeroForBella,
        int24 tickLower,
        int24 tickUpper,
        uint160 sqrtPriceX96,
        uint256 weth9Balance
    ) private view returns (uint256 amount0, uint256 amount1) {
        uint256 halfBella = totalSupply / 2;
        uint256 halfNativeToken = weth9Balance / 2;
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtRatioAtTick(tickLower),
            TickMath.getSqrtRatioAtTick(tickUpper),
            zeroForBella ? halfBella : halfNativeToken,
            zeroForBella ? halfNativeToken : halfBella
        );

        (amount0, amount1) = AmountsLiquidity.getAmountsRoundingUpForLiquidity(
            sqrtPriceX96,
            TickMath.getSqrtRatioAtTick(tickLower),
            TickMath.getSqrtRatioAtTick(tickUpper),
            liquidity
        );
    }

    /**
     * @dev Calculates the full tick range based on the tick spacing of the Bella pool.
     *      The result is the widest valid tick range that can be used for creating a position
     *      on Uniswap v3. This function assumes that `bellaPoolV3TickSpacing` is set to the
     *      tick spacing of the Bella pool in which this contract will interact.
     *
     * @return tickLower The lower end of the calculated tick range, aligned with the allowable tick spacing.
     * @return tickUpper The upper end of the calculated tick range, aligned with the allowable tick spacing.
     */
    function _getFullTickRange() private pure returns (int24 tickLower, int24 tickUpper) {
        int24 tickSpacing = bellaPoolV3TickSpacing;
        tickLower = (TickMath.MIN_TICK / tickSpacing) * tickSpacing;
        tickUpper = (TickMath.MAX_TICK / tickSpacing) * tickSpacing;
    }

    /// @notice Mints points and assigns them to a specified account
    /// @dev Increments `userBalances` and `totalSupply` by the given `amount`
    /// @param to The address of the recipient to whom points are to be minted
    /// @param amount The quantity of points to be minted
    function _mintPoints(address to, uint256 amount) private {
        require(amount > 0, "amount is too small");
        userBalances[to] += amount;
        totalSupply += amount;
        emit MintBellaPoints(to, amount);
    }

    /// @notice Burns points from a specified account's balance
    /// @dev Decrements `userBalances` and `totalSupply` by the given `amount`
    /// @param from The address from which points are to be burned
    /// @param amount The quantity of points to be burned
    function _burnPoints(address from, uint256 amount) private {
        require(amount > 0, "amount is too small");
        userBalances[from] -= amount;
        totalSupply -= amount;
        emit BurnBellaPoints(from, amount);
    }
}
