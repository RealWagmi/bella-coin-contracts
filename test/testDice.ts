import {
    time,
    mine,
    mineUpTo,
    takeSnapshot,
    SnapshotRestorer,
    impersonateAccount,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { deriveSponsorWalletAddress } from "@api3/airnode-admin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { IERC20, V3Deployer, DiceGame, QuoterV3, Token, IWETH, IUniswapV3Factory, INonfungiblePositionManager } from "../typechain-types";



const helpers = require("@nomicfoundation/hardhat-network-helpers");
import { Addressable, Signer } from "ethers";
import { log } from "console";
type SignerWithAddress = Signer & { address: string };




describe("Meme Launchpad", function () {
    const AirnodeRrpV0Address = "0xC02Ea0f403d5f3D45a4F1d0d817e7A2601346c9E";
    const WMETIS_ADDRESS = "0x75cb093E4D61d2A2e65D8e0BBb01DE8d89b53481";
    const POSITION_MANAGER_ADDRESS = "0xA7E119Cf6c8f5Be29Ca82611752463f0fFcb1B02";
    const UNISWAP_FACTORY_ADDRESS = "0x8112e18a34b63964388a3b2984037d6a2efe5b8a";

    const BP = 10000;
    const SEC_IN_DAY = 86400;


    let owner: SignerWithAddress;
    let alice: SignerWithAddress;
    let bob: SignerWithAddress;
    let john: SignerWithAddress;
    let donor: SignerWithAddress;
    let operator: SignerWithAddress;
    let airnodeRrpV0: SignerWithAddress;
    let testV3Deployer: SignerWithAddress;

    let startGameSnapshot: SnapshotRestorer;
    let beforeDeploySnapshot: SnapshotRestorer;
    // let purchasePointsSnapshot: SnapshotRestorer;
    let betSnapshot: SnapshotRestorer;
    let ddosSnapshot: SnapshotRestorer;
    let pumpSnapshot: SnapshotRestorer;

    let tokenId:number;

    const sponsorWalletAddress: any = "0x6D4De837da016e850ccc51d18A9593D7624B6c77";
    let CONTRACT_WMETIS: IWETH;
    let CONTRACT_V3Deployer: V3Deployer;
    let CONTRACT_DICEGAME: DiceGame;
    let CONTRACT_SECOND_DICEGAME: DiceGame;
    let memeToken: Token;
    let CONTRACT_V3FACTORY: IUniswapV3Factory;
    let CONTRACT_POSITION_MANAGER: INonfungiblePositionManager;
    let quoter: QuoterV3;
    

    async function addTokens(target: string, tokens: any[], amounts: BigInt[]) {
        await Promise.all(
            tokens.map(async (el, index) => await el.connect(donor).transfer(target, amounts[index])));
    }

    async function maxApprove(signer: SignerWithAddress, spenderAddress: string | Addressable, erc20tokens: string[]) {
        for (const token of erc20tokens) {
            const erc20: IERC20 = await ethers.getContractAt("IERC20", token);
            await erc20.connect(signer).approve(spenderAddress, ethers.MaxUint256);
        }
    }



    before(async () => {
        [owner, alice, bob, donor, operator, john] = await ethers.getSigners();
        CONTRACT_WMETIS = await ethers.getContractAt("IWETH", WMETIS_ADDRESS);

        const QuoterV3Factory = await ethers.getContractFactory("QuoterV3");
        quoter = (await QuoterV3Factory.deploy()) as QuoterV3;

        const V3Deployer = await ethers.getContractFactory("V3Deployer");
        //address _airnodeRrpAddress, address _positionManagerAddress, address _factoryAddress, address _wrappedNative
        CONTRACT_V3Deployer = await V3Deployer.deploy(
            AirnodeRrpV0Address,
            POSITION_MANAGER_ADDRESS,
            UNISWAP_FACTORY_ADDRESS,
            WMETIS_ADDRESS
        );
        await CONTRACT_V3Deployer.waitForDeployment();



        const DiceGame = await ethers.getContractFactory("DiceGame");
        //address _gameRngWalletAddress, uint _gamePeriod, IV3Deployer _V3Deployer
        CONTRACT_DICEGAME = await DiceGame.deploy(
            operator.address,
            10 * SEC_IN_DAY,
            CONTRACT_V3Deployer.target,
            WMETIS_ADDRESS
        );
        await CONTRACT_DICEGAME.waitForDeployment();

        CONTRACT_V3FACTORY = await ethers.getContractAt("IUniswapV3Factory", UNISWAP_FACTORY_ADDRESS);
        CONTRACT_POSITION_MANAGER = await ethers.getContractAt("INonfungiblePositionManager", POSITION_MANAGER_ADDRESS);
        const depositAmt = ethers.parseEther("1000");
        await CONTRACT_WMETIS.connect(donor).deposit({ value: depositAmt });

        let wmetisAmount = ethers.parseUnits("200", 18); //1k

        await maxApprove(owner, CONTRACT_DICEGAME.target, [WMETIS_ADDRESS]);
        await maxApprove(alice, CONTRACT_DICEGAME.target, [WMETIS_ADDRESS]);
        await maxApprove(bob, CONTRACT_DICEGAME.target, [WMETIS_ADDRESS]);

        const ForceSend = await ethers.getContractFactory("ForceSend");
        let forceSend = await ForceSend.deploy();
        await forceSend.go(AirnodeRrpV0Address, { value: ethers.parseUnits("10", "ether") });
        await impersonateAccount(AirnodeRrpV0Address);
        airnodeRrpV0 = await ethers.provider.getSigner(AirnodeRrpV0Address);
        // const quintessenceXpub =
        //   "xpub6CyZcaXvbnbqGfqqZWvWNUbGvdd5PAJRrBeAhy9rz1bbnFmpVLg2wPj1h6TyndFrWLUG3kHWBYpwacgCTGWAHFTbUrXEg6LdLxoEBny2YDz"

        // const quintessenceAirnodeAddress = "0x224e030f03Cd3440D88BD78C9BF5Ed36458A1A25"

        // sponsorWalletAddress = deriveSponsorWalletAddress(
        //   quintessenceXpub,
        //   quintessenceAirnodeAddress,
        //   (CONTRACT_V3Deployer.target).toString() // used as the sponsor
        // );
        // console.log("sponsorWalletAddress", sponsorWalletAddress); //0x6D4De837da016e850ccc51d18A9593D7624B6c77

        await addTokens(
            owner.address,
            [CONTRACT_WMETIS],
            [wmetisAmount]
        )

        await addTokens(
            alice.address,
            [CONTRACT_WMETIS],
            [wmetisAmount]
        )

        await addTokens(
            bob.address,
            [CONTRACT_WMETIS],
            [wmetisAmount]
        )
    });

    describe("Start the game and purchase points", function () {
        it("Check block, owner and start options", async function () {
            console.log("current block number", await ethers.provider.getBlockNumber());
            // console.log("CONTRACT_V3Deployer address", CONTRACT_V3Deployer.target);
            // console.log("CONTRACT_DICEGAME address", CONTRACT_DICEGAME.target);
            expect(await CONTRACT_V3Deployer.owner()).to.eq(owner.address);
            expect(await CONTRACT_DICEGAME.owner()).to.eq(CONTRACT_V3Deployer.target);
            await expect(CONTRACT_V3Deployer.deployTokens()).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "ZeroValue"
            );
            await expect(CONTRACT_V3Deployer.distributeLiquidity()).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "KeysOrParamsLength"
            );
            expect(await CONTRACT_V3Deployer.activeGame()).to.eq(ethers.ZeroAddress);
            const initialTokenRate = ethers.parseUnits("10", 18); // 10 Bella per WETH
            // address _diceGame, address _sponsorWallet, uint _initialTokenRate, uint _deadline
            await expect(CONTRACT_V3Deployer.connect(alice).createGame(
                CONTRACT_DICEGAME.target,
                sponsorWalletAddress,
                initialTokenRate,
                ethers.MaxUint256
            )).to.be.reverted;
        })
        it("should revert purchase Game points if the game is not started", async function () {
            await expect(CONTRACT_DICEGAME.purchasePoints(100)).to.be.reverted;
            // Attempt to send ETH to the contract, which should fail
            await expect(CONTRACT_DICEGAME.purchasePoints(1000, { value: ethers.parseEther("1") })).to.be.reverted;

        }); 
        it("should revert if the initial token rate is not greater than zero", async function () {
            const deadline = (await time.latest()) + 60;
            await expect(CONTRACT_V3Deployer.createGame(
                CONTRACT_DICEGAME.target,
                sponsorWalletAddress,
                0,
                deadline
            )).to.be.reverted;
        });
        it("should start the game with correct initial token rate and emit event", async function () {
            const deadline = (await time.latest()) + 60;

            const initialTokenRate = ethers.parseUnits("1000", 18); // 1000e18 points per 1e18 WMETIS
            await expect(CONTRACT_V3Deployer.createGame(
                CONTRACT_DICEGAME.target,
                sponsorWalletAddress,
                initialTokenRate,
                deadline
            )).to.emit(CONTRACT_V3Deployer, "NewGameStarted")
                .withArgs(CONTRACT_DICEGAME.target);

            expect(await CONTRACT_V3Deployer.activeGame()).to.eq(CONTRACT_DICEGAME.target);
            expect(await CONTRACT_DICEGAME.initialTokenRate()).to.equal(initialTokenRate);
            // // Verify endTime is set correctly, taking into account block timestamp variability
            const blockTimestamp = await time.latest();
            const GAME_PERIOD = await CONTRACT_DICEGAME.gamePeriod();
            expect(await CONTRACT_DICEGAME.endTime()).to.be.closeTo(blockTimestamp + Number(GAME_PERIOD), 5);

            startGameSnapshot = await takeSnapshot();
        });
        it("should calculate the correct amount of points based on payment", async function () {
            const paymentAmountInEth = ethers.parseEther("1"); // 1 ETH
            const expectedPointsAmount = ethers.parseUnits("1000", 18);

            expect(await CONTRACT_DICEGAME.calculatePointsAmount(paymentAmountInEth)).to.equal(expectedPointsAmount);
        });
        it("should calculate the correct payment amount for desired points", async function () {
            const desiredPointsAmount = ethers.parseUnits("1000", 18);
            let paymentAmount = ethers.parseEther("1");
            expect(await CONTRACT_DICEGAME.calculatePaymentAmount(desiredPointsAmount)).to.equal(paymentAmount);
        });
        it("should round up the payment amount when necessary", async function () {
            // Example value where rounding is necessary
            const desiredPointsAmount = 9n;
            const exactPaymentAmount = 1n;
            expect(await CONTRACT_DICEGAME.calculatePaymentAmount(desiredPointsAmount)).to.equal(exactPaymentAmount);
        });
        it("should revert if the game is started more than once", async function () {
            const deadline = (await time.latest()) + 60;
            const initialTokenRate = ethers.parseUnits("1000", 18); // 1000 points per 1 WMETIS
            await expect(CONTRACT_V3Deployer.createGame(
                CONTRACT_DICEGAME.target,
                sponsorWalletAddress,
                initialTokenRate,
                deadline)).to.be.revertedWithCustomError(
                    CONTRACT_V3Deployer,
                    "GameAlreadyStarted"
                );
        });
        it("should revert if the game is over", async function () {
            await time.increaseTo((await CONTRACT_DICEGAME.endTime()) + 1n);
            await expect(CONTRACT_DICEGAME.purchasePoints(1)).to.be.revertedWith("game over");

            // Attempt to send ETH to the contract, which should fail
            const sendValue = await CONTRACT_DICEGAME.calculatePaymentAmount(1);

            await expect(CONTRACT_DICEGAME.purchasePoints(1, { value: sendValue })).to.be.revertedWith("game over");
        });
        it("Should receive Ether and mint tokens", async function () {
            await startGameSnapshot.restore();
            const expectedPointsAmount = ethers.parseUnits("1000", 18); /* Call calculatePointsAmount with sendValue */

            const sendValue = await CONTRACT_DICEGAME.calculatePaymentAmount(expectedPointsAmount);
            expect(sendValue).to.equal(ethers.parseEther("1"));

            const tx = await CONTRACT_DICEGAME.connect(alice).purchasePoints(expectedPointsAmount, { value: sendValue });

            await expect(tx)
                .to.emit(CONTRACT_DICEGAME, "MintPoints") // Assuming this is an event emitted by _mintPoints
                .withArgs(alice.address, expectedPointsAmount);

            await expect(tx)
                .to.emit(CONTRACT_DICEGAME, "PurchasePoints") // Assuming this is an event emitted by _mintPoints
                .withArgs(alice.address, sendValue);

            // Check WETH balance of the contract to ensure deposit was successful
            expect(await CONTRACT_WMETIS.balanceOf(await CONTRACT_DICEGAME.getAddress())).to.equal(sendValue);
            // Check BellaPoints balance of the user to ensure minting was successful
            expect(await CONTRACT_DICEGAME.balanceOf(alice.address)).to.equal(expectedPointsAmount);

        });
        it("should allow users to purchase Bella points and emit event", async function () {
            const wethBalance = await CONTRACT_WMETIS.balanceOf(CONTRACT_DICEGAME.target);
            // Arrange
            const desiredPointsAmount = ethers.parseUnits("1000", 18);
            // Calculate the payment amount(shoud be 1 ETH in this case)
            const paymentAmount = await CONTRACT_DICEGAME.calculatePaymentAmount(desiredPointsAmount);
            expect(paymentAmount).to.equal(ethers.parseEther("1"));

            // Act & Assert Precondition (Game should not be over)
            expect(await CONTRACT_DICEGAME.gameNotOver()).to.be.true;
            const tx = await CONTRACT_DICEGAME.connect(bob).purchasePoints(desiredPointsAmount);
            await expect(tx)
                .to.emit(CONTRACT_DICEGAME, "MintPoints") // Assuming there is such an event
                .withArgs(bob.address, desiredPointsAmount);

            await expect(tx).to.emit(CONTRACT_DICEGAME, "PurchasePoints").withArgs(bob.address, paymentAmount);

            // Assert Postconditions
            const bobBalance = await CONTRACT_DICEGAME.balanceOf(bob.address);
            expect(bobBalance).to.equal(desiredPointsAmount);

            const newWethBalance = await CONTRACT_WMETIS.balanceOf(CONTRACT_DICEGAME.target);
            expect(newWethBalance).to.equal(paymentAmount + wethBalance);
            // purchasePointsSnapshot = await takeSnapshot(); // I don't have emergency withdraw
        });
        it("should revert if the purchase amount is zero", async function () {
            await expect(CONTRACT_DICEGAME.purchasePoints(0)).to.be.revertedWith("is zero");
        });
    })

    describe("bet", function () {
        it("should fail if bet amounts are invalid", async function () {
            // await purchasePointsSnapshot.restore(); // I don't have emergency withdraw
            let invalidBetAmounts = [0]; // Zero bet amount, which is invalid
            // Attempt to place a bet with invalid bet amounts and expect failure
            await expect(
                CONTRACT_DICEGAME.connect(alice).bet(invalidBetAmounts, { value: ethers.parseEther("0.001") })
            ).to.be.revertedWith("is zero");

            invalidBetAmounts = [1, 1, 1, 1]; // Zero bet amount, which is invalid
            // Attempt to place a bet with invalid bet amounts and expect failure
            await expect(
                CONTRACT_DICEGAME.connect(alice).bet(invalidBetAmounts, { value: ethers.parseEther("0.001") })
            ).to.be.revertedWith("invalid betAmts");
        });
        it("should fail if user does not have enough points", async function () {
            const betAmts = [ethers.parseEther("1000"), ethers.parseEther("1000"), ethers.parseEther("1000")];
            // Attempt to place a bet and expect failure due to insufficient points
            await expect(CONTRACT_DICEGAME.connect(alice).bet(betAmts, { value: ethers.parseEther("0.001") })).to.be.revertedWith(
                "points are not enough"
            );
        });
        it("should revert if there is not ETH to fulfill the QRNG request", async function () {
            const betAmts = [ethers.parseEther("1"), ethers.parseEther("1"), ethers.parseEther("1")];
            // Attempt to place a bet and expect failure due to not ETH to fulfill the QRNG request
            await expect(CONTRACT_DICEGAME.connect(alice).bet(betAmts))
                .to.be.revertedWithCustomError(CONTRACT_DICEGAME, "AmountOfEthSentIsTooSmall(uint256 sent,uint256  minimum)")
                .withArgs(0, anyValue);
            // Replenish the LINK balance
        });
        it("should allow a user to place a bet (1 dice) when conditions are met", async function () {
            const userBalanceBefore = await CONTRACT_DICEGAME.balanceOf(bob.address);
            const betAmts = [ethers.parseEther("5")];
            const bet = await CONTRACT_DICEGAME.connect(bob).bet(betAmts, { value: ethers.parseEther("0.001") });
            await expect(bet).to.emit(CONTRACT_DICEGAME, "Bet").withArgs(anyValue, bob.address, ethers.parseEther("5"));
            const userBalanceAfter = await CONTRACT_DICEGAME.balanceOf(bob.address);
            expect(userBalanceAfter).to.equal(userBalanceBefore - ethers.parseEther("5"));
        });
        it("should allow a user to place a bet (3 dice) when conditions are met", async function () {
            const userBalanceBefore = await CONTRACT_DICEGAME.balanceOf(alice.address);
            const balanceBefore = await ethers.provider.getBalance(operator.address);
            const betAmts = [ethers.parseEther("1"), ethers.parseEther("2"), ethers.parseEther("3")];
            const bet = await CONTRACT_DICEGAME.connect(alice).bet(betAmts, { value: ethers.parseEther("0.001") });
            await expect(bet).to.emit(CONTRACT_DICEGAME, "Bet").withArgs(anyValue, alice.address, ethers.parseEther("6"));
            expect(await ethers.provider.getBalance(operator.address)).to.equal(balanceBefore + ethers.parseEther("0.001"));
            const userBalanceAfter = await CONTRACT_DICEGAME.balanceOf(alice.address);
            expect(userBalanceAfter).to.equal(userBalanceBefore - ethers.parseEther("6"));
        });
        it("should fail if a last round not fulfilled", async function () {
            const betAmts = [ethers.parseEther("5")];
            await expect(CONTRACT_DICEGAME.connect(bob).bet(betAmts, { value: ethers.parseEther("0.001") })).to.be.revertedWith(
                "last round not fulfilled"
            );
        });
    });

    describe("game logic", function () {
        it("should reject when round is not found", async function () {
            const invalidGameId = 30; // gameId that doesn't exist
            const randomWords = [123, 456, 789];
            const randomData: DiceGame.RandomDataStruct[] = [{ id: invalidGameId, rn: randomWords }];
            const minRemainingGas = 1_000_000;
            await expect(CONTRACT_DICEGAME.connect(operator).fulfillRandomWords(minRemainingGas, randomData))
                .to.be.revertedWithCustomError(CONTRACT_DICEGAME, "InvalidGameId(uint256 id)")
                .withArgs(invalidGameId);
        });
        it("should calculate winnings correctly", async function () {
            const totalSupplyBefore = await CONTRACT_DICEGAME.totalSupply();
            const userBalanceBefore = await CONTRACT_DICEGAME.balanceOf(bob.address);
            const [id, lastRound] = await CONTRACT_DICEGAME.getUserLastGameInfo(bob.address);
            expect(lastRound.fulfilled).to.equal(false);
            expect(lastRound.totalBet).to.equal(ethers.parseEther("5"));
            const randomWords = [27]; // dice number = 27 % 6 + 1 = 4
            const randomData: DiceGame.RandomDataStruct[] = [{ id: id, rn: randomWords }];
            const minRemainingGas = 1_000_000;
            await CONTRACT_DICEGAME.connect(operator).fulfillRandomWords(minRemainingGas, randomData);
            const [idAfter, lastRoundAfter] = await CONTRACT_DICEGAME.getUserLastGameInfo(bob.address);
            expect(lastRoundAfter.fulfilled).to.equal(true);
            expect(lastRoundAfter.totalWinnings).to.equal(ethers.parseEther("10")); //5*2
            const expectedDiceRollResult = "4";
            expect(lastRoundAfter.diceRollResult.toString()).to.equal(expectedDiceRollResult);
            expect(idAfter).to.equal(id);
            const totalSupplyAfter = await CONTRACT_DICEGAME.totalSupply();
            const userBalanceAfter = await CONTRACT_DICEGAME.balanceOf(bob.address);
            expect(totalSupplyAfter).to.equal(totalSupplyBefore + lastRoundAfter.totalWinnings);
            expect(userBalanceAfter).to.equal(userBalanceBefore + lastRoundAfter.totalWinnings);
        });
        it("should calculate lucky 69 winnings correctly", async function () {
            const totalSupplyBefore = await CONTRACT_DICEGAME.totalSupply();
            const userBalanceBefore = await CONTRACT_DICEGAME.balanceOf(alice.address);
            const [id, lastRound] = await CONTRACT_DICEGAME.getUserLastGameInfo(alice.address);
            expect(lastRound.fulfilled).to.equal(false);
            expect(lastRound.totalBet).to.equal(ethers.parseEther("6"));
            const randomWords = [29, 28, 27]; // dice number = 29 % 6 + 1 = 6, 28 % 6 + 1 = 5, 27 % 6 + 1 = 4
            const randomData: DiceGame.RandomDataStruct[] = [{ id: id, rn: randomWords }];
            const minRemainingGas = 1_000_000;
            await CONTRACT_DICEGAME.connect(operator).fulfillRandomWords(minRemainingGas, randomData);
            const [, lastRoundAfter] = await CONTRACT_DICEGAME.getUserLastGameInfo(alice.address);
            expect(lastRoundAfter.fulfilled).to.equal(true);
            const expectedDiceRollResult = "6,5,4";
            expect(lastRoundAfter.diceRollResult.toString()).to.equal(expectedDiceRollResult); //6,5,4
            expect(lastRoundAfter.totalWinnings).to.equal(lastRound.totalBet * 10n); //1*10+2*10+3*10
            const totalSupplyAfter = await CONTRACT_DICEGAME.totalSupply();
            const userBalanceAfter = await CONTRACT_DICEGAME.balanceOf(alice.address);
            expect(totalSupplyAfter).to.equal(totalSupplyBefore + lastRound.totalBet * 10n);
            expect(userBalanceAfter).to.equal(userBalanceBefore + lastRound.totalBet * 10n);
            betSnapshot = await takeSnapshot();
        });
        it("should calculate 666 loss correctly", async function () {
            const betAmts = [ethers.parseEther("1"), ethers.parseEther("1"), ethers.parseEther("1")];
            await CONTRACT_DICEGAME.connect(bob).bet(betAmts, { value: ethers.parseEther("0.001") });
            const totalSupplyBefore = await CONTRACT_DICEGAME.totalSupply();
            const userBalanceBefore = await CONTRACT_DICEGAME.balanceOf(bob.address);
            expect(userBalanceBefore).to.gt(0n);
            let [id, lastRound] = await CONTRACT_DICEGAME.getUserLastGameInfo(bob.address);
            expect(lastRound.fulfilled).to.equal(false);
            expect(lastRound.totalBet).to.equal(ethers.parseEther("3"));
            const randomWords = [29, 29, 29]; // dice number: 6,6,6
            const randomData: DiceGame.RandomDataStruct[] = [{ id: id, rn: randomWords }];
            const minRemainingGas = 1_000_000;
            await CONTRACT_DICEGAME.connect(operator).fulfillRandomWords(minRemainingGas, randomData);
            const [, lastRoundAfter] = await CONTRACT_DICEGAME.getUserLastGameInfo(bob.address);
            expect(lastRoundAfter.fulfilled).to.equal(true);
            const expectedDiceRollResult = "6,6,6";
            expect(lastRoundAfter.diceRollResult.toString()).to.equal(expectedDiceRollResult);
            expect(lastRoundAfter.totalWinnings).to.equal(0);
            const totalSupplyAfter = await CONTRACT_DICEGAME.totalSupply();
            const userBalanceAfter = await CONTRACT_DICEGAME.balanceOf(bob.address);
            expect(totalSupplyAfter).to.equal(totalSupplyBefore - userBalanceBefore); // all balance is lost
            expect(userBalanceAfter).to.equal(0n);
            await betSnapshot.restore();
        });
        it("should calculate a repdigit case correctly", async function () {
            const betAmts = [ethers.parseEther("1"), ethers.parseEther("1"), ethers.parseEther("1")];
            await CONTRACT_DICEGAME.connect(bob).bet(betAmts, { value: ethers.parseEther("0.001") });
            const totalSupplyBefore = await CONTRACT_DICEGAME.totalSupply();
            const userBalanceBefore = await CONTRACT_DICEGAME.balanceOf(bob.address);
            expect(userBalanceBefore).to.gt(0n);
            let [id, lastRound] = await CONTRACT_DICEGAME.getUserLastGameInfo(bob.address);
            expect(lastRound.fulfilled).to.equal(false);
            expect(lastRound.totalBet).to.equal(ethers.parseEther("3"));
            const randomWords = [14, 14, 14]; // dice number: 3,3,3
            const randomData: DiceGame.RandomDataStruct[] = [{ id: id, rn: randomWords }];
            const minRemainingGas = 1_000_000;
            await CONTRACT_DICEGAME.connect(operator).fulfillRandomWords(minRemainingGas, randomData);
            const [, lastRoundAfter] = await CONTRACT_DICEGAME.getUserLastGameInfo(bob.address);
            expect(lastRoundAfter.fulfilled).to.equal(true);
            const expectedDiceRollResult = "3,3,3";
            expect(lastRoundAfter.diceRollResult.toString()).to.equal(expectedDiceRollResult);
            expect(lastRoundAfter.totalWinnings).to.equal(0);
            const totalSupplyAfter = await CONTRACT_DICEGAME.totalSupply();
            const userBalanceAfter = await CONTRACT_DICEGAME.balanceOf(bob.address);
            expect(totalSupplyAfter).to.equal(totalSupplyBefore);
            expect(userBalanceAfter).to.equal(userBalanceBefore);
            await betSnapshot.restore();
        });
    });

    describe("transfer liquidity from game SC and add tokens settings", function () {
        it("transferLiquidity should revert if  game not over", async function () {
            await expect(CONTRACT_V3Deployer.transferLiquidity()).to.be.revertedWith("Failed send funds");
            const totalPointsNow = ethers.parseEther("2059");
            const totalGameLiquidity = ethers.parseEther("2");
            const alicePointsNow = ethers.parseEther("1054");
            const bobPointsNow = ethers.parseEther("1005");
            expect(await CONTRACT_DICEGAME.totalSupply()).to.eq(totalPointsNow);
            expect(await CONTRACT_WMETIS.balanceOf(CONTRACT_DICEGAME.target)).to.eq(totalGameLiquidity);
            expect(await CONTRACT_DICEGAME.balanceOf(alice.address)).to.eq(alicePointsNow);
            expect(await CONTRACT_DICEGAME.balanceOf(bob.address)).to.eq(bobPointsNow);
        });
        it("should failed deployTokens distributeLiquidity setTokensParams without liquidity", async () => {
            await expect(CONTRACT_V3Deployer.distributeLiquidity()).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "KeysOrParamsLength"
            );
            await expect(CONTRACT_V3Deployer.deployTokens()).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "ZeroValue"
            );
            const tokenParams = [
                {
                    name: "Test",
                    symbol: "TST",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: 2500,
                    tokenBPS: 0.3 * BP,
                    V3_fee: 10000
                },
                {
                    name: "Test1",
                    symbol: "TST1",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: 2500,
                    tokenBPS: 0.5 * BP,
                    V3_fee: 10000
                },
                {
                    name: "Test2",
                    symbol: "TST2",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: 2500,
                    tokenBPS: 0.2 * BP,
                    V3_fee: 10000
                }
            ];

            await expect(CONTRACT_V3Deployer.setTokensParams(
                [ethers.encodeBytes32String("example"), ethers.encodeBytes32String("example1"), ethers.encodeBytes32String("example2"),],
                tokenParams,
                4000n // liquidity BPS
            )).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "TransferLiquidityFirst"
            );
        });
        it("should transfer lqiuidity once when game is over", async () => {
            await time.increaseTo((await CONTRACT_DICEGAME.endTime()) + 181n); //CALLBACK_RESERVE_TIME
            const totalPointsNow = ethers.parseEther("2059");
            const totalGameLiquidity = ethers.parseEther("2");
            const alicePointsNow = ethers.parseEther("1054");
            const bobPointsNow = ethers.parseEther("1005");
            const balBefore = await CONTRACT_WMETIS.balanceOf(CONTRACT_V3Deployer.target);
            await CONTRACT_V3Deployer.transferLiquidity();
            const balAfter = await CONTRACT_WMETIS.balanceOf(CONTRACT_V3Deployer.target);
            expect(balAfter - balBefore).to.eq(totalGameLiquidity);
            expect(await CONTRACT_WMETIS.balanceOf(CONTRACT_DICEGAME.target)).to.eq(0n);
            await expect(CONTRACT_V3Deployer.transferLiquidity()).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "LiquidityAlreadyTransfered"
            );
            const gameInfo = await CONTRACT_V3Deployer.getGameInfo(ethers.ZeroAddress);
            expect(gameInfo[0]).to.eq(totalGameLiquidity);          //gameLiquidity
            expect(gameInfo[1]).to.eq(0n);                          //liquidityBPS
            expect(gameInfo[2]).to.eq(totalPointsNow);              //PTStotalSupply
            expect(gameInfo[3]).to.be.an('array').that.is.empty;    //keys 
            expect(gameInfo[4]).to.be.an('array').that.is.empty;    //tokensInfo
        });
        it("should failed deployTokens distributeLiquidity without settings", async () => {
            await expect(CONTRACT_V3Deployer.deployTokens()).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "ZeroValue"
            );
            await expect(CONTRACT_V3Deployer.distributeLiquidity()).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "KeysOrParamsLength"
            );
        });
        it("should failed set settings from alice", async () => {
            const tokenParams = [
                {
                    name: "Test",
                    symbol: "TST",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: 2500,
                    tokenBPS: BP,
                    V3_fee: 10000
                }
            ];
            await expect(CONTRACT_V3Deployer.connect(alice).setTokensParams(
                [ethers.encodeBytes32String("example")],
                tokenParams,
                4000n // liquidity BPS
            )).to.be.revertedWith('Ownable: caller is not the owner');
        });
        it("should failed set incorrect liquidityBPS from owner", async () => {
            const zeroLiquidityBPS = 0n;
            const wrongLiquidityBPS = 8001n;
            const pumpBPS = 2500n;
            const tokenParams = [
                {
                    name: "Test",
                    symbol: "TST",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: BP,
                    V3_fee: 10000
                }
            ];

            await expect(CONTRACT_V3Deployer.connect(owner).setTokensParams(
                [ethers.encodeBytes32String("example")],
                tokenParams,
                zeroLiquidityBPS
            )).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "LiquidityBPS"
            );
            await expect(CONTRACT_V3Deployer.connect(owner).setTokensParams(
                [ethers.encodeBytes32String("example")],
                tokenParams,
                wrongLiquidityBPS
            )).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "LiquidityBPS"
            );
        });
        it("should failed call settings with zero keys array from owner", async () => {
            const liquidityBPS = 4000n;
            await expect(CONTRACT_V3Deployer.connect(owner).setTokensParams(
                [],
                [],
                liquidityBPS
            )).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "ZeroValue"
            );
        });
        it("should failed call settings with different array of keys and params length from owner", async () => {
            const liquidityBPS = 4000n;
            const pumpBPS = 2500n;
            const tokenParams = [
                {
                    name: "Test",
                    symbol: "TST",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: BP,
                    V3_fee: 10000
                }
            ];
            await expect(CONTRACT_V3Deployer.connect(owner).setTokensParams(
                [],
                tokenParams,
                liquidityBPS
            )).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "KeysOrParamsLength"
            );
        });
        it("should failed call settings same keys from owner", async () => {
            const liquidityBPS = 4000n;
            const pumpBPS = 2500n;
            const tokenParams = [
                {
                    name: "Test",
                    symbol: "TST",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: 0.3 * BP,
                    V3_fee: 10000
                },
                {
                    name: "Test1",
                    symbol: "TST1",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: 0.5 * BP,
                    V3_fee: 10000
                },
                {
                    name: "Test2",
                    symbol: "TST2",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: 0.2 * BP,
                    V3_fee: 10000
                }
            ];
            await expect(CONTRACT_V3Deployer.connect(owner).setTokensParams(
                [ethers.encodeBytes32String("example"), ethers.encodeBytes32String("example"), ethers.encodeBytes32String("example2"),],
                tokenParams,
                liquidityBPS
            )).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "TokenAlreadyExists"
            );
        });
        it("should failed call settings with token name lower than 3 characters from owner", async () => {
            const liquidityBPS = 4000n;
            const pumpBPS = 2500n;
            const tokenParams = [
                {
                    name: "Te",
                    symbol: "TST",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: BP,
                    V3_fee: 10000
                }
            ];
            await expect(CONTRACT_V3Deployer.connect(owner).setTokensParams(
                [ethers.encodeBytes32String("example")],
                tokenParams,
                liquidityBPS
            )).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "NameSymbolLength"
            );

            const tokenParams1 = [
                {
                    name: "Test",
                    symbol: "TT",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: BP,
                    V3_fee: 10000
                }
            ];
            await expect(CONTRACT_V3Deployer.connect(owner).setTokensParams(
                [ethers.encodeBytes32String("example")],
                tokenParams1,
                liquidityBPS
            )).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "NameSymbolLength"
            );
        });
        it("should failed call settings with incorrect pumpInterval from owner", async () => {
            const liquidityBPS = 4000n;
            const pumpBPS = 2500n;
            const tokenParams = [
                {
                    name: "Test",
                    symbol: "TST",
                    // pumpInterval: 0.9 * SEC_IN_DAY,
                    pumpInterval: 0,
                    pumpBPS: pumpBPS,
                    tokenBPS: BP,
                    V3_fee: 10000
                }
            ];
            await expect(CONTRACT_V3Deployer.connect(owner).setTokensParams(
                [ethers.encodeBytes32String("example")],
                tokenParams,
                liquidityBPS
            )).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "PumpInterval"
            );
        });
        it("should failed call settings with incorrect pumpBPS from owner", async () => {
            const liquidityBPS = 4000n;
            const highPumpBPS = 5001n;
            const lowPumpBPS = 499n;
            const tokenParams = [
                {
                    name: "Test",
                    symbol: "TST",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: highPumpBPS,
                    tokenBPS: BP,
                    V3_fee: 10000
                }
            ];
            await expect(CONTRACT_V3Deployer.connect(owner).setTokensParams(
                [ethers.encodeBytes32String("example")],
                tokenParams,
                liquidityBPS
            )).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "PumpBPS"
            );
            const tokenParams1 = [
                {
                    name: "Test",
                    symbol: "TST",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: lowPumpBPS,
                    tokenBPS: BP,
                    V3_fee: 10000
                }
            ];
            await expect(CONTRACT_V3Deployer.connect(owner).setTokensParams(
                [ethers.encodeBytes32String("example")],
                tokenParams1,
                liquidityBPS
            )).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "PumpBPS"
            );
        });
        it("should failed call settings with incorrect tokenBPS from owner", async () => {
            //sum of BPS must be eq BP
            const liquidityBPS = 4000n;
            const pumpBPS = 2500n;
            const tokenParams = [
                {
                    name: "Test",
                    symbol: "TST",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: 0.9 * BP,
                    V3_fee: 10000
                }
            ];
            await expect(CONTRACT_V3Deployer.connect(owner).setTokensParams(
                [ethers.encodeBytes32String("example")],
                tokenParams,
                liquidityBPS
            )).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "TokenBPS"
            );


            const tokenParams1 = [
                {
                    name: "Test",
                    symbol: "TST",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: 0.3 * BP,
                    V3_fee: 10000
                },
                {
                    name: "Test1",
                    symbol: "TST1",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: 0.5 * BP,
                    V3_fee: 10000
                },
                {
                    name: "Test2",
                    symbol: "TST2",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: 0.1 * BP,
                    V3_fee: 10000
                }
            ];
            await expect(CONTRACT_V3Deployer.connect(owner).setTokensParams(
                [ethers.encodeBytes32String("example"), ethers.encodeBytes32String("example1"), ethers.encodeBytes32String("example2")],
                tokenParams1,
                liquidityBPS
            )).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "TokenBPS"
            );


            const tokenParams2 = [
                {
                    name: "Test",
                    symbol: "TST",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: 1.2 * BP,
                    V3_fee: 10000
                }
            ];
            await expect(CONTRACT_V3Deployer.connect(owner).setTokensParams(
                [ethers.encodeBytes32String("example")],
                tokenParams2,
                liquidityBPS
            )).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "TokenBPS"
            );


            const tokenParams3 = [
                {
                    name: "Test",
                    symbol: "TST",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: 0.5 * BP,
                    V3_fee: 10000
                },
                {
                    name: "Test1",
                    symbol: "TST1",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: 0.5 * BP,
                    V3_fee: 10000
                },
                {
                    name: "Test2",
                    symbol: "TST2",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: 0n,
                    V3_fee: 10000
                }
            ];
            await expect(CONTRACT_V3Deployer.connect(owner).setTokensParams(
                [ethers.encodeBytes32String("example"), ethers.encodeBytes32String("example1"), ethers.encodeBytes32String("example2")],
                tokenParams3,
                liquidityBPS
            )).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "TokenBPS"
            );
        });
        it("should failed call settings with incorrect V3Fee from owner", async () => {
            const liquidityBPS = 4000n;
            const pumpBPS = 2500n;
            const tokenParams = [
                {
                    name: "Test",
                    symbol: "TST",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: BP,
                    V3_fee: 9000
                }
            ];
            await expect(CONTRACT_V3Deployer.connect(owner).setTokensParams(
                [ethers.encodeBytes32String("example")],
                tokenParams,
                liquidityBPS
            )).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "UnsupportedFee"
            );
        });
        it("should succeed set correct settings from owner", async () => {
            const liquidityBPS = 4000n;
            const pumpBPS = 2500n;
            const tokenParams = [
                {
                    name: "Test1",
                    symbol: "TST1",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: 0.1 * BP,
                    V3_fee: 10000
                },
                {
                    name: "Test2",
                    symbol: "TST2",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: 0.5 * BP,
                    V3_fee: 10000
                },
                {
                    name: "Test3",
                    symbol: "TST3",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: 0.15 * BP,
                    V3_fee: 10000
                },
                {   //check work with same name
                    name: "Test3",
                    symbol: "TST3",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: 0.12 * BP,
                    V3_fee: 10000
                },
                {
                    name: "Test5",
                    symbol: "TST5",
                    pumpInterval: 5 * SEC_IN_DAY,
                    pumpBPS: pumpBPS,
                    tokenBPS: 0.13 * BP,
                    V3_fee: 10000
                }
            ];

            await CONTRACT_V3Deployer.connect(owner).setTokensParams(
                [
                    ethers.encodeBytes32String("example1"),
                    ethers.encodeBytes32String("example2"),
                    ethers.encodeBytes32String("example3"),
                    ethers.encodeBytes32String("example4"),
                    ethers.encodeBytes32String("example5"),
                ],
                tokenParams,
                liquidityBPS
            );
            const gameInfo = await CONTRACT_V3Deployer.getGameInfo(ethers.ZeroAddress);
            // console.log(gameInfo[4][0]);
            expect(gameInfo[1]).to.eq(liquidityBPS);                  //liquidityBPS
            expect(gameInfo[3]).to.be.an('array').to.not.be.empty;    //keys 
            expect(gameInfo[4]).to.be.an('array').to.not.be.empty;    //tokensInfo
            expect(gameInfo[3]).to.have.property('length', 5);
            expect(gameInfo[4]).to.have.property('length', 5);
            //check first added token
            expect(gameInfo[4][0][0]).to.eq(ethers.ZeroAddress);        //memeToken    
            expect(gameInfo[4][0][1]).to.eq(ethers.ZeroAddress);        //V3Pool
            expect(gameInfo[4][0][2]).to.eq("Test1");                   //name
            expect(gameInfo[4][0][3]).to.eq("TST1");                    //symbol
            expect(gameInfo[4][0][4]).to.eq(0n);                        //uniPosTokenId 
            expect(gameInfo[4][0][5]).to.eq(5 * SEC_IN_DAY);            //pumpInterval                   
            expect(gameInfo[4][0][6]).to.eq(pumpBPS);                   //pumpBPS                
            expect(gameInfo[4][0][7]).to.eq(0.1 * BP);                  //tokenBPS
            // expect(gameInfo[4][0][8]).to.eq(0n);                        //fixedSqrtPrice
            expect(gameInfo[4][0][8]).to.eq(10000n);                    //V3_fee
            expect(gameInfo[4][0][9]).to.eq(200n);                     //tickSpacing
        });
    });

    describe("deploy tokens check DDos attacks", function () {
        it("should failed  distributeLiquidity without deployTokens", async () => {
            await expect(CONTRACT_V3Deployer.distributeLiquidity()).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "DeployAllTokens"
            );
        });
        it("should failed  redeem without liquidity", async () => {
            await expect(CONTRACT_DICEGAME.connect(alice).redeem()).to.be.reverted;
        });
        it("should succeed deploy tokens after add proper settings", async () => {
            beforeDeploySnapshot = await takeSnapshot();
            const keys = [
                ethers.encodeBytes32String("example1"),
                ethers.encodeBytes32String("example2"),
                ethers.encodeBytes32String("example3"),
                ethers.encodeBytes32String("example4"),
                ethers.encodeBytes32String("example5"),
            ]
            const [sqrtPriceX96expected_1, tokenAddress_1] = await CONTRACT_V3Deployer.calculateTokenDeployParams(
                bob.address,
                CONTRACT_DICEGAME.target,
                keys[0]
            );
            const [sqrtPriceX96expected_2, tokenAddress_2] = await CONTRACT_V3Deployer.calculateTokenDeployParams(
                bob.address,
                CONTRACT_DICEGAME.target,
                keys[1]
            );
            const [sqrtPriceX96expected_3, tokenAddress_3] = await CONTRACT_V3Deployer.calculateTokenDeployParams(
                bob.address,
                CONTRACT_DICEGAME.target,
                keys[2]
            );
            const [sqrtPriceX96expected_4, tokenAddress_4] = await CONTRACT_V3Deployer.calculateTokenDeployParams(
                bob.address,
                CONTRACT_DICEGAME.target,
                keys[3]
            );
            const [sqrtPriceX96expected_5, tokenAddress_5] = await CONTRACT_V3Deployer.calculateTokenDeployParams(
                bob.address,
                CONTRACT_DICEGAME.target,
                keys[4]
            );

            await CONTRACT_V3Deployer.connect(bob).deployTokens(); // 33 kk gas cost
            await CONTRACT_V3Deployer.connect(bob).deployTokens();
            await CONTRACT_V3Deployer.connect(bob).deployTokens();
            await CONTRACT_V3Deployer.connect(bob).deployTokens();
            await CONTRACT_V3Deployer.connect(bob).deployTokens();
            const gameInfo = await CONTRACT_V3Deployer.getGameInfo(ethers.ZeroAddress);
            // console.log(gameInfo[4]);

            const token_1 = gameInfo[4][0][0];
            const V3Pool_1 = gameInfo[4][0][1];
            expect(token_1).to.not.equal(ethers.ZeroAddress);
            expect(V3Pool_1).to.not.equal(ethers.ZeroAddress);
            const pool = await ethers.getContractAt("IUniswapV3Pool", V3Pool_1);
            expect([token_1, WMETIS_ADDRESS]).to.include(await pool.token0());
            expect([token_1, WMETIS_ADDRESS]).to.include(await pool.token1());

            const [sqrtPriceX96current, , , , , ,] = await pool.slot0();
            expect(sqrtPriceX96current).to.equal(sqrtPriceX96expected_1);
            expect(tokenAddress_1).to.equal(token_1);
            memeToken = await ethers.getContractAt("Token", token_1);
            expect(await memeToken.name()).to.equal("Test1");
            expect(await memeToken.symbol()).to.equal("TST1");
            expect(await memeToken.decimals()).to.equal(18);

        });
        it("check DDos incorrect pool sqrtPriceX96", async () => {
            await beforeDeploySnapshot.restore();
            const keys = [
                ethers.encodeBytes32String("example1"),
                ethers.encodeBytes32String("example2"),
                ethers.encodeBytes32String("example3"),
                ethers.encodeBytes32String("example4"),
                ethers.encodeBytes32String("example5"),
            ]
            const [sqrtPriceX96expected_1, tokenAddress_1] = await CONTRACT_V3Deployer.calculateTokenDeployParams(
                bob.address,
                CONTRACT_DICEGAME.target,
                keys[0]
            );
            await CONTRACT_V3FACTORY.connect(alice).createPool(
                tokenAddress_1,
                WMETIS_ADDRESS,
                10000
            );

            const poolAddress = await CONTRACT_V3FACTORY.getPool(
                tokenAddress_1,
                WMETIS_ADDRESS,
                10000
            );
            const pool = await ethers.getContractAt("IUniswapV3Pool", poolAddress);

            //set incorrect sqrtPriceX96  min
            await pool.connect(alice).initialize(4295128739n);

            let tx = await CONTRACT_V3Deployer.connect(bob).deployTokens();
            const receipt = await tx.wait()
            //@ts-ignore
            const event = receipt.logs.map(log => CONTRACT_V3Deployer.interface.parseLog(log))
                //@ts-ignore
                .filter(parsedLog => parsedLog.name === "SomeoneAlreadyCreatedV3Pool");
            expect(event[0]?.args[0]).to.eq(keys[0])
            // console.log("event", event);
            await CONTRACT_V3Deployer.connect(bob).deployTokens();

            const gameInfo = await CONTRACT_V3Deployer.getGameInfo(ethers.ZeroAddress);
            // console.log(gameInfo[4]);

            const token_1 = gameInfo[4][0][0];
            const token_2 = gameInfo[4][1][0];
            const V3Pool_1 = gameInfo[4][0][1];
            expect(token_1).to.eq(ethers.ZeroAddress);
            expect(V3Pool_1).to.eq(ethers.ZeroAddress);
            // We can't deploy 2, if 1 token not deployed
            expect(token_2).to.eq(ethers.ZeroAddress);
            ddosSnapshot = await takeSnapshot();
        });
        it("we still can't distribute liquidity, until all tokens will be deployed", async () => {
            await expect(CONTRACT_V3Deployer.distributeLiquidity()).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "DeployAllTokens"
            );
        });
        it("we must call deploy tokens from another msg.sender", async () => {
            const keys = [
                ethers.encodeBytes32String("example1"),
                ethers.encodeBytes32String("example2"),
                ethers.encodeBytes32String("example3"),
                ethers.encodeBytes32String("example4"),
                ethers.encodeBytes32String("example5"),
            ]
            const [sqrtPriceX96expected_1, tokenAddress_1] = await CONTRACT_V3Deployer.calculateTokenDeployParams(
                john.address,
                CONTRACT_DICEGAME.target,
                keys[0]
            );
            // console.log(sqrtPriceX96expected_1);
            await CONTRACT_V3Deployer.connect(john).deployTokens();
            await CONTRACT_V3Deployer.connect(bob).deployTokens();
            await CONTRACT_V3Deployer.connect(bob).deployTokens();
            await CONTRACT_V3Deployer.connect(bob).deployTokens();
            await CONTRACT_V3Deployer.connect(bob).deployTokens();
            const gameInfo = await CONTRACT_V3Deployer.getGameInfo(ethers.ZeroAddress);
            // console.log(gameInfo[4][0]);
            const token_1 = gameInfo[4][0][0];
            const V3Pool_1 = gameInfo[4][0][1];
            const token_5 = gameInfo[4][4][0];
            const V3Pool_5 = gameInfo[4][4][1];
            expect(token_1).to.not.equal(ethers.ZeroAddress);
            expect(V3Pool_1).to.not.equal(ethers.ZeroAddress);
            expect(token_5).to.not.equal(ethers.ZeroAddress);
            expect(V3Pool_5).to.not.equal(ethers.ZeroAddress);
            const pool = await ethers.getContractAt("IUniswapV3Pool", V3Pool_1);
            expect([token_1, WMETIS_ADDRESS]).to.include(await pool.token0());
            expect([token_1, WMETIS_ADDRESS]).to.include(await pool.token1());

            const pool5 = await ethers.getContractAt("IUniswapV3Pool", V3Pool_5);
            expect([token_5, WMETIS_ADDRESS]).to.include(await pool5.token0());
            expect([token_5, WMETIS_ADDRESS]).to.include(await pool5.token1());

            const [sqrtPriceX96current, , , , , ,] = await pool.slot0();
            expect(sqrtPriceX96current).to.equal(sqrtPriceX96expected_1);
            expect(tokenAddress_1).to.equal(token_1);
            memeToken = await ethers.getContractAt("Token", token_1);
            expect(await memeToken.name()).to.equal("Test1");
            expect(await memeToken.symbol()).to.equal("TST1");
            expect(await memeToken.decimals()).to.equal(18);
        });
        it("check DDos one more time, If someone sniff our SC in mempool - we must create pool separately", async () => {
            await ddosSnapshot.restore();
            const keys = [
                ethers.encodeBytes32String("example1"),
                ethers.encodeBytes32String("example2"),
                ethers.encodeBytes32String("example3"),
                ethers.encodeBytes32String("example4"),
                ethers.encodeBytes32String("example5"),
            ]
            const [sqrtPriceX96expected_1, tokenAddress_1] = await CONTRACT_V3Deployer.calculateTokenDeployParams(
                john.address,
                CONTRACT_DICEGAME.target,
                keys[0]
            );
            await CONTRACT_V3FACTORY.connect(john).createPool(
                tokenAddress_1,
                WMETIS_ADDRESS,
                10000
            );

            const poolAddress = await CONTRACT_V3FACTORY.getPool(
                tokenAddress_1,
                WMETIS_ADDRESS,
                10000
            );
            const pool = await ethers.getContractAt("IUniswapV3Pool", poolAddress);

            //set correct sqrtPriceX96  
            await pool.connect(john).initialize(sqrtPriceX96expected_1);
            // You can't invoke deploy tokens for DDosed token from other guy, only from "john"
            await CONTRACT_V3Deployer.connect(john).deployTokens();
            await CONTRACT_V3Deployer.connect(bob).deployTokens();
            await CONTRACT_V3Deployer.connect(bob).deployTokens();
            await CONTRACT_V3Deployer.connect(bob).deployTokens();
            await CONTRACT_V3Deployer.connect(bob).deployTokens();

            const gameInfo = await CONTRACT_V3Deployer.getGameInfo(ethers.ZeroAddress);
            // console.log(gameInfo[4]);
            const token_1 = gameInfo[4][0][0];
            const V3Pool_1 = gameInfo[4][0][1];
            const token_5 = gameInfo[4][4][0];
            const V3Pool_5 = gameInfo[4][4][1];
            expect(token_1).to.not.equal(ethers.ZeroAddress);
            expect(V3Pool_1).to.not.equal(ethers.ZeroAddress);
            expect(token_5).to.not.equal(ethers.ZeroAddress);
            expect(V3Pool_5).to.not.equal(ethers.ZeroAddress);
            expect([token_1, WMETIS_ADDRESS]).to.include(await pool.token0());
            expect([token_1, WMETIS_ADDRESS]).to.include(await pool.token1());

            const pool5 = await ethers.getContractAt("IUniswapV3Pool", V3Pool_5);
            expect([token_5, WMETIS_ADDRESS]).to.include(await pool5.token0());
            expect([token_5, WMETIS_ADDRESS]).to.include(await pool5.token1());

            const [sqrtPriceX96current, , , , , ,] = await pool.slot0();
            expect(sqrtPriceX96current).to.equal(sqrtPriceX96expected_1);
            expect(tokenAddress_1).to.equal(token_1);
            memeToken = await ethers.getContractAt("Token", token_1);
            expect(await memeToken.name()).to.equal("Test1");
            expect(await memeToken.symbol()).to.equal("TST1");
            expect(await memeToken.decimals()).to.equal(18);
        });
    });

    describe("distribute liquidity", function () {
        it("should succeed distribute liquidity after deploy all tokens", async () => {
            //5 tokens - 5 calls distributeLiquidity
            await CONTRACT_V3Deployer.connect(alice).distributeLiquidity();
            await CONTRACT_V3Deployer.connect(bob).distributeLiquidity();
            expect(await CONTRACT_V3Deployer.activeGame()).to.not.equal(ethers.ZeroAddress);
            expect(await CONTRACT_V3Deployer.distributedGames(CONTRACT_DICEGAME.target)).to.be.false;
            await CONTRACT_V3Deployer.connect(john).distributeLiquidity();
            await CONTRACT_V3Deployer.connect(owner).distributeLiquidity();
            await CONTRACT_V3Deployer.connect(bob).distributeLiquidity();
            await expect(CONTRACT_V3Deployer.distributeLiquidity()).to.be.revertedWithCustomError(
                CONTRACT_V3Deployer,
                "KeysOrParamsLength"
            );
            expect(await CONTRACT_V3Deployer.activeGame()).to.eq(ethers.ZeroAddress);
            expect(await CONTRACT_V3Deployer.distributedGames(CONTRACT_DICEGAME.target)).to.be.true;
        });
        it("check positions for tokens and tokens weigths", async () => {
            const gameInfo = await CONTRACT_V3Deployer.getGameInfo(CONTRACT_DICEGAME.target);
            const idsNFT = gameInfo[4].map(el => (el[4]))
            const tokens = gameInfo[4].map(el => (el[0]))
            //ckeck liquidity
            const position2 = await CONTRACT_POSITION_MANAGER.positions(idsNFT[1]); // 50%

            const position1 = await CONTRACT_POSITION_MANAGER.positions(idsNFT[0]);
            const position3 = await CONTRACT_POSITION_MANAGER.positions(idsNFT[2]);
            const position4 = await CONTRACT_POSITION_MANAGER.positions(idsNFT[3]);
            const position5 = await CONTRACT_POSITION_MANAGER.positions(idsNFT[4]);
            const sum50percent = position1[7] + position3[7] + position4[7] + position5[7];
            // console.log(position2[7]);
            // console.log(sum50percent);
            expect(position2[7]).to.closeTo(sum50percent, 2);
            expect(await CONTRACT_WMETIS.balanceOf(CONTRACT_V3Deployer.target)).to.eq(0n);

            // we have order - 40% liquidity for distribution, 60% - for pump
            // total game liq - 2 WMETIS
            const pumpSumOF50percentWeightToken = (gameInfo[0] * 5000n / 10000n) * 6000n / 10000n;
            const pumpSumOF12percentWeightToken = (gameInfo[0] * 1200n / 10000n) * 6000n / 10000n;
            expect(await CONTRACT_WMETIS.balanceOf(tokens[1])).to.eq(pumpSumOF50percentWeightToken);
            expect(await CONTRACT_WMETIS.balanceOf(tokens[3])).to.eq(pumpSumOF12percentWeightToken);
            expect(await CONTRACT_POSITION_MANAGER.ownerOf(idsNFT[0])).to.eq(tokens[0]);
            expect(await CONTRACT_POSITION_MANAGER.ownerOf(idsNFT[1])).to.eq(tokens[1]);
            expect(await CONTRACT_POSITION_MANAGER.ownerOf(idsNFT[2])).to.eq(tokens[2]);
            expect(await CONTRACT_POSITION_MANAGER.ownerOf(idsNFT[3])).to.eq(tokens[3]);
            expect(await CONTRACT_POSITION_MANAGER.ownerOf(idsNFT[4])).to.eq(tokens[4]);
            // console.log(await CONTRACT_WMETIS.balanceOf(tokens[2]));
            // console.log(await CONTRACT_WMETIS.balanceOf(tokens[0]));
            // console.log(await CONTRACT_WMETIS.balanceOf(tokens[1])); 
            // console.log(await CONTRACT_WMETIS.balanceOf(tokens[3]));
            // console.log(await CONTRACT_WMETIS.balanceOf(tokens[4]));
            // console.log(tokens); 
        });
    });

    describe("redeem tokens", function () {
        it("should failed redeem zero", async () => {
            await expect(CONTRACT_DICEGAME.connect(john).redeem()).to.be.revertedWith("is zero");
        });
        it("should succeed redeem Alice tokens", async () => {
            const gameInfo = await CONTRACT_V3Deployer.getGameInfo(CONTRACT_DICEGAME.target);
            const tokens = gameInfo[4].map(el => (el[0]))
            const tokensBPS = [1000n, 5000n, 1500n, 1200n, 1300n];
            const BPn = 10000n;
            const alicePointsNow = ethers.parseEther("1054");

            expect(await CONTRACT_DICEGAME.balanceOf(alice.address)).to.eq(alicePointsNow);

            // await impersonateAccount(CONTRACT_V3Deployer.target.toString());
            // const ForceSend = await ethers.getContractFactory("ForceSend");
            // let forceSend = await ForceSend.deploy();
            // await forceSend.go(CONTRACT_V3Deployer.target, { value: ethers.parseUnits("1", "ether") });
            // testV3Deployer = await ethers.provider.getSigner(CONTRACT_V3Deployer.target.toString());
            // memeToken = await ethers.getContractAt("Token", tokens[0]);
            // await memeToken.connect(testV3Deployer).mint(alice.address, 100);

            const tokenAmounts = tokensBPS.map(el => (alicePointsNow * el / BPn));

            let tx = await CONTRACT_DICEGAME.connect(alice).redeem();
            await expect(tx).to.emit(CONTRACT_DICEGAME, "Redeem").withArgs(alice.address, alicePointsNow);
            await expect(tx).to.emit(CONTRACT_V3Deployer, "Redeem").withArgs(tokens[0], alice.address, tokenAmounts[0]);
            await expect(tx).to.emit(CONTRACT_V3Deployer, "Redeem").withArgs(tokens[1], alice.address, tokenAmounts[1]);
            await expect(tx).to.emit(CONTRACT_V3Deployer, "Redeem").withArgs(tokens[2], alice.address, tokenAmounts[2]);
            await expect(tx).to.emit(CONTRACT_V3Deployer, "Redeem").withArgs(tokens[3], alice.address, tokenAmounts[3]);
            await expect(tx).to.emit(CONTRACT_V3Deployer, "Redeem").withArgs(tokens[4], alice.address, tokenAmounts[4]);

            memeToken = await ethers.getContractAt("Token", tokens[3]);

            expect(await memeToken.balanceOf(alice.address)).to.eq(tokenAmounts[3]);

        });
        it("should failed redeem twice from one acc", async () => {
            await expect(CONTRACT_DICEGAME.connect(alice).redeem()).to.be.reverted;
        });
        it("should succeed redeem Bob tokens", async () => {
            const bobPointsNow = ethers.parseEther("1005");
            let tx = await CONTRACT_DICEGAME.connect(bob).redeem();
            await expect(tx).to.emit(CONTRACT_DICEGAME, "Redeem").withArgs(bob.address, bobPointsNow);
            await expect(CONTRACT_DICEGAME.connect(bob).redeem()).to.be.reverted;
        });
    });

    describe("Pump", () => {
        it("should initialize Token successfully", async () => {
            const gameInfo = await CONTRACT_V3Deployer.getGameInfo(CONTRACT_DICEGAME.target);
            const tokens = gameInfo[4].map(el => (el[0]))
            const idsNFT = gameInfo[4].map(el => (el[4]))
            //Here we can test all 5 tokens, just change id of token address
            //0.1.2.3.4
            tokenId = 4;
            memeToken = await ethers.getContractAt("Token", tokens[tokenId]);

            const V3Pool = gameInfo[4][tokenId][1];
            const v3PositionId = idsNFT[tokenId];

            expect(await memeToken.wrappedNative()).to.equal(WMETIS_ADDRESS);
            expect(await memeToken.positionManager()).to.equal(POSITION_MANAGER_ADDRESS);
            expect(await memeToken.V3Pool()).to.equal(V3Pool);
            expect(await memeToken.posTokenId()).to.equal(v3PositionId);
            const zeroForTokenIn = BigInt(memeToken.target.toString()) < BigInt(WMETIS_ADDRESS); 
            // const pool = await ethers.getContractAt("IUniswapV3Pool", V3Pool);
            // console.log("token0", await pool.token0()); // meme
            // console.log("token1", await pool.token1()); //wmetis
            expect(await memeToken.zeroForTokenIn()).to.equal(!zeroForTokenIn); //true   depend from meme address WMETIS is tokenIn(token0)
            expect(await memeToken.sponsorWallet()).to.equal(sponsorWalletAddress);
        });
        it("Should revert if tryToEnablePump called too early", async () => {
            const callbackGasPayment = ethers.parseEther("0.001");
            await expect(memeToken.connect(alice).tryToEnablePump({ value: callbackGasPayment })).to.be.revertedWith("too early");
        });
        it("should revert if pump() is called when it is not enabled", async function () {
            await expect(memeToken.connect(alice).pump()).to.be.revertedWith("pump not enabled");
        });
        it("should enable pump when conditions are met", async () => {
            let currentTimestamp = await time.latest();
            const PUMP_INTERVAL = await memeToken.pumpInterval();

            await time.increaseTo(BigInt(currentTimestamp) + PUMP_INTERVAL);

            expect(await memeToken.isTimeToPump()).to.be.equal(true);

            const callbackGasPayment = ethers.parseEther("0.001");

            const tx = await memeToken.connect(alice).tryToEnablePump({ value: callbackGasPayment });
            const txReceipt = await tx.wait(1, 5000)!;
            let requestId;
            if (txReceipt) {
                const index = txReceipt.logs.findIndex((log) => log.topics[0] === ethers.id("TryToEnablePump(bytes32)"));
                if (index !== -1 && txReceipt.logs[index]) {
                    requestId = (txReceipt.logs[index] as any).args[0];
                } else {
                    throw new Error("DecreaseLiquidity event not found in logs.");
                }
            } else {
                throw new Error("Transaction failed or was not confirmed.");
            }
            // Assuming requestId is stored sequentially starting from 1
            expect(await memeToken.pendingRequestIds(requestId)).to.be.equal(true);

            const randomWords = [2];
            const data = ethers.AbiCoder.defaultAbiCoder().encode(["uint256[]"], [randomWords]);
            await expect(memeToken.connect(airnodeRrpV0).fulfillRandomWords(requestId, data))
                .to.emit(memeToken, "PumpEnabled")
                .withArgs(true, requestId);
            expect(await memeToken.pumpEnabled()).to.be.true;
            // Check if the state variables were updated correctly
            currentTimestamp = await time.latest();
            expect(await memeToken.pumpLastTimestamp()).to.be.equal(currentTimestamp);

            pumpSnapshot = await takeSnapshot();
        });
        it("Should revert if pump is already enabled", async () => {
            const callbackGasPayment = ethers.parseEther("0.001");

            await expect(memeToken.connect(alice).tryToEnablePump({ value: callbackGasPayment })).to.be.revertedWith(
                "already enabled"
            );
        });
        it("should call pump() an emit a Pump event with correct values", async function () {
            const gameInfo = await CONTRACT_V3Deployer.getGameInfo(CONTRACT_DICEGAME.target);
            const tokens = gameInfo[4].map(el => (el[0]))

            const memeTokenAddress = tokens[tokenId];
            const totalSupplyBefore = await memeToken.totalSupply();
            const pool = await memeToken.V3Pool();
            expect(await memeToken.pumpEnabled()).to.be.true;

            // Set up expected values and mocks' behavior
            const wrappedBalance = await CONTRACT_WMETIS.balanceOf(memeToken.target);
            const PUMP_BPS = await memeToken.pumpBPS();
            const pampAmt = (wrappedBalance * PUMP_BPS) / 10000n;
            const zeroForIn =  BigInt(memeTokenAddress) <  BigInt(WMETIS_ADDRESS);
            let [, amountOut] = await quoter.quoteExactInputSingle(!zeroForIn, pool, pampAmt);

            // Expect the Pump event to be emitted with the correct values
            await expect(memeToken.connect(bob).pump()).to.emit(memeToken, "Pump").withArgs(pampAmt, amountOut);

            // Check if the state variables were updated correctly
            const totalSupplyAfter = await memeToken.totalSupply();
            expect(totalSupplyAfter).to.equal(totalSupplyBefore - amountOut);
            expect(await CONTRACT_WMETIS.balanceOf(memeToken.target)).to.equal(wrappedBalance - pampAmt);
            expect(await memeToken.pumpEnabled()).to.be.false;
        });
    });

    describe("Check next game creation", () => {
        it("check that we can create new game again after all", async () => {
            const DiceGame = await ethers.getContractFactory("DiceGame");
            //address _gameRngWalletAddress, uint _gamePeriod, IV3Deployer _V3Deployer
            CONTRACT_SECOND_DICEGAME = await DiceGame.deploy(
                operator.address,
                10 * SEC_IN_DAY,
                CONTRACT_V3Deployer.target,
                WMETIS_ADDRESS
            );
            await CONTRACT_SECOND_DICEGAME.waitForDeployment();
                
            
            const deadline = (await time.latest()) + 60;

            const initialTokenRate = ethers.parseUnits("100", 18); // 100e18 points per 1e18 WMETIS
            await expect(CONTRACT_V3Deployer.createGame(
                CONTRACT_SECOND_DICEGAME.target,
                sponsorWalletAddress,
                initialTokenRate,
                deadline
            )).to.emit(CONTRACT_V3Deployer, "NewGameStarted")
                .withArgs(CONTRACT_SECOND_DICEGAME.target);

            expect(await CONTRACT_V3Deployer.activeGame()).to.eq(CONTRACT_SECOND_DICEGAME.target);
            expect(await CONTRACT_SECOND_DICEGAME.initialTokenRate()).to.equal(initialTokenRate);
            // // Verify endTime is set correctly, taking into account block timestamp variability
            const blockTimestamp = await time.latest();
            const GAME_PERIOD = await CONTRACT_SECOND_DICEGAME.gamePeriod();
            expect(await CONTRACT_SECOND_DICEGAME.endTime()).to.be.closeTo(blockTimestamp + Number(GAME_PERIOD), 5);
            expect(await CONTRACT_V3Deployer.distributedGames(CONTRACT_SECOND_DICEGAME.target)).to.be.false;
        });
        
    });


})

