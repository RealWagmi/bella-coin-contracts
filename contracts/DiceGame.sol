// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.23;
import "@openzeppelin/contracts/access/Ownable.sol";
import { TransferHelper } from "./libraries/TransferHelper.sol";
import { IWETH } from "./interfaces/IWETH.sol";

contract DiceGame is Ownable {
    using TransferHelper for address;

    struct GameRound {
        bool fulfilled; // whether the request has been successfully fulfilled
        address user;
        uint256 totalBet;
        uint256 totalWinnings;
        uint256[] betAmts;
        uint256[] diceRollResult;
    }

    uint256 public constant WIN69_MULTIPLIER = 10;
    uint256 public constant CALLBACK_GAS = 200000;
    uint256 public constant MAX_NUM_WORDS = 3;
    uint256 public constant DELIMITER = 1e18;
    uint8 public constant decimals = 18;
    string public constant name = "Points";
    string public constant symbol = "PTS"; 
    

    uint256 public immutable gamePeriod;
    address public immutable wrappedNative;
    address public immutable V3Deployer;
    address public immutable gameRngWallet;

    /// @notice Timestamp when the geme ower
    uint256 public endTime;
    /// @notice Initial rate of tokens per wrappedNative
    uint256 public initialTokenRate;

    uint256 public gameId;
    uint256 public lastFulfilledGameId;

    // The total supply of points in existence
    uint256 public totalSupply;
    // Maps an address to their current balance
    mapping(address => uint256) private userBalances;
    // Maps a game ID to its round information
    mapping(uint256 => GameRound) public gameRounds; /* gameId --> GameRound */
    // Maps an address to their game IDs
    mapping(address => uint256[]) public userGameIds;

    constructor(address _gameRngWalletAddress, uint _gamePeriod, address _V3Deployer, address _wrappedNative)  {
        gameRngWallet = _gameRngWalletAddress;
        if(_gameRngWalletAddress == address(0) || _V3Deployer == address(0) || _wrappedNative == address(0)) revert ZeroValue();
        if(_gamePeriod < 2 hours || _gamePeriod > 180 days) revert GamePeriod();
        gamePeriod = _gamePeriod;
        wrappedNative = _wrappedNative;
        V3Deployer = _V3Deployer;
        transferOwnership(_V3Deployer);
    }

    event MintPoints(address recipient, uint256 pointsAmount);
    event BurnPoints(address from, uint256 pointsAmount);
    event Redeem(address user, uint256 amount);
    event PurchasePoints(address user, uint256 paymentAmount);
    event Bet(uint256 gameId, address user, uint256 totalBetAmt);

    error AmountOfEthSentIsTooSmall(uint256 sent, uint256 minimum);
    error InvalidGameId(uint256 id);
    error InvaliddiceRollResult(uint256 id);
    error GamePeriod();
    error ZeroValue();
 
    // Modifiers
    modifier shouldGameIsNotOver() {
        require(gameNotOver(), "game over");
        _;
    }

    modifier shouldGameIsOver() {
        require(gameOver(), "game is NOT over");
        _;
    }

    /// @notice Receive ETH and forward to `sponsorWallet`.
    receive() external payable {
        (bool success, ) = gameRngWallet.call{value: msg.value}("");
        require(success);
    }

    /**
     * @notice Starts a new game with specific parameters Airnode details, initial token rate, etc.
     * non-zero initial token rate, and game not already started (initialTokenRate == 0).
     * @param _initialTokenRate The initial rate used within the game logic, set at the start and never changed afterward.
     * @custom:modifier onlyOwner Restricts the function's execution to the contract's owner.
     */
    function startGame(uint _initialTokenRate) external payable onlyOwner  {
        // Ensure the initial token rate is not already set 
        require(initialTokenRate == 0, "o-o");
        // Initialize the initial token rate and calculate the end time based on the current timestamp
        initialTokenRate = _initialTokenRate;
        endTime = block.timestamp + gamePeriod;
        if (msg.value > 0) {
            (bool success, ) = gameRngWallet.call{value: msg.value}("");
            require(success); 
        }
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
        (bool success, ) = gameRngWallet.call{value: msg.value}("");
        require(success);
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
    }

    /**
     * @notice Allows users to purchase a specified amount of points.
     * @param desiredAmountOut The exact amount of points the user wants to purchase.
     */
    function purchasePoints(uint256 desiredAmountOut) external payable shouldGameIsNotOver {
        uint256 paymentAmount = calculatePaymentAmount(desiredAmountOut);
        if(msg.value > 0) {
            require(paymentAmount == msg.value, "wrong value");
            IWETH(wrappedNative).deposit{value: msg.value}();
        } else {
            wrappedNative.safeTransferFrom(msg.sender, address(this), paymentAmount);
        }
        _mintPoints(msg.sender, desiredAmountOut);
        emit PurchasePoints(msg.sender, paymentAmount);
    }

     /**
     * @notice Calculates the payment amount required for purchasing a specific amount of points.
     * @param desiredPointsAmount The desired amount of points.
     * @return paymentAmount The corresponding amount of payment currency needed to purchase the points.
     */
    function calculatePaymentAmount(uint256 desiredPointsAmount) public view returns (uint256 paymentAmount) {
        uint256 _initialTokenRate = initialTokenRate;
        if (_initialTokenRate > 0) {
            uint256 intermediate = (desiredPointsAmount * DELIMITER); 
            paymentAmount = intermediate / _initialTokenRate; 
            //round up
            if (paymentAmount == 0 || intermediate % _initialTokenRate > 0) {
                paymentAmount += 1;
            }
        } else {
            revert ZeroValue();
        }
    }

     /**
     * @notice Calculates the points amount a user receives for a given payment.
     * @param paymentAmount Amount of the payment currency (e.g., ETH) used to purchase tokens.
     * @return purchaseAmount The resulting amount of tokens that can be purchased with the specified `paymentAmount`.
     */
    function calculatePointsAmount(uint256 paymentAmount) public view returns (uint256 purchaseAmount) {
        if (initialTokenRate > 0) {
            purchaseAmount = (paymentAmount * initialTokenRate) / DELIMITER;
        }
    }


    function sendLiquidity() external shouldGameIsOver  onlyOwner returns (uint amount, uint totalPTS){
        amount = wrappedNative.getBalance();
        wrappedNative.safeTransfer(V3Deployer, amount);
        totalPTS = totalSupply;
    }

    /// @notice Redeem points for tokens.
    /// @dev Burns points from the redeemer's balance and mints equivalent tokens.
    ///      Emits a Redeem event upon success.
    ///      Requires the game to be over.
    ///      Requires the Token to have been set and the caller to have a non-zero point balance.
    function redeem() external shouldGameIsOver {
        uint256 amount = balanceOf(msg.sender);
        _checkZero(amount);
        _burnPoints(msg.sender, amount);
        (bool success, ) = V3Deployer.call(
            abi.encodeWithSignature(
                "redeem(address,uint256)",
                msg.sender,
                amount)
        );
        require(success);
        emit Redeem(msg.sender, amount);
    }

   
    /// @notice Mints points and assigns them to a specified account
    /// @dev Increments `userBalances` and `totalSupply` by the given `amount`
    /// @param to The address of the recipient to whom points are to be minted
    /// @param amount The quantity of points to be minted
    function _mintPoints(address to, uint256 amount) private {
        _checkZero(amount);
        userBalances[to] += amount;
        totalSupply += amount;
        emit MintPoints(to, amount);
    }

    /// @notice Burns points from a specified account's balance
    /// @dev Decrements `userBalances` and `totalSupply` by the given `amount`
    /// @param from The address from which points are to be burned
    /// @param amount The quantity of points to be burned
    function _burnPoints(address from, uint256 amount) private {
        _checkZero(amount);
        userBalances[from] -= amount;
        totalSupply -= amount;
        emit BurnPoints(from, amount);
    }

    function _checkZero(uint256 amount) private pure {
        require(amount > 0, "is zero");
    }
}
