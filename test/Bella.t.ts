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
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

import { IERC20, BellaDiceGame, BellaLiquidityVault, Bella, IWETH, QuoterV3, IUniswapV3Pool } from "../typechain-types";
import { Console } from "console";
import { link } from "fs";
import { deriveSponsorWalletAddress } from "@api3/airnode-admin";
import { BinaryLike } from "crypto";

describe("Bella Dice Game", function () {
  const AirnodeRrpV0Address = "0xa0AD79D995DdeeB18a14eAef56A549A04e3Aa1Bd";
  const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const UNDERLYING_POSITION_MANAGER_ADDRESS = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
  const UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";

  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let airnodeRrpV0: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let startGameSnapshot: SnapshotRestorer;
  let purchasePointsSnapshot: SnapshotRestorer;
  let betSnapshot: SnapshotRestorer;
  let deployBellaSnapshot: SnapshotRestorer;
  let pumpSnapshot: SnapshotRestorer;
  let bella: Bella;
  let weth9: IWETH;
  let vault: BellaLiquidityVault;
  let game: BellaDiceGame;
  let quoter: QuoterV3;
  const sponsorWalletAddress: string = "0x8A6165aE122b5bA0ee324263b00C25bBC61582f3";

  interface Asset {
    tokenAddress: string;
    amount: bigint;
  }
  async function getTokens(donorAddress: string, recipients: string[], assets: Asset[]) {
    await impersonateAccount(donorAddress);
    let donor = await ethers.provider.getSigner(donorAddress);
    for (const asset of assets) {
      const TOKEN: IERC20 = await ethers.getContractAt("IERC20", asset.tokenAddress);
      for (const recipient of recipients) {
        await TOKEN.connect(donor).transfer(recipient, asset.amount);
      }
    }
  }

  async function maxApprove(signer: HardhatEthersSigner, spenderAddress: string, erc20tokens: string[]) {
    for (const token of erc20tokens) {
      const erc20: IERC20 = await ethers.getContractAt("IERC20", token);
      await erc20.connect(signer).approve(spenderAddress, ethers.MaxUint256);
    }
  }

  before(async function () {
    [owner, alice, bob] = await ethers.getSigners();

    const QuoterV3Factory = await ethers.getContractFactory("QuoterV3");
    quoter = (await QuoterV3Factory.deploy()) as QuoterV3;

    weth9 = await ethers.getContractAt("IWETH", WETH_ADDRESS);
    weth9.connect(owner).deposit({ value: ethers.parseUnits("100000", 18) });
    weth9.connect(alice).deposit({ value: ethers.parseUnits("1000000", 18) });
    weth9.connect(bob).deposit({ value: ethers.parseUnits("1000000", 18) });

    const BellaLiquidityVaultFactory = await ethers.getContractFactory("BellaLiquidityVault");
    vault = (await BellaLiquidityVaultFactory.deploy(AirnodeRrpV0Address)) as BellaLiquidityVault;

    const BellaDiceGameFactory = await ethers.getContractFactory("BellaDiceGame");
    game = (await BellaDiceGameFactory.deploy(
      WETH_ADDRESS,
      await vault.getAddress(),
      UNDERLYING_POSITION_MANAGER_ADDRESS,
      UNISWAP_V3_FACTORY,
      AirnodeRrpV0Address
    )) as BellaDiceGame;

    await maxApprove(owner, await game.getAddress(), [WETH_ADDRESS]);
    await maxApprove(alice, await game.getAddress(), [WETH_ADDRESS]);
    await maxApprove(bob, await game.getAddress(), [WETH_ADDRESS]);

    const ForceSend = await ethers.getContractFactory("ForceSend");
    let forceSend = await ForceSend.deploy();
    await forceSend.go(AirnodeRrpV0Address, { value: ethers.parseUnits("10", "ether") });
    await impersonateAccount(AirnodeRrpV0Address);
    airnodeRrpV0 = await ethers.provider.getSigner(AirnodeRrpV0Address);
    // const anuXpub =
    //   "xpub6DXSDTZBd4aPVXnv6Q3SmnGUweFv6j24SK77W4qrSFuhGgi666awUiXakjXruUSCDQhhctVG7AQt67gMdaRAsDnDXv23bBRKsMWvRzo6kbf"

    // const anuAirnodeAddress = "0x9d3C147cA16DB954873A498e0af5852AB39139f2"

    // sponsorWalletAddress = deriveSponsorWalletAddress(
    //   anuXpub,
    //   anuAirnodeAddress,
    //   await game.getAddress() // used as the sponsor
    // );
    // console.log("sponsorWalletAddress", sponsorWalletAddress);
  });

  describe("Start the game and purchase BellaPoints", function () {
    it("should revert if the BellaVault is not owned by the contract", async function () {
      const deadline = (await time.latest()) + 60;
      await expect(game.startGame(sponsorWalletAddress, ethers.parseUnits("0.1", 18), deadline)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
      await vault.transferOwnership(await game.getAddress());
    });

    it("should revert purchase Bella points if the game is not started", async function () {
      await expect(game.purchasePoints(1)).to.be.revertedWith("game not started yet");
      // Attempt to send ETH to the contract, which should fail
      const sendValue = await game.calculatePaymentAmount(1);
      await expect(game.purchasePointsEth(1, { value: sendValue })).to.be.revertedWith("game not started yet");
    });

    it("should start the game with correct initial token rate and emit event", async function () {
      const deadline = (await time.latest()) + 60;

      const initialTokenRate = ethers.parseUnits("10", 18); // 10 Bella per WETH
      await expect(game.startGame(sponsorWalletAddress, initialTokenRate, deadline))
        .to.emit(game, "StartGame")
        .withArgs(initialTokenRate, sponsorWalletAddress);

      expect(await game.initialTokenRate()).to.equal(initialTokenRate);
      // Verify endTime is set correctly, taking into account block timestamp variability
      const blockTimestamp = await time.latest();
      const GAME_PERIOD = await game.GAME_PERIOD();
      expect(await game.endTime()).to.be.closeTo(blockTimestamp + Number(GAME_PERIOD), 5);

      startGameSnapshot = await takeSnapshot();
    });

    it("should calculate the correct amount of points based on payment", async function () {
      const paymentAmountInEth = ethers.parseEther("1"); // 1 ETH
      const expectedPointsAmount = ethers.parseUnits("10", 18);

      expect(await game.calculatePointsAmount(paymentAmountInEth)).to.equal(expectedPointsAmount);
    });

    it("should calculate the correct payment amount for desired points", async function () {
      const desiredPointsAmount = ethers.parseUnits("10", 18);
      let paymentAmount = ethers.parseEther("1");
      expect(await game.calculatePaymentAmount(desiredPointsAmount)).to.equal(paymentAmount);
    });

    it("should round up the payment amount when necessary", async function () {
      // Example value where rounding is necessary
      const desiredPointsAmount = 9n;
      const exactPaymentAmount = 1n;
      expect(await game.calculatePaymentAmount(desiredPointsAmount)).to.equal(exactPaymentAmount);
    });

    it("should revert if the game is started more than once", async function () {
      const deadline = (await time.latest()) + 60;
      await expect(game.startGame(sponsorWalletAddress, ethers.parseUnits("10", 18), deadline)).to.be.revertedWith(
        "only once"
      );
    });

    it("should revert if the initial token rate is not greater than zero", async function () {
      const deadline = (await time.latest()) + 60;
      await expect(game.startGame(sponsorWalletAddress, 0, deadline)).to.be.revertedWith("only once");
    });

    it("should revert if the game is over", async function () {
      await mineUpTo((await game.endTime()) + 1n);
      await expect(game.purchasePoints(1)).to.be.revertedWith("game over");

      // Attempt to send ETH to the contract, which should fail
      const sendValue = await game.calculatePaymentAmount(1);

      await expect(game.purchasePointsEth(1, { value: sendValue })).to.be.revertedWith("game over");
    });

    it("Should receive Ether and mint tokens", async function () {
      await startGameSnapshot.restore();
      const expectedTokenAmount = ethers.parseUnits("10", 18); /* Call calculatePointsAmount with sendValue */

      const sendValue = await game.calculatePaymentAmount(expectedTokenAmount);
      expect(sendValue).to.equal(ethers.parseEther("1"));

      const tx = await game.connect(alice).purchasePointsEth(expectedTokenAmount, { value: sendValue });

      await expect(tx)
        .to.emit(game, "MintBellaPoints") // Assuming this is an event emitted by _mintPoints
        .withArgs(alice.address, expectedTokenAmount);

      await expect(tx)
        .to.emit(game, "PurchasePoints") // Assuming this is an event emitted by _mintPoints
        .withArgs(alice.address, sendValue);

      // Check WETH balance of the contract to ensure deposit was successful
      expect(await weth9.balanceOf(await game.getAddress())).to.equal(sendValue);
      // Check BellaPoints balance of the user to ensure minting was successful
      expect(await game.balanceOf(alice.address)).to.equal(expectedTokenAmount);
    });

    it("should allow users to purchase Bella points and emit event", async function () {
      const wethBalance = await weth9.balanceOf(await game.getAddress());
      // Arrange
      const desiredAmountOut = ethers.parseUnits("10", 18);
      // Calculate the payment amount(shoud be 1 ETH in this case)
      const paymentAmount = await game.calculatePaymentAmount(desiredAmountOut);
      expect(paymentAmount).to.equal(ethers.parseEther("1"));

      // Act & Assert Precondition (Game should not be over)
      expect(await game.gameNotOver()).to.be.true;
      const tx = await game.connect(bob).purchasePoints(desiredAmountOut);
      await expect(tx)
        .to.emit(game, "MintBellaPoints") // Assuming there is such an event
        .withArgs(bob.address, desiredAmountOut);

      await expect(tx).to.emit(game, "PurchasePoints").withArgs(bob.address, paymentAmount);

      // Assert Postconditions
      const bobBalance = await game.balanceOf(bob.address);
      expect(bobBalance).to.equal(desiredAmountOut);

      const newWethBalance = await weth9.balanceOf(await game.getAddress());
      expect(newWethBalance).to.equal(paymentAmount + wethBalance);
      purchasePointsSnapshot = await takeSnapshot();
    });

    it("should revert if the purchase amount is zero", async function () {
      await expect(game.purchasePoints(0)).to.be.revertedWith("amount is too small");
    });
  });

  describe("Emergency withdraw", function () {
    it("Should not allow withdrawal if the max waiting time has not passed", async function () {
      await expect(game.connect(alice).emergencyWithdraw()).to.be.revertedWith("forbidden");
    });

    it("Should not allow withdrawal if the user balance is zero", async function () {
      const correctTime = (await game.endTime()) + (await game.maxWaitingTime()) + 1n;
      await mineUpTo(correctTime);
      // Ensuring that user has no balances
      expect(await game.balanceOf(owner.address)).to.equal(0);
      await expect(game.connect(owner).emergencyWithdraw()).to.be.revertedWith("zero balance");
    });

    it("Should allow withdrawal after the max waiting time and burn the user's points", async function () {
      const totalSupplyBefore = await game.totalSupply();
      const wethBalanceBefore = await weth9.balanceOf(await game.getAddress());
      const userBalanceWethBefore = await weth9.balanceOf(alice.address);
      const userBalance = await game.balanceOf(alice.address);

      await expect(game.connect(alice).emergencyWithdraw())
        .to.emit(game, "EmergencyWithdraw")
        .withArgs(alice.address, userBalance, ethers.parseEther("1"));

      // Check that the user's points were burned and total supply decreased
      const totalSupplyAfter = await game.totalSupply();
      expect(totalSupplyAfter).to.equal(totalSupplyBefore - userBalance);
      const wethBalanceAfter = await weth9.balanceOf(await game.getAddress());
      expect(wethBalanceAfter).to.equal(wethBalanceBefore - ethers.parseEther("1"));
      const userBalanceWethAfter = await weth9.balanceOf(alice.address);
      expect(userBalanceWethAfter).to.equal(userBalanceWethBefore + ethers.parseEther("1"));
    });
  });

  describe("bet", function () {
    it("should fail if bet amounts are invalid", async function () {
      await purchasePointsSnapshot.restore();
      let invalidBetAmounts = [0]; // Zero bet amount, which is invalid
      // Attempt to place a bet with invalid bet amounts and expect failure
      await expect(
        game.connect(alice).bet(invalidBetAmounts, { value: ethers.parseEther("0.001") })
      ).to.be.revertedWith("zero amount");

      invalidBetAmounts = [1, 1, 1, 1]; // Zero bet amount, which is invalid
      // Attempt to place a bet with invalid bet amounts and expect failure
      await expect(
        game.connect(alice).bet(invalidBetAmounts, { value: ethers.parseEther("0.001") })
      ).to.be.revertedWith("invalid betAmts");
    });

    it("should fail if user does not have enough points", async function () {
      const betAmts = [ethers.parseEther("10"), ethers.parseEther("10"), ethers.parseEther("10")];
      // Attempt to place a bet and expect failure due to insufficient points
      await expect(game.connect(alice).bet(betAmts, { value: ethers.parseEther("0.001") })).to.be.revertedWith(
        "points are not enough"
      );
    });

    it("should revert if there is not ETH to fulfill the QRNG request", async function () {
      const betAmts = [ethers.parseEther("1"), ethers.parseEther("1"), ethers.parseEther("1")];
      // Attempt to place a bet and expect failure due to not ETH to fulfill the QRNG request
      await expect(game.connect(alice).bet(betAmts))
        .to.be.revertedWithCustomError(game, "AmountOfEthSentIsTooSmall(uint256 sent,uint256  minimum)")
        .withArgs(0, anyValue);
      // Replenish the LINK balance
    });

    it("should allow a user to place a bet (3 dice) when conditions are met", async function () {
      const betAmts = [ethers.parseEther("1"), ethers.parseEther("2"), ethers.parseEther("3")];
      const bet = await game.connect(alice).bet(betAmts, { value: ethers.parseEther("0.001") });
      await expect(bet).to.emit(game, "Bet").withArgs(anyValue, alice.address, ethers.parseEther("6"));
      expect(await ethers.provider.getBalance(sponsorWalletAddress)).to.equal(ethers.parseEther("0.001"));
    });

    it("should allow a user to place a bet (2 dice) when conditions are met", async function () {
      const betAmts = [ethers.parseEther("2"), ethers.parseEther("3")];
      const bet = await game.connect(bob).bet(betAmts, { value: ethers.parseEther("0.001") });
      await expect(bet).to.emit(game, "Bet").withArgs(anyValue, bob.address, ethers.parseEther("5"));

      expect(await ethers.provider.getBalance(sponsorWalletAddress)).to.equal(ethers.parseEther("0.002"));
    });

    it("should allow a user to place a bet (1 dice) after emergencyFulFilledLastBet", async function () {
      const betAmts = [ethers.parseEther("5")];
      const bet = await game.connect(bob).bet(betAmts, { value: ethers.parseEther("0.001") });
      await expect(bet).to.emit(game, "Bet").withArgs(anyValue, bob.address, ethers.parseEther("5"));

      // The Eth balance of the sponsorship wallet must not be zero
      expect(await ethers.provider.getBalance(sponsorWalletAddress)).to.equal(ethers.parseEther("0.003"));
    });
  });

  describe("game logic", function () {
    it("should reject when round is not found", async function () {
      const invalidGameId = "0x1238798732c92a8cc8bcd8283a0a15da26bc2fb697fbc9f07b89bcbf0d959d4c"; // gameId that doesn't exist
      const randomWords = [123, 456, 789];
      const data = ethers.AbiCoder.defaultAbiCoder().encode(["uint256[]"], [randomWords]);

      await expect(game.connect(airnodeRrpV0).fulfillRandomWords(invalidGameId, data)).to.be.revertedWith(
        "round not found"
      );
    });

    it("should calculate winnings correctly", async function () {
      const totalSupplyBefore = await game.totalSupply();
      const userBalanceBefore = await game.balanceOf(bob.address);
      const [id, lastRound] = await game.getUserLastGameInfo(bob.address);
      expect(lastRound.fulfilled).to.equal(false);
      expect(lastRound.totalBet).to.equal(ethers.parseEther("5"));
      const randomWords = [27]; // dice number = 27 % 6 + 1 = 4
      const data = ethers.AbiCoder.defaultAbiCoder().encode(["uint256[]"], [randomWords]);
      await game.connect(airnodeRrpV0).fulfillRandomWords(id, data);
      const [idAfter, lastRoundAfter] = await game.getUserLastGameInfo(bob.address);
      expect(lastRoundAfter.fulfilled).to.equal(true);
      expect(lastRoundAfter.totalWinnings).to.equal(ethers.parseEther("20")); //5*4
      const expectedDiceRollResult = "4";
      expect(lastRoundAfter.diceRollResult.toString()).to.equal(expectedDiceRollResult);
      expect(idAfter).to.equal(id);
      const totalSupplyAfter = await game.totalSupply();
      const userBalanceAfter = await game.balanceOf(bob.address);
      expect(totalSupplyAfter).to.equal(totalSupplyBefore + ethers.parseEther("20") - lastRound.totalBet);
      expect(userBalanceAfter).to.equal(userBalanceBefore + ethers.parseEther("20") - lastRound.totalBet);
    });

    it("should calculate lucky 69 winnings correctly", async function () {
      const totalSupplyBefore = await game.totalSupply();
      const userBalanceBefore = await game.balanceOf(alice.address);
      const [id, lastRound] = await game.getUserLastGameInfo(alice.address);
      expect(lastRound.fulfilled).to.equal(false);
      expect(lastRound.totalBet).to.equal(ethers.parseEther("6"));
      const randomWords = [29, 28, 27]; // dice number = 29 % 6 + 1 = 6, 28 % 6 + 1 = 5, 27 % 6 + 1 = 4
      const data = ethers.AbiCoder.defaultAbiCoder().encode(["uint256[]"], [randomWords]);
      await game.connect(airnodeRrpV0).fulfillRandomWords(id, data);
      const [, lastRoundAfter] = await game.getUserLastGameInfo(alice.address);
      expect(lastRoundAfter.fulfilled).to.equal(true);
      const expectedDiceRollResult = "6,5,4";
      expect(lastRoundAfter.diceRollResult.toString()).to.equal(expectedDiceRollResult); //6,5,4
      expect(lastRoundAfter.totalWinnings).to.equal(ethers.parseEther("60")); //1*10+2*10+3*10
      const totalSupplyAfter = await game.totalSupply();
      const userBalanceAfter = await game.balanceOf(alice.address);
      expect(totalSupplyAfter).to.equal(totalSupplyBefore + ethers.parseEther("60") - lastRound.totalBet);
      expect(userBalanceAfter).to.equal(userBalanceBefore + ethers.parseEther("60") - lastRound.totalBet);
      betSnapshot = await takeSnapshot();
    });
  });

  describe("deploy Bella ,create V3 pool and distribute Liquidity", function () {
    it("distributeLiquidity should revert if Bella token address is not set", async function () {
      // Logic to simulate condition where Bella token address is not set
      await expect(game.distributeLiquidity()).to.be.revertedWith("call deployBella() first");
    });

    it("should deploy Bella token reverted when game is not over", async () => {
      await expect(game.deployBella()).to.be.revertedWith("game is NOT over");
    });

    it("should deploy Bella token once when game is over", async () => {
      await mineUpTo((await game.endTime()) + 1n);
      await game.connect(bob).deployBella();
      const bellaTokenAddress = await game.bellaToken();
      const bellaV3Pool = await game.bellaV3Pool();
      expect(bellaTokenAddress).to.not.equal(ethers.ZeroAddress);
      expect(bellaV3Pool).to.not.equal(ethers.ZeroAddress);
      const pool = await ethers.getContractAt("IUniswapV3Pool", bellaV3Pool);
      expect(await pool.token0()).to.equal(bellaTokenAddress);
      expect(await pool.token1()).to.equal(WETH_ADDRESS);
      const sqrtPriceX96expected = await game.calculateSqrtPriceX96();
      const [sqrtPriceX96current, , , , , ,] = await pool.slot0();
      expect(sqrtPriceX96current).to.equal(sqrtPriceX96expected);
      const bellaToken = await ethers.getContractAt("Bella", bellaTokenAddress);
      expect(await bellaToken.name()).to.equal("Bella");
      expect(await bellaToken.symbol()).to.equal("Bella");
      expect(await bellaToken.decimals()).to.equal(18);
      deployBellaSnapshot = await takeSnapshot();
    });

    it("should revert if Bella token is already deployed", async () => {
      await expect(game.deployBella()).to.be.revertedWith("bellaToken already set");
    });

    it("should redeem() fail if liquidity distribution has not yet occurred", async function () {
      await expect(game.connect(bob).redeem()).to.be.revertedWith("liquidity not distributed yet");
    });

    it("should mint Bella tokens and provide liquidity", async function () {
      const bellaTokenAddress = await game.bellaToken();
      const bellaToken = await ethers.getContractAt("Bella", bellaTokenAddress);

      const totalSupplyBefore = await game.totalSupply();
      const wethBalanceBefore = await weth9.balanceOf(await game.getAddress());

      // Simulate minting of Bella tokens and other interactions with the positionManager
      await expect(game.distributeLiquidity()).to.be.not.reverted;

      const wethBalanceVault = await weth9.balanceOf(await vault.getAddress());
      const wethBalanceAfter = await weth9.balanceOf(await game.getAddress());
      const totalSupplyBella = await bellaToken.totalSupply();

      expect(wethBalanceAfter).to.equal(0);
      expect(totalSupplyBella).to.closeTo(totalSupplyBefore / 2n, 5);
      expect(wethBalanceVault).to.closeTo(wethBalanceBefore / 2n, 5);
      const tokenId = await game.uniPosTokenId();
      expect(tokenId).gt(0);
      const positionManager = await ethers.getContractAt(
        "INonfungiblePositionManager",
        UNDERLYING_POSITION_MANAGER_ADDRESS
      );
      const position = await positionManager.positions(tokenId);
      expect(position.liquidity).to.gt(0);
      const vaultPosBalance = await positionManager.tokenOfOwnerByIndex(await vault.getAddress(), 0);
      expect(vaultPosBalance).to.equal(tokenId);
    });
  });

  describe("redeem()", function () {
    it("should allow users to redeem points for Bella tokens once the when liquidity distribution occurs", async function () {
      const bellaTokenAddress = await game.bellaToken();
      const bellaToken = await ethers.getContractAt("Bella", bellaTokenAddress);
      const bobBalanceBefore = await game.balanceOf(bob.address);
      const aliceBalanceBefore = await game.balanceOf(alice.address);
      const totalSupplyBefore = await game.totalSupply();

      await expect(game.connect(bob).redeem()).to.emit(game, "Redeem").withArgs(bob.address, bobBalanceBefore);

      const bobBalanceAfter = await game.balanceOf(bob.address);
      expect(bobBalanceAfter).to.equal(0);
      expect(await bellaToken.balanceOf(bob.address)).to.equal(bobBalanceBefore);

      await expect(game.connect(alice).redeem()).to.emit(game, "Redeem").withArgs(alice.address, aliceBalanceBefore);

      const totalSupplyAfter = await game.totalSupply();
      expect(totalSupplyAfter).to.equal(totalSupplyBefore - bobBalanceBefore - aliceBalanceBefore);

      const aliceBalanceAfter = await game.balanceOf(alice.address);
      expect(aliceBalanceAfter).to.equal(0);
      expect(await bellaToken.balanceOf(alice.address)).to.equal(aliceBalanceBefore);
    });

    it("should fail if the user balance is zero", async function () {
      expect(await game.balanceOf(bob.address)).to.equal(0);
      await expect(game.connect(bob).redeem()).to.be.revertedWith("zero balance");
    });
  });

  describe("BellaLiquidityVault", () => {
    it("should initialize successfully", async () => {
      const bellaTokenAddress = await game.bellaToken();
      const bellaV3Pool = await game.bellaV3Pool();
      const tokenId = await game.uniPosTokenId();

      expect(await vault.wrappedNativeTokenAddress()).to.equal(WETH_ADDRESS);
      expect(await vault.positionManager()).to.equal(UNDERLYING_POSITION_MANAGER_ADDRESS);
      expect(await vault.bellaV3Pool()).to.equal(bellaV3Pool);
      expect(await vault.bellaToken()).to.equal(bellaTokenAddress);
      expect(await vault.posTokenId()).to.equal(tokenId);
      expect(await vault.zeroForTokenIn()).to.equal(false); // WETH_ADDRESS is tokenIn(token1)
      expect(await vault.sponsorWallet()).to.equal(sponsorWalletAddress);
    });

    it("Should revert if tryToEnablePump called too early", async () => {
      const callbackGasPayment = ethers.parseEther("0.001");
      await expect(vault.connect(alice).tryToEnablePump({ value: callbackGasPayment })).to.be.revertedWith(
        "too early to enable pump"
      );
    });

    it("should revert if pump() is called when it is not enabled", async function () {
      await expect(vault.connect(alice).pump()).to.be.revertedWith("pump not enabled");
    });

    it("should enable pump when conditions are met", async () => {
      let currentTimestamp = await time.latest();
      const pumpInterval = await vault.pumpInterval();

      await mineUpTo(BigInt(currentTimestamp) + pumpInterval);

      expect(await vault.isTimeToPump()).to.be.equal(true);

      const callbackGasPayment = ethers.parseEther("0.001");

      const tx = await vault.connect(alice).tryToEnablePump({ value: callbackGasPayment });
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
      expect(await vault.pendingRequestIds(requestId)).to.be.equal(true);

      const randomWords = [2];
      const data = ethers.AbiCoder.defaultAbiCoder().encode(["uint256[]"], [randomWords]);
      await expect(vault.connect(airnodeRrpV0).fulfillRandomWords(requestId, data))
        .to.emit(vault, "PumpEnabled")
        .withArgs(true, requestId);
      expect(await vault.pumpEnabled()).to.be.true;
      // Check if the state variables were updated correctly
      currentTimestamp = await time.latest();
      expect(await vault.pumpLastTimestamp()).to.be.equal(currentTimestamp);

      pumpSnapshot = await takeSnapshot();
    });

    it("Should revert if pump is already enabled", async () => {
      const callbackGasPayment = ethers.parseEther("0.001");

      await expect(vault.connect(alice).tryToEnablePump({ value: callbackGasPayment })).to.be.revertedWith(
        "pump already enabled"
      );
    });

    it("should call pump() an emit a Pump event with correct values", async function () {
      const bellaTokenAddress = await game.bellaToken();
      const bellaToken = await ethers.getContractAt("Bella", bellaTokenAddress);
      const totalSupplyBefore = await bellaToken.totalSupply();
      const pool = await vault.bellaV3Pool();
      expect(await vault.pumpEnabled()).to.be.true;

      // Set up expected values and mocks' behavior
      const wrappedBalance = await weth9.balanceOf(await vault.getAddress());
      const PUMP_BPS = await vault.PUMP_BPS();
      const pampAmt = (wrappedBalance * PUMP_BPS) / 10000n;
      const zeroForIn = BigInt(WETH_ADDRESS) < BigInt(bellaTokenAddress);
      let [, amountOut] = await quoter.quoteExactInputSingle(zeroForIn, pool, pampAmt);

      // Expect the Pump event to be emitted with the correct values
      await expect(vault.connect(bob).pump()).to.emit(vault, "Pump").withArgs(pampAmt, amountOut);

      // Check if the state variables were updated correctly
      const totalSupplyAfter = await bellaToken.totalSupply();
      expect(totalSupplyAfter).to.equal(totalSupplyBefore - amountOut);
      expect(await weth9.balanceOf(await vault.getAddress())).to.equal(wrappedBalance - pampAmt);
      expect(await vault.pumpEnabled()).to.be.false;
    });
  });
});
