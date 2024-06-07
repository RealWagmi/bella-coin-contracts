// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.23;
import "@openzeppelin/contracts/access/Ownable.sol";
import { RrpRequesterV0 } from "@api3/airnode-protocol/contracts/rrp/requesters/RrpRequesterV0.sol";
import { Token, INonfungiblePositionManager, IUniswapV3Pool, TickMath, FullMath, TransferHelper } from "./Token.sol";
import { IUniswapV3Factory } from "./interfaces/uniswap/IUniswapV3Factory.sol";
import { Babylonian } from "./vendor0.8/uniswap/Babylonian.sol";

contract V3Deployer is RrpRequesterV0, Ownable {
    using TransferHelper for address;

    struct TokenParams {
        string name;
        string symbol;
        uint pumpInterval;
        uint pumpBPS;
        uint tokenBPS;
        uint24 V3_fee;
    }

    uint16 private constant observationCardinalityNext = 150;
    uint256 private constant BP = 10_000;
 
    /// @notice Wrapped native token on current network
    address public immutable wrappedNative;
    address public sponsorWallet;
    address public activeGame;
    INonfungiblePositionManager public immutable positionManager;
    IUniswapV3Factory public immutable factory;
   
    struct TokenInfo {
        Token memeToken;
        IUniswapV3Pool V3Pool;
        string name;
        string symbol;
        uint uniPosTokenId;
        uint pumpInterval;      // how much time we will wait, until we can roll  chance for pump
        uint pumpBPS;           // how much stored liquidity will be involved in pump
        uint tokenBPS;          // percent of total game points and total game liquidity for this token, according to voting
        uint24 V3_fee;
        int24 tickSpacing;
    }

    struct Info {
        uint gameLiquidity;     //  total game liquidity accumulated during game period
        uint liquidityBPS;      //  percent of game liquidity which will be distributed during token creation
        uint PTStotalSupply;    //  totalSupply of game points
        mapping(bytes32=>TokenInfo) tokens;
        bytes32[] keys;
    }
    mapping(address=>Info) gamesInfo;
    mapping(address=>bool) public distributedGames;

    constructor(
        address _airnodeRrpAddress, 
        address _positionManagerAddress, 
        address _factoryAddress, 
        address _wrappedNative) RrpRequesterV0(_airnodeRrpAddress) {
        positionManager = INonfungiblePositionManager(_positionManagerAddress);
        factory = IUniswapV3Factory(_factoryAddress);
        wrappedNative = _wrappedNative;
    }


    event Redeem(address token, address user, uint256 amount);
    event TokenDeployed(address memeToken, address V3Pool);
    event NewGameStarted(address diceGame, uint startAt);
    event SomeoneAlreadyCreatedV3Pool(bytes32 key);

    error NameSymbolLength();
    error UnsupportedFee();
    error PumpInterval();
    error PumpBPS();
    error LiquidityBPS();
    error TransferLiquidityFirst();
    error LiquidityAlreadyTransfered();
    error GameAlreadyStarted();
    error GameAlreadyHaveBeenPlayed();
    error SettingsAlreadyDone();
    error TokenAlreadyExists();
    error TokenBPS();
    error KeysOrParamsLength();
    error DeployAllTokens();
    error NotExists();
    error ZeroValue();

    /// @dev Modifier to check if the current block timestamp is before or equal to the _deadline.
    modifier checkDeadline(uint256 _deadline) {
        require(_blockTimestamp() <= _deadline, "too old");
        _;
    }

    /**
    * @notice Starts a new game with specific parameters including sponsor wallet, Airnode details, initial token rate
    * @param _diceGame game address SC.
    * @param _sponsorWallet The address of the sponsor who will provide funds for the QRNG.
    * @param _initialTokenRate The initial rate used within the game logic, set at the start and never changed afterward.
    * @param _deadline A timestamp until which the game can be initiated. Prevents starting the game too late.
    * @custom:modifier onlyOwner Restricts the function's execution to the contract's owner.
    * @custom:modifier checkDeadline Validates that the function is invoked before the specified _deadline.
    */
    
    function createGame(
            address _diceGame, 
            address _sponsorWallet, 
            uint _initialTokenRate, 
            uint _deadline
        ) external onlyOwner checkDeadline(_deadline) {
        if (activeGame != address(0)) revert GameAlreadyStarted();
        if (distributedGames[_diceGame]) revert GameAlreadyHaveBeenPlayed();
        // Ensure non-zero addresses are provided for sponsor wallet and Airnode
        require(_sponsorWallet != address(0), "z-a");
        // Ensure  provided initial token rate is positive
        require(_initialTokenRate > 1e6, "o-o");
        activeGame = _diceGame;
        //call dice game contract and start game
        (bool start, ) = address(_diceGame).call(
            abi.encodeWithSignature("startGame(address,uint256)", 
                _sponsorWallet,
                _initialTokenRate
            )
        );
        require(start);
        sponsorWallet = _sponsorWallet;
        emit NewGameStarted(_diceGame, block.timestamp);
    }

    /**
    * @notice transfer all liquidity from dice smart contract after game ends
    */

    function transferLiquidity() external {
        (bool success, bytes memory response) = address(activeGame).call(abi.encodeWithSignature("sendLiquidity()"));
        require(success, "Failed send funds");
        Info storage gameInfo = gamesInfo[activeGame];
        if (gameInfo.gameLiquidity != 0 ) revert LiquidityAlreadyTransfered();
        (gameInfo.gameLiquidity, gameInfo.PTStotalSupply) = abi.decode(response, (uint256,uint256));
    }

    /**
    * @notice Starts a new game with specific parameters including sponsor wallet, Airnode details, initial token rate
        WATCH OUT, SETTINGS CAN BE EXECUTED ONLY ONCE.
    * @param _keys unique hash for each token
    * @param _params tokens settings
    * @param _liquidityBPS percent of game liquidity which will be distributed during tokens creation
    * @custom:modifier onlyOwner Restricts the function's execution to the contract's owner.
    */

    function setTokensParams(bytes32[] calldata _keys, TokenParams[] calldata _params, uint _liquidityBPS) external onlyOwner {
        Info storage gameInfo = gamesInfo[activeGame];
        if(gameInfo.gameLiquidity == 0) revert TransferLiquidityFirst();
        if (gameInfo.keys.length != 0) revert SettingsAlreadyDone();
        uint keysLength = _keys.length;
        if(keysLength != _params.length) revert KeysOrParamsLength();
        if(keysLength == 0) revert ZeroValue();
        if(_liquidityBPS < 1000 || _liquidityBPS > 8000) revert LiquidityBPS();
        gameInfo.liquidityBPS = _liquidityBPS; 
        uint totalTokensBPS;
        for(uint i; i < keysLength;) {
            //add new token
            TokenInfo storage newToken = gameInfo.tokens[_keys[i]];
            if(_params[i].tokenBPS == 0) revert TokenBPS();
            if(newToken.pumpInterval != 0) revert TokenAlreadyExists();
            if(_params[i].pumpInterval < 1 days) revert PumpInterval(); 
            if(_params[i].pumpBPS > 5000 || _params[i].pumpBPS < 500) revert PumpBPS();
            if(bytes(_params[i].name).length < 3 || bytes(_params[i].symbol).length < 3 ) revert NameSymbolLength();
            unchecked {
                totalTokensBPS += _params[i].tokenBPS;
            }
            newToken.name = _params[i].name;
            newToken.symbol = _params[i].symbol;
            newToken.pumpInterval = _params[i].pumpInterval; 
            newToken.pumpBPS = _params[i].pumpBPS; 
            newToken.tokenBPS = _params[i].tokenBPS;
            //check supported fee
            (bool success, bytes memory response) = address(factory).staticcall(
                abi.encodeWithSignature("feeAmountTickSpacing(uint24)", _params[i].V3_fee)
            );
            require(success && response.length == 32); 
            int24 tickSpacing = abi.decode(response, (int24));
            if(tickSpacing == 0) revert UnsupportedFee();
            newToken.V3_fee = _params[i].V3_fee;
            newToken.tickSpacing = tickSpacing;
            //add key 
            gameInfo.keys.push(_keys[i]);
            unchecked{++i;}
        }
        if(totalTokensBPS != BP) revert TokenBPS(); 
    }

    /// @notice Deploys Token and sets up a corresponding V3 pool. 
    /// This function must be invoked 5 times in row if owner previously added 5 mem tokens
    /// If you see event SomeoneAlreadyCreatedV3Pool you must execute anti ddos actions - invoke this function from another msg.sender,
    /// or create V3Pool and initiaize it separately
    /// Can only be called after the game has ended and if the Token has not been set yet.
    /// @dev This function deploys a new Token ERC20  using 'CREATE2' for deterministic addresses,
    /// then checks if a Uniswap V3 pool with the token exists. If not, it creates one. If a pool does
    /// exist but its price is incorrect, emits event SomeoneAlreadyCreatedV3Pool with proper key and aborts deployment to
    /// prevent DOS attacks by preemptive pool creation.
    /// Emits a `TokenDeployed` event upon successful deployment.
    // 

    function deployTokens() external {
        Info storage gameInfo = gamesInfo[activeGame];
        address _wrappedNative = wrappedNative;
        uint length = gameInfo.keys.length;
        if (length == 0) revert ZeroValue();
        for (uint i; i < length;) {
            bytes32 key = gameInfo.keys[i];
            TokenInfo storage token = gameInfo.tokens[key];
            if (address(token.memeToken) == address(0)) {
                if (token.pumpInterval == 0) revert NotExists();
                (uint160 sqrtPriceX96, address token_) = calculateTokenDeployParams(msg.sender, activeGame, key);
                uint24 V3Fee = token.V3_fee;
                address _V3Pool = factory.getPool(token_, _wrappedNative, V3Fee);
                // If the V3 pool with our new token does not exist, create and initialize it
                if (_V3Pool == address(0)) {
                    _V3Pool = factory.createPool(token_, _wrappedNative, V3Fee);
                    IUniswapV3Pool(_V3Pool).initialize(sqrtPriceX96);
                    token.V3Pool = IUniswapV3Pool(_V3Pool);
                    _deployToken(token, token_, key, _wrappedNative);
                    emit TokenDeployed(token_, _V3Pool);
                } else {
                    emit SomeoneAlreadyCreatedV3Pool(key);
                    (uint160 sqrtPriceX96current, , , , , , ) = IUniswapV3Pool(_V3Pool).slot0();
                    if (sqrtPriceX96current == sqrtPriceX96) {
                        token.V3Pool = IUniswapV3Pool(_V3Pool);
                        _deployToken(token, token_, key, _wrappedNative);
                        emit TokenDeployed(token_, _V3Pool);
                    }
                }
                break;
            }
            unchecked { ++i; }
        }
    }

    function _deployToken(TokenInfo storage token, address token_, bytes32 key, address _wrappedNative) internal {
        bytes32 salt = keccak256(abi.encode(msg.sender, key));
        token.memeToken = new Token{ salt: salt }(
            address(airnodeRrp),
            _wrappedNative,
            address(positionManager),
            sponsorWallet,
            token.name,
            token.symbol,
            token.pumpInterval,
            token.pumpBPS
        );
        require(address(token.memeToken) == token_, "a-m");
    }


    /**
     * @notice Distributes liquidity to liquidity pool. This function must executed 5 times in row if owner previously added 5 mem tokens
     * @dev This function manages the distribution of Token and Wrapped Native Token (e.g., WETH) liquidity
     * to the Uniswap V3 pool represented by `V3Pool`. It ensures that there is a Token address set
     * (ensuring `deployTokens` was called and all tokens deployed), mints tokens, approves the necessary tokens for the positionManager,
     * and then provides liquidity by minting a new position in the liquidity pool. Finally, it transfers any remaining
     * Wrapped Native Token balance to the Token liquidity vault (smart contract of meme token) and initializes it with the provided parameters.
     *
     * Reverts if all Tokens has not been set, indicating deployToken() should be called first.
     * Also reverts if the Token vault's initialization fails post-liquidity provision.
     */
    function distributeLiquidity() external {
        address activeGame_ = activeGame;
        Info storage gameInfo = gamesInfo[activeGame_];
        address _wrappedNative = wrappedNative;
        uint keysLength = gameInfo.keys.length;
        if(keysLength == 0) revert KeysOrParamsLength();
        TokenInfo storage lastToken = gameInfo.tokens[gameInfo.keys[keysLength-1]];
        if(address(lastToken.memeToken) == address(0)) revert DeployAllTokens();
        for(uint i; i < keysLength;) {
            TokenInfo storage token = gameInfo.tokens[gameInfo.keys[i]];
            if(token.uniPosTokenId == 0) {
                Token memeToken = token.memeToken;
                token.V3Pool.increaseObservationCardinalityNext(observationCardinalityNext);
                // Determine the ordering of token addresses for Token and Wrapped Native 
                bool zeroForToken = address(memeToken) < _wrappedNative;
                (address token0, address token1) = zeroForToken
                    ? (address(memeToken), _wrappedNative)
                    : (_wrappedNative, address(memeToken));
                    // Retrieve the full range of liquidity ticks for adding liquidity
                (int24 tickLower, int24 tickUpper) = _getFullTickRange(token.tickSpacing);
                uint256 partOfmemeToken;
                uint256 partOfWrapNative;
                uint liquidityBPS = gameInfo.liquidityBPS;
                uint tokenLiquidity;
                unchecked {
                    tokenLiquidity = gameInfo.gameLiquidity * token.tokenBPS / BP;
                    partOfmemeToken = (gameInfo.PTStotalSupply * token.tokenBPS / BP) * liquidityBPS / BP; 
                    partOfWrapNative = tokenLiquidity * liquidityBPS / BP; 
                }
                (uint256 amount0, uint256 amount1) = zeroForToken
                    ? (partOfmemeToken, partOfWrapNative)
                    : (partOfWrapNative, partOfmemeToken);
                // Mint tokens required to add liquidity
                memeToken.mint(address(this), zeroForToken ? amount0 : amount1);
                // Approve tokens for liquidity provision to the positionManager
                token0.safeApprove(address(positionManager), amount0);
                token1.safeApprove(address(positionManager), amount1);
                // Provide liquidity to the pool via positionManager and receive an NFT token ID
                (uint256 tokenId, , , ) = positionManager.mint(
                    INonfungiblePositionManager.MintParams({
                        token0: token0,
                        token1: token1,
                        fee: token.V3_fee,
                        tickLower: tickLower,
                        tickUpper: tickUpper,
                        amount0Desired: amount0,
                        amount1Desired: amount1,
                        amount0Min: 0,
                        amount1Min: 0,
                        recipient: address(memeToken),
                        deadline: block.timestamp
                    })
                );

                // Transfer remaining Wrapped Native token liquidity to the Token liquidity vault for future pumps
                _wrappedNative.safeTransfer(address(memeToken), tokenLiquidity - partOfWrapNative);

                airnodeRrp.setSponsorshipStatus(address(memeToken), true);
                // Initialize the Token vault with the newly created liquidity position; revert if failed
                memeToken.initialize(zeroForToken, address(token.V3Pool), tokenId);
                token.uniPosTokenId = tokenId;
                if(i == keysLength-1) {
                    distributedGames[activeGame_] = true;
                    delete activeGame;
                }
                break;
            }
            unchecked{++i;}    
        }    
    }

   

    /// @notice Redeem points for tokens.
    /// @dev Burns points from the redeemer's balance and mints equivalent tokens.
    ///      Emits a Redeem event upon success.
    ///      Requires the game to be over.
    ///      Requires the Token to have been set and the caller to have a non-zero point balance.
    function redeem(address account, uint amount) external {
        require(distributedGames[msg.sender], "wait for distribution");
        Info storage gameInfo = gamesInfo[msg.sender];
        uint length = gameInfo.keys.length;
        //logic for disperse points amounts
        for(uint i; i < length;) {
            TokenInfo storage token = gameInfo.tokens[gameInfo.keys[i]];
            uint calculatedAmount = amount * token.tokenBPS / BP;
            token.memeToken.mint(account, calculatedAmount);
            emit Redeem(address(token.memeToken), account, calculatedAmount);
            unchecked{++i;} 
        }
    }

     /**
     * @dev Token Deployment Parameters Calculation
     * @param deployer The address of the account that would deploy the  Token

     * @return _sqrtPriceX96 The sqrtPrice required to initialize V3 pool of Token
     * @return _token The address of the Token associated with the deployer's address
     */
    function calculateTokenDeployParams(address deployer, address diceGame, bytes32 key) public view returns (uint160 _sqrtPriceX96, address _token) {
        Info storage gameInfo = gamesInfo[diceGame];
        TokenInfo storage token = gameInfo.tokens[key];
        _token = computeTokenAddress(deployer, token, key);
        bool zeroForToken = _token < wrappedNative;
        uint256 partOfmemeToken;
        uint256 partOfWrapNative;
        uint liquidityBPS = gameInfo.liquidityBPS;
        unchecked {
                            //      tokenGamePoints
            partOfmemeToken = (gameInfo.PTStotalSupply * token.tokenBPS / BP) * liquidityBPS / BP; 
                            //      tokenLiquidity
            partOfWrapNative = (gameInfo.gameLiquidity * token.tokenBPS / BP) * liquidityBPS / BP; 
        }
        _sqrtPriceX96 = zeroForToken
            ? uint160(Babylonian.sqrt(FullMath.mulDiv(1 << 192, partOfWrapNative, partOfmemeToken)))
            : uint160(Babylonian.sqrt(FullMath.mulDiv(1 << 192, partOfmemeToken, partOfWrapNative)));
    }

    /// This can be used to predict the address before deployment.  
    /// @param deployer The address of the account that would deploy the Token.
    /// @param token  We need for retrieve info about name, symbol, etc.
    /// @param key  We need for retrieve info about name, symbol, etc. and for salt 
    /// @return The anticipated Ethereum address of the to-be-deployed Token.
    function computeTokenAddress(address deployer, TokenInfo storage token, bytes32 key) private view returns (address) {
        bytes32 salt = keccak256(abi.encode(deployer, key));
        bytes memory bytecode = type(Token).creationCode;
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                bytecode,
                abi.encode(
                    address(airnodeRrp),
                    wrappedNative,
                    address(positionManager),
                    sponsorWallet,
                    token.name,
                    token.symbol,
                    token.pumpInterval,
                    token.pumpBPS
                )
            )
        );
        return
            address(
                uint160(
                    uint256(
                        keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash))
                    )
                )
            );
    }

    function getGameInfo(address _diceGame) 
        external
        view 
        returns (
        uint gameLiquidity,     
        uint liquidityBPS,    
        uint PTStotalSupply,
        bytes32[] memory keys,
        TokenInfo[] memory tokensInfo
    ) {
        Info storage gameInfo = _diceGame == address(0) 
            ? gamesInfo[activeGame]
            : gamesInfo[_diceGame];      
        gameLiquidity = gameInfo.gameLiquidity;
        liquidityBPS = gameInfo.liquidityBPS;
        PTStotalSupply = gameInfo.PTStotalSupply;
        keys = gameInfo.keys;
        uint length = keys.length;
        if(length!=0){
            tokensInfo = new TokenInfo[](length); 
            for (uint i = 0; i < length;) {
                tokensInfo[i] = gameInfo.tokens[keys[i]];
                unchecked {++i;}
            }
        }
    }


    /**
     * @dev Calculates the full tick range based on the tick spacing of the Token pool.
     *      The result is the widest valid tick range that can be used for creating a position
     *      on Uniswap v3. This function assumes that tickSpacing is set to the
     *      tick spacing of the Token pool in which this contract will interact.
     *
     * @return tickLower The lower end of the calculated tick range, aligned with the allowable tick spacing.
     * @return tickUpper The upper end of the calculated tick range, aligned with the allowable tick spacing.
     */
    function _getFullTickRange(int24 tickSpacing) private pure returns (int24 tickLower, int24 tickUpper) {
        unchecked {
            tickLower = (TickMath.MIN_TICK / tickSpacing) * tickSpacing;
            tickUpper = (TickMath.MAX_TICK / tickSpacing) * tickSpacing;
        }
    }

    function _blockTimestamp() private view returns (uint256) {
        return block.timestamp;
    }
}
