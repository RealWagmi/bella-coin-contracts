// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.23;
import "@openzeppelin/contracts/access/Ownable.sol";
import { RrpRequesterV0 } from "@api3/airnode-protocol/contracts/rrp/requesters/RrpRequesterV0.sol";
import { BellaToken, INonfungiblePositionManager, IUniswapV3Pool, TickMath, FullMath, TransferHelper, IWETH } from "./BellaToken.sol";
import { IUniswapV3Factory } from "./interfaces/uniswap/IUniswapV3Factory.sol";
import { Babylonian } from "./vendor0.8/uniswap/Babylonian.sol";

contract BellaDiceGame is RrpRequesterV0, Ownable {
    using TransferHelper for address;

    struct GameRound {
        bool fulfilled; // whether the request has been successfully fulfilled
        address user;
        uint256 totalBet;
        uint256 totalWinnings;
        uint256[] betAmts;
        uint256[] diceRollResult;
    }

    string public constant name = "Bella Game Points";
    string public constant symbol = "BGP";
    uint8 public constant decimals = 18;
    uint16 public constant observationCardinalityNext = 150;
    uint24 public constant BELLA_V3_FEE_TIERS = 10000;
    int24 public constant BELLA_V3_TICK_SPACING = 200;
    uint256 public constant WIN69_MULTIPLIER = 10;
    uint256 public constant GAME_PERIOD = 10 days;

    uint256 public constant CALLBACK_GAS = 200000;
    uint256 public constant MAX_NUM_WORDS = 3;
    uint256 public constant DELIMITER = 1e18;

    /// @notice Wrapped native token on current network
    // address public immutable wrappedNativeToken;
    address public immutable quoteToken;
    INonfungiblePositionManager public immutable positionManager;
    IUniswapV3Factory public immutable factory;

    BellaToken public bellaToken;
    IUniswapV3Pool public bellaV3Pool;
    address payable public bellaSponsorWallet;
    address payable public gameRngWallet;
    mapping(bool => uint160) public fixedSqrtPrice;

    /// @notice Timestamp when the geme ower
    uint256 public endTime;
    uint256 public maxWaitingTime = 7 days;
    uint256 public uniPosTokenId;

    /// @notice Initial rate of tokens per quoteToken
    uint256 public initialTokenRate;

    uint256 public gameId;
    uint256 public lastFulfilledGameId;

    // The total supply of points in existence
    uint256 public totalSupply;
    // Maps an address to their current balance
    mapping(address => uint256) private userBalances;
    // Maps a game ID to its round information
    mapping(uint256 => GameRound) private gameRounds; /* gameId --> GameRound */
    // Maps an address to their game IDs
    mapping(address => uint256[]) public userGameIds;

    constructor(
        address gameRngWalletAddress,
        address quoteTokenAddress,
        address positionManagerAddress,
        address factoryAddress,
        address airnodeRrpAddress // 0xC02Ea0f403d5f3D45a4F1d0d817e7A2601346c9E for metis
    ) RrpRequesterV0(airnodeRrpAddress) {
        quoteToken = quoteTokenAddress;
        positionManager = INonfungiblePositionManager(positionManagerAddress);
        factory = IUniswapV3Factory(factoryAddress);
        gameRngWallet = payable(gameRngWalletAddress);
    }

    event MintBellaPoints(address recipient, uint256 pointsAmount);
    event BurnBellaPoints(address from, uint256 pointsAmount);
    event StartGame(uint256 initialTokenRate, address bellaSponsorWallet);
    event Bet(uint256 gameId, address user, uint256 totalBetAmt);
    event DiceRollResult(address user, uint256 gameId, int256 result);
    event Redeem(address user, uint256 amount);
    event BellaDeployed(address bellaToken, address bellaV3Pool);
    event DistributeLiquidity(uint256 tokenId);
    event EmergencyWithdraw(address user, uint256 pointsAmount, uint256 withdrawAmt);
    event EmergencyFulFilledLastBet(address user, uint256 gameId);
    event PurchasePoints(address user, uint256 paymentAmount);

    error AmountOfEthSentIsTooSmall(uint256 sent, uint256 minimum);
    error InvalidGameId(uint256 id);
    error InvaliddiceRollResult(uint256 id);

    // Modifiers
    modifier shouldGameIsNotOver() {
        require(gameNotOver(), "game over");
        _;
    }

    modifier shouldGameIsOver() {
        require(gameOver(), "game is NOT over");
        _;
    }

    /// @dev Modifier to check if the current block timestamp is before or equal to the deadline.
    modifier checkDeadline(uint256 deadline) {
        require(_blockTimestamp() <= deadline, "too old");
        _;
    }

    /// @notice Receive ETH and forward to `bellaSponsorWallet`.
    receive() external payable {
        gameRngWallet.transfer(msg.value);
    }

    /**
     * @notice Starts a new game with specific parameters including sponsor wallet, Airnode details, initial token rate, etc.
     * @dev Ensures that initialization happens only once and before the provided deadline.Requires non-zero addresses for sponsor,
     * non-zero initial token rate, and game not already started (initialTokenRate == 0).
     * @param _sponsorWallet The address of the sponsor who will provide funds for the QRNG.
     * @param _initialTokenRate The initial rate used within the game logic, set at the start and never changed afterward.
     * @param deadline A timestamp until which the game can be initiated. Prevents starting the game too late.
     * @custom:modifier onlyOwner Restricts the function's execution to the contract's owner.
     * @custom:modifier checkDeadline Validates that the function is invoked before the specified deadline.
     */
    function startGame(
        address _sponsorWallet,
        uint256 _initialTokenRate,
        uint256 deadline
    ) external payable onlyOwner checkDeadline(deadline) {
        // Ensure the initial token rate is not already set and the provided initial token rate is positive
        require(initialTokenRate == 0 && _initialTokenRate > 0, "o-o");
        // Ensure non-zero addresses are provided for sponsor wallet and Airnode
        require(_sponsorWallet != address(0), "z-a");

        // Set Airnode related information and the sponsor wallet to state variables
        bellaSponsorWallet = payable(_sponsorWallet);
        // Initialize the initial token rate and calculate the end time based on the current timestamp
        initialTokenRate = _initialTokenRate;
        endTime = block.timestamp + GAME_PERIOD;
        maxWaitingTime += endTime;
        if (msg.value > 0) {
            bellaSponsorWallet.transfer(msg.value / 2);
            gameRngWallet.transfer(msg.value / 2);
        }
        emit StartGame(_initialTokenRate, _sponsorWallet);
    }

    /// @notice Retrieves the balance of a given account
    /// @dev Returns the current balance stored in `userBalances`
    /// @param account The address of the user whose balance we want to retrieve
    /// @return The balance of the user
    function balanceOf(address account) public view returns (uint256) {
        return userBalances[account];
    }

    /// @notice Retrieves info of particular game id
    /// @param _gameId game number/id
    /// @return gameInfo GameRound struct
    function getGameRoundInfo(uint256 _gameId) public view returns (GameRound memory gameInfo) {
        gameInfo = gameRounds[_gameId];
    }

    /// @notice Retrieves the list of game IDs associated with a given user
    /// @dev Fetches the array of game IDs from `userGameIds` using `.values()`
    /// @param user The address of the user whose game IDs we want to retrieve
    /// @return ids An array of game IDs that the user participated in
    function getUserGameIds(address user) public view returns (uint256[] memory ids) {
        ids = userGameIds[user];
    }

    /// @notice Retrieves the number of games a user has participated in
    /// @dev Calculates the length of the user's game IDs set
    /// @param user The address of the user whose number of games we want to know
    /// @return num The number of games the user has participated in
    function getUserGamesNumber(address user) public view returns (uint256 num) {
        num = userGameIds[user].length;
    }

    // @notice Retrieves the last game information for a given user
    /// @dev Fetches the last game ID and corresponding round info from `userGameIds` and `gameRounds`
    /// @param user The address of the user whose last game information we want to retrieve
    /// @return id The ID of the last game the user participated in
    /// @return round The GameRound struct containing the details of the game round
    function getUserLastGameInfo(
        address user
    ) public view returns (uint256 id, GameRound memory round) {
        uint256 length = userGameIds[user].length;
        if (length > 0) {
            id = userGameIds[user][length - 1];
            round = gameRounds[id];
        }
    }

    /// @notice Determines whether the game is still ongoing or not
    /// @dev Compares the current block timestamp against `endTime`; also ensures that the game has started by requiring `_endTime` to be non-zero
    /// @return Whether the current time is before the game's end time (`true`) or after (`false`)
    function gameNotOver() public view returns (bool) {
        uint256 _endTime = endTime;
        _checkZero(_endTime);
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
        _checkZero(_endTime);
        return (block.timestamp > _endTime && gameId == lastFulfilledGameId);
    }

    /**
     * @notice Calculates the points amount a user receives for a given payment.
     * @param paymentAmount Amount of the payment currency (e.g., ETH) used to purchase tokens.
     * @return purchaseAmount The resulting amount of tokens that can be purchased with the specified `paymentAmount`.
     */
    function calculatePointsAmount(
        uint256 paymentAmount
    ) public view returns (uint256 purchaseAmount) {
        if (initialTokenRate > 0) {
            purchaseAmount = (paymentAmount * initialTokenRate) / DELIMITER;
        }
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
        if (initialTokenRate > 0) {
            uint256 intermediate = (desiredPointsAmount * DELIMITER);
            paymentAmount = intermediate / _initialTokenRate;
            //round up
            if (paymentAmount == 0 || intermediate % _initialTokenRate > 0) {
                paymentAmount += 1;
            }
        }
    }

    struct GameState {
        uint256 gameId;
        uint256 betNumber;
    }

    /// @dev This function returns the state of games that have not yet been fulfilled.
    /// It constructs an array of `GameState` structures representing each unfulfilled game's
    /// ID and the count of bets placed in that game round.
    /// The function only includes games with IDs greater than `lastFulfilledGameId`.
    /// @return state An array of `GameState` structs for each unfulfilled game.
    function getGameState() public view returns (GameState[] memory state) {
        if (gameId > lastFulfilledGameId) {
            uint256 requests = gameId - lastFulfilledGameId;
            state = new GameState[](requests);
            uint256 index;
            while (lastFulfilledGameId + index < gameId) {
                uint256 id = lastFulfilledGameId + index + 1;
                state[index].gameId = id;
                state[index].betNumber = gameRounds[id].betAmts.length;
                index++;
            }
        }
    }

    /**
     * @dev Bella Token Deployment Parameters Calculation
     * @param deployer The address of the account that would deploy the Bella token
     * @return zeroForBella A boolean indicating whether the Bella token address is less than the Quote Token address
     * @return _sqrtPriceX96 The sqrtPrice required to initialize V3 pool of Bella token
     * @return _bellaToken The address of the Bella token associated with the deployer's address
     */
    function calculateBellaDeployParams(
        address deployer
    ) public view returns (bool zeroForBella, uint160 _sqrtPriceX96, address _bellaToken) {
        _bellaToken = _computeBellaAddress(deployer);
        zeroForBella = _bellaToken < quoteToken;
        uint256 halfBella = totalSupply / 2;
        uint256 halfQuoteToken = quoteToken.getBalance() / 2;

        _sqrtPriceX96 = zeroForBella
            ? uint160(Babylonian.sqrt(FullMath.mulDiv(1 << 192, halfQuoteToken, halfBella)))
            : uint160(Babylonian.sqrt(FullMath.mulDiv(1 << 192, halfBella, halfQuoteToken)));
    }

    /// @notice Allows a user to place a bet on a dice roll(s), record the bet details, and request randomness
    /// @dev Transfers the required ETH to sponsor wallet and creates a new game round with provided bets
    /// @param betAmts An array of amounts representing individual bets for each roll of the dice
    /// @return gameId A unique identifier generated for the game round
    function bet(uint256[] memory betAmts) external payable shouldGameIsNotOver returns (uint256) {
        {
            (uint256 id, GameRound memory round) = getUserLastGameInfo(msg.sender);
            require(round.fulfilled || id == 0, "last round not fulfilled");
        }
        // Check if the number of dice rolls is within the permitted range
        uint256 numWords = betAmts.length;
        require(numWords > 0 && numWords <= MAX_NUM_WORDS, "invalid betAmts");
        // Calculate the total bet amount from the array of bets
        uint256 totalBetAmt;
        for (uint i; i < numWords; ) {
            // Each bet amount must be greater than zero
            _checkZero(betAmts[i]);
            unchecked {
                totalBetAmt += betAmts[i];
                ++i;
            }
        }
        // Ensure the user has enough points to cover their total bet
        // It is possible to resend a bid for the same balance,
        // so this check is also added to the callback function
        require(totalBetAmt <= balanceOf(msg.sender), "points are not enough");
        // user needs to send ether with the transaction
        // user must send enough ether for the callback
        // otherwise the transaction will fail
        uint256 minimumSend = tx.gasprice * CALLBACK_GAS;
        if (msg.value < minimumSend) {
            revert AmountOfEthSentIsTooSmall(msg.value, minimumSend);
        }
        _burnPoints(msg.sender, totalBetAmt);

        unchecked {
            ++gameId;
        }
        uint256 _gameId = gameId;

        // Record the game round details in the contract state
        gameRounds[_gameId] = GameRound({
            fulfilled: false,
            user: msg.sender,
            totalBet: totalBetAmt,
            totalWinnings: 0,
            betAmts: betAmts,
            diceRollResult: new uint256[](betAmts.length)
        });

        // Associate the game ID with the user's address
        userGameIds[msg.sender].push(_gameId);

        emit Bet(_gameId, msg.sender, totalBetAmt);
        // Transfer the received Ether to the sponsor's wallet to cover the callback transaction costs
        gameRngWallet.transfer(msg.value);
        return _gameId;
    }

    struct RandomData {
        uint256 id;
        uint256[] rn;
    }

    /**
     * @notice Fulfills the generation of random words if gas requirement is met
     * @dev Processes each `RandomData` entries until either all are processed or minimum remaining gas is not met
     * @param minRemainingGas The minimum amount of gas that must be left for the function to continue processing
     * @param randomData An array of `RandomData` structs containing the IDs and random number arrays to process
     * Requirements:
     * - Only callable by the `gameRngWallet`.
     * - Will stop processing if the remaining gas is less than `minRemainingGas`.
     * Emits a `RandomWordsFulfilled` event upon successful processing of an entry.
     * Uses the `_fulfillRandomWords` internal function to process each entry.
     */
    function fulfillRandomWords(uint256 minRemainingGas, RandomData[] memory randomData) external {
        require(msg.sender == gameRngWallet, "invalid caller");
        for (uint256 i; i < randomData.length; ) {
            if (gasleft() < minRemainingGas) {
                break;
            }
            _fulfillRandomWords(randomData[i].id, randomData[i].rn);
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Records the result of dice rolls, updates the game round, and handles payouts
    /// @dev Requires the caller to be the designated AirnodeRrp address and checks if the round can be fulfilled
    /// @param _gameId The unique identifier of the game round that the dice roll results correspond to
    /// @param _randomWords The array of random numbers provided by off-chain QRNG service
    ///  Using the QRNG service is free, meaning there is no subscription fee to pay.
    /// There is a gas cost incurred on-chain when Airnode places the random number on-chain in response to a request,
    /// which the requester needs to pay for.
    function _fulfillRandomWords(uint256 _gameId, uint256[] memory _randomWords) private {
        unchecked {
            ++lastFulfilledGameId;
        }
        // Retrieve the game round using the _gameId
        GameRound storage round = gameRounds[_gameId];
        uint256 totalBet = round.totalBet;
        if (_gameId != lastFulfilledGameId || totalBet == 0) {
            revert InvalidGameId(_gameId);
        }

        uint256 length = _randomWords.length;
        if (length != round.diceRollResult.length) {
            revert InvaliddiceRollResult(_gameId);
        }
        // Mark the round as fulfilled
        round.fulfilled = true;
        uint256 totalWinnings;

        uint256 bitDice;
        bool double3;
        for (uint i; i < length; ) {
            // Get the dice number between 1 and 6
            uint256 num = (_randomWords[i] % 6) + 1;
            // Calculate winnings based on even dice numbers
            if (num % 2 == 0) {
                totalWinnings += round.betAmts[i] * 2;
            }
            // Special logic for determining 33
            if (num == 3 && !double3 && bitDice & (1 << num) == (1 << num)) {
                double3 = true;
            }
            bitDice |= (1 << num);
            round.diceRollResult[i] = num;
            unchecked {
                ++i;
            }
        }
        // Special logic for determining winnings if the special 69 condition is met
        // or if the special 666 condition is met
        // or if the special repdigit condition is met
        if (length == 3) {
            //Repdigit
            if ((bitDice & (bitDice - 1)) == 0) {
                totalWinnings = 0;
                if (bitDice == 64) {
                    // 666
                    uint256 balance = balanceOf(round.user);
                    totalBet += balance;
                    _burnPoints(round.user, balance);
                }
            } else if ((bitDice == 72 && !double3) || bitDice == 112) {
                // 69
                totalWinnings = totalBet * WIN69_MULTIPLIER;
            }
        }
        if (totalWinnings > 0) {
            round.totalWinnings = totalWinnings;
            _mintPoints(round.user, totalWinnings);
        }

        emit DiceRollResult(round.user, _gameId, int256(totalWinnings) - int256(totalBet));
    }

    /// @notice Deploys Bella token and sets up a corresponding V3 pool.
    /// Can only be called once after the game has ended and if the Bella token has not been set yet.
    /// @dev This function deploys a new Bella ERC20 token using 'CREATE2' for deterministic addresses,
    /// then checks if a Uniswap V3 pool with the token exists. If not, it creates one. If a pool does
    /// exist but its price is incorrect, the function sets fixedSqrtPrice and aborts deployment to
    /// prevent DOS attacks by preemptive pool creation.
    /// Emits a `BellaDeployed` event upon successful deployment.
    /// @custom:modifier shouldGameIsOver Ensures that this function can only be called after the game is over.
    /// @custom:require "bellaToken already set" Only allows the bellaToken to be deployed once.
    function deployBella() external shouldGameIsOver {
        require(address(bellaToken) == address(0), "already deployed");

        (bool zeroForBella, uint160 sqrtPriceX96, address _bellaToken) = calculateBellaDeployParams(
            msg.sender
        );

        address _quoteToken = quoteToken;
        uint24 _bellaPoolV3feeTiers = BELLA_V3_FEE_TIERS;
        address _bellaV3Pool = factory.getPool(_bellaToken, _quoteToken, _bellaPoolV3feeTiers);

        // The normal scenario is when the Bella pool does not exist.
        if (_bellaV3Pool == address(0)) {
            _bellaV3Pool = factory.createPool(_bellaToken, _quoteToken, _bellaPoolV3feeTiers);
            IUniswapV3Pool(_bellaV3Pool).initialize(sqrtPriceX96);
        } else {
            // The scenario with DOS prevention. Create a pool in advance with the correct price
            // by computing the Bella token address.
            (uint160 sqrtPriceX96current, , , , , , ) = IUniswapV3Pool(_bellaV3Pool).slot0();

            uint160 fSqrtPrice = fixedSqrtPrice[zeroForBella];
            if (fSqrtPrice != 0) {
                sqrtPriceX96 = fSqrtPrice;
            }

            if (sqrtPriceX96current != sqrtPriceX96) {
                fixedSqrtPrice[zeroForBella] = sqrtPriceX96;
                return;
            }
        }
        bellaV3Pool = IUniswapV3Pool(_bellaV3Pool);
        bytes32 salt = keccak256(abi.encode(msg.sender));
        bellaToken = new BellaToken{ salt: salt }(
            address(airnodeRrp),
            _quoteToken,
            address(positionManager),
            bellaSponsorWallet
        );
        require(address(bellaToken) == _bellaToken, "a-m");
        emit BellaDeployed(_bellaToken, _bellaV3Pool);
    }

    /**
     * @notice Distributes liquidity to Bella's liquidity pool.
     * @dev This function manages the distribution of Bella and Quote Token (e.g., WETH) liquidity
     * to the Uniswap V3 pool represented by `bellaV3Pool`. It ensures that there is a Bella token address set
     * (ensuring `deployBella` was called), mints Bella tokens, approves the necessary tokens for the positionManager,
     * and then provides liquidity by minting a new position in the liquidity pool. Finally, it transfers any remaining
     * Quote Token balance to the Bella liquidity vault and initializes it with the provided parameters.
     *
     * Reverts if the bellaToken has not been set, indicating deployBella() should be called first.
     * Also reverts if the Bella vault's initialization fails post-liquidity provision.
     */
    function distributeLiquidity() external {
        require(address(bellaToken) != address(0), "deployBella first");
        require(uniPosTokenId == 0, "already distributed");
        // Increase the observation cardinality for the Bella pool
        bellaV3Pool.increaseObservationCardinalityNext(observationCardinalityNext);
        address _quoteToken = quoteToken;
        // Determine the ordering of token addresses for Bella and Quote Token
        bool zeroForBella = address(bellaToken) < _quoteToken;
        (address token0, address token1) = zeroForBella
            ? (address(bellaToken), _quoteToken)
            : (_quoteToken, address(bellaToken));

        // Retrieve the full range of liquidity ticks for adding liquidity
        (int24 tickLower, int24 tickUpper) = _getFullTickRange();

        uint256 quoteBalance = _quoteToken.getBalance();
        uint256 halfBella = totalSupply / 2;
        uint256 halfNativeToken = quoteBalance / 2;
        (uint256 amount0, uint256 amount1) = zeroForBella
            ? (halfBella, halfNativeToken)
            : (halfNativeToken, halfBella);
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
                fee: BELLA_V3_FEE_TIERS,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(bellaToken),
                deadline: block.timestamp
            })
        );
        // Transfer any remaining Quote Token balance to the Bella liquidity vault
        quoteBalance = _quoteToken.getBalance();
        _quoteToken.safeTransfer(address(bellaToken), quoteBalance);

        airnodeRrp.setSponsorshipStatus(address(bellaToken), true);
        // Initialize the Bella vault with the newly created liquidity position; revert if failed
        bellaToken.initialize(zeroForBella, address(bellaV3Pool), tokenId);
        uniPosTokenId = tokenId;

        emit DistributeLiquidity(tokenId);
    }

    /**
     * @notice Allows users to purchase a specified amount of bella points.
     * @param desiredAmountOut The exact amount of bella points the user wants to purchase.
     */
    function purchasePoints(uint256 desiredAmountOut) external shouldGameIsNotOver {
        _mintPoints(msg.sender, desiredAmountOut);
        uint256 paymentAmount = calculatePaymentAmount(desiredAmountOut);
        quoteToken.safeTransferFrom(msg.sender, address(this), paymentAmount);
        emit PurchasePoints(msg.sender, paymentAmount);
    }

    /// @notice Redeem points for Bella tokens.
    /// @dev Burns points from the redeemer's balance and mints equivalent Bella tokens.
    ///      Emits a Redeem event upon success.
    ///      Requires the game to be over.
    ///      Requires the bellaToken to have been set and the caller to have a non-zero point balance.
    function redeem() external shouldGameIsOver {
        require(uniPosTokenId != 0, "too early");
        uint256 amount = balanceOf(msg.sender);
        _checkZero(amount);
        _burnPoints(msg.sender, amount);
        bellaToken.mint(msg.sender, amount);
        emit Redeem(msg.sender, amount);
    }

    /**
     * @notice Allows users to withdraw their funds from the contract in emergency situations.
     * @dev Withdraws Quote Token proportional to the user's share of the total supply. Can only be called after
     *      a certain time period defined by `endTime + maxWaitingTime` has passed and if no Uniswap position token (uniPosTokenId)
     *      is associated with the contract. It calculates the amount to withdraw based on the balance of `msg.sender` relative
     *      to the total supply, burns the user's points (shares), and transfers the calculated Quote Token amount to
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
        require(block.timestamp > maxWaitingTime && uniPosTokenId == 0, "forbidden");
        uint256 amount = balanceOf(msg.sender);
        _checkZero(amount);
        uint256 balance = quoteToken.getBalance();
        uint256 withdrawAmt = FullMath.mulDiv(balance, amount, totalSupply);
        _burnPoints(msg.sender, amount);
        quoteToken.safeTransfer(msg.sender, withdrawAmt);
        emit EmergencyWithdraw(msg.sender, amount, withdrawAmt);
    }

    /// This can be used to predict the address before deployment.
    /// @param deployer The address of the account that would deploy the Bella token.
    /// @return The anticipated Ethereum address of the to-be-deployed Bella token.
    function _computeBellaAddress(address deployer) private view returns (address) {
        bytes32 salt = keccak256(abi.encode(deployer));
        bytes memory bytecode = type(BellaToken).creationCode;
        bytes32 initCode = keccak256(
            abi.encodePacked(
                bytecode,
                abi.encode(
                    address(airnodeRrp),
                    quoteToken,
                    address(positionManager),
                    bellaSponsorWallet
                )
            )
        );
        return
            address(
                uint160(
                    uint256(
                        keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCode))
                    )
                )
            );
    }

    /**
     * @dev Calculates the full tick range based on the tick spacing of the Bella pool.
     *      The result is the widest valid tick range that can be used for creating a position
     *      on Uniswap v3. This function assumes that `BELLA_V3_TICK_SPACING` is set to the
     *      tick spacing of the Bella pool in which this contract will interact.
     *
     * @return tickLower The lower end of the calculated tick range, aligned with the allowable tick spacing.
     * @return tickUpper The upper end of the calculated tick range, aligned with the allowable tick spacing.
     */
    function _getFullTickRange() private pure returns (int24 tickLower, int24 tickUpper) {
        unchecked {
            int24 tickSpacing = BELLA_V3_TICK_SPACING;
            tickLower = (TickMath.MIN_TICK / tickSpacing) * tickSpacing;
            tickUpper = (TickMath.MAX_TICK / tickSpacing) * tickSpacing;
        }
    }

    /// @notice Mints points and assigns them to a specified account
    /// @dev Increments `userBalances` and `totalSupply` by the given `amount`
    /// @param to The address of the recipient to whom points are to be minted
    /// @param amount The quantity of points to be minted
    function _mintPoints(address to, uint256 amount) private {
        _checkZero(amount);
        userBalances[to] += amount;
        totalSupply += amount;
        emit MintBellaPoints(to, amount);
    }

    /// @notice Burns points from a specified account's balance
    /// @dev Decrements `userBalances` and `totalSupply` by the given `amount`
    /// @param from The address from which points are to be burned
    /// @param amount The quantity of points to be burned
    function _burnPoints(address from, uint256 amount) private {
        _checkZero(amount);
        userBalances[from] -= amount;
        totalSupply -= amount;
        emit BurnBellaPoints(from, amount);
    }

    function _blockTimestamp() private view returns (uint256) {
        return block.timestamp;
    }

    function _checkZero(uint256 amount) private pure {
        require(amount > 0, "is zero");
    }
}
