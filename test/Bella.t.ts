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

import {
    IERC20,
    BellaDiceGame,
    BellaLiquidityVault,
    Bella,
    IWETH,
    IUniswapV3Pool,
} from "../typechain-types";
import { Console } from "console";

describe("Bella Dice Game", function () {
    const LinkTokenAddress = "0x514910771AF9Ca656af840dff83E8264EcF986CA";
    const VRFCoordinator = "0x271682DEB8C4E0901D1a1550aD2e64D568E69909";
    const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    const UNDERLYING_POSITION_MANAGER_ADDRESS = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
    const UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
    const DONOR_LINK_ADDRESS = "0xF977814e90dA44bFA03b6295A0616a897441aceC";

    let owner: HardhatEthersSigner;
    let alice: HardhatEthersSigner;
    let bob: HardhatEthersSigner;
    let startGameSnapshot: SnapshotRestorer;
    let bella: Bella;
    let weth9: IWETH;
    let vault: BellaLiquidityVault;
    let game: BellaDiceGame;
    let linkToken: IERC20;

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

        weth9 = await ethers.getContractAt("IWETH", WETH_ADDRESS);
        weth9.connect(owner).deposit({ value: ethers.parseUnits("100000", 18) });
        weth9.connect(alice).deposit({ value: ethers.parseUnits("1000000", 18) });
        weth9.connect(bob).deposit({ value: ethers.parseUnits("1000000", 18) });

        linkToken = await ethers.getContractAt("IERC20", LinkTokenAddress);

        const BellaLiquidityVaultFactory = await ethers.getContractFactory("BellaLiquidityVault");
        vault = (await BellaLiquidityVaultFactory.deploy(LinkTokenAddress, VRFCoordinator)) as BellaLiquidityVault;

        const BellaDiceGameFactory = await ethers.getContractFactory("BellaDiceGame");
        game = (await BellaDiceGameFactory.deploy(LinkTokenAddress, VRFCoordinator, WETH_ADDRESS, await vault.getAddress(), UNDERLYING_POSITION_MANAGER_ADDRESS, UNISWAP_V3_FACTORY)) as BellaDiceGame;

        await getTokens(
            DONOR_LINK_ADDRESS,
            [owner.address, alice.address, bob.address],
            [
                { tokenAddress: LinkTokenAddress, amount: ethers.parseUnits("10", 18) },
            ]
        );

        await maxApprove(owner, await vault.getAddress(), [LinkTokenAddress, WETH_ADDRESS]);
        await maxApprove(alice, await vault.getAddress(), [LinkTokenAddress, WETH_ADDRESS]);
        await maxApprove(bob, await vault.getAddress(), [LinkTokenAddress, WETH_ADDRESS]);

        await maxApprove(owner, await game.getAddress(), [LinkTokenAddress, WETH_ADDRESS]);
        await maxApprove(alice, await game.getAddress(), [LinkTokenAddress, WETH_ADDRESS]);
        await maxApprove(bob, await game.getAddress(), [LinkTokenAddress, WETH_ADDRESS]);

    });

    describe("Start the game and purchase BellaPoints", function () {

        it("should revert if the BellaVault is not owned by the contract", async function () {
            await expect(game.startGame(ethers.parseUnits("0.1", 18))).to.be.revertedWith("vault not owned by this contract");
        });

        it("should revert if the Link balance of the contract is zero", async function () {
            vault.transferOwnership(await game.getAddress());
            await expect(game.startGame(ethers.parseUnits("0.1", 18))).to.be.revertedWith("no LINK");
        });

        it("should revert purchase Bella points if the game is not started", async function () {
            await expect(game.purchasePoints(1)).to.be.revertedWith("game not started yet");
            // Attempt to send ETH to the contract, which should fail
            const sendValue = ethers.parseEther("1");

            await expect(
                alice.sendTransaction({
                    to: await game.getAddress(),
                    value: sendValue,
                })
            ).to.be.revertedWith("game not started yet");
        });

        it("should start the game with correct initial token rate and emit event", async function () {
            vault.transferOwnership(await game.getAddress());
            linkToken.connect(owner).transfer(await game.getAddress(), ethers.parseUnits("5", 18));

            const initialTokenRate = ethers.parseUnits("10", 18);// 10 Bella per WETH
            await expect(game.startGame(initialTokenRate))
                .to.emit(game, "StartGame")
                .withArgs(initialTokenRate);

            expect(await game.initialTokenRate()).to.equal(initialTokenRate);
            // Verify endTime is set correctly, taking into account block timestamp variability
            const blockTimestamp = await time.latest();
            const GAME_PERIOD = await game.GAME_PERIOD();
            expect(await game.endTime()).to.be.closeTo(blockTimestamp + Number(GAME_PERIOD), 5);

            startGameSnapshot = await takeSnapshot();
        });

        it('should calculate the correct amount of points based on payment', async function () {

            const paymentAmountInEth = ethers.parseEther("1"); // 1 ETH
            const expectedPointsAmount = ethers.parseUnits("10", 18);

            expect(await game.calculatePointsAmount(paymentAmountInEth)).to.equal(expectedPointsAmount);
        });

        it('should calculate the correct payment amount for desired points', async function () {

            const desiredPointsAmount = ethers.parseUnits("10", 18);
            let paymentAmount = ethers.parseEther("1");
            expect(await game.calculatePaymentAmount(desiredPointsAmount)).to.equal(paymentAmount);
        });

        it('should round up the payment amount when necessary', async function () {
            // Example value where rounding is necessary
            const desiredPointsAmount = 9n;
            const exactPaymentAmount = 1n;
            expect(await game.calculatePaymentAmount(desiredPointsAmount)).to.equal(exactPaymentAmount);
        });


        it("should revert if the game is started more than once", async function () {
            await expect(game.startGame(ethers.parseUnits("10", 18))).to.be.revertedWith("only once");
        });

        it("should revert if the initial token rate is not greater than zero", async function () {
            await expect(game.startGame(0)).to.be.revertedWith("only once");
        });

        it("should revert if the game is over", async function () {
            await mineUpTo(await game.endTime() + 1n);
            await expect(game.purchasePoints(1)).to.be.revertedWith("game over");

            // Attempt to send ETH to the contract, which should fail
            const sendValue = ethers.parseEther("1");

            await expect(
                alice.sendTransaction({
                    to: await game.getAddress(),
                    value: sendValue,
                })
            ).to.be.revertedWith("game over");
        });

        it("Should receive Ether and mint tokens", async function () {
            await startGameSnapshot.restore();
            const sendValue = ethers.parseEther("1"); // Equivalent to 1 ETH
            const expectedTokenAmount = ethers.parseUnits("10", 18);/* Call calculatePointsAmount with sendValue */;

            // We will now send ETH to the contract to simulate purchasing tokens.
            const tx = await alice.sendTransaction({
                to: await game.getAddress(),
                value: sendValue,
            });

            await expect(tx)
                .to.emit(game, "MintBellaPoints") // Assuming this is an event emitted by _mintPoints
                .withArgs(alice.address, expectedTokenAmount);

            // Check WETH balance of the contract to ensure deposit was successful
            expect(await weth9.balanceOf(await game.getAddress())).to.equal(sendValue);
            // Check BellaPoints balance of the user to ensure minting was successful
            expect(await game.balanceOf(alice.address)).to.equal(expectedTokenAmount);
        });

        it('should allow users to purchase Bella points and emit event', async function () {
            const wethBalance = await weth9.balanceOf(await game.getAddress());
            // Arrange
            const desiredAmountOut = ethers.parseUnits("10", 18);
            // Calculate the payment amount(shoud be 1 ETH in this case)
            const paymentAmount = await game.calculatePaymentAmount(desiredAmountOut);
            expect(paymentAmount).to.equal(ethers.parseEther("1"));

            // Act & Assert Precondition (Game should not be over)
            expect(await game.gameNotOver()).to.be.true;

            await expect(game.connect(bob).purchasePoints(desiredAmountOut))
                .to.emit(game, "MintBellaPoints") // Assuming there is such an event
                .withArgs(bob.address, desiredAmountOut);

            // Assert Postconditions
            const bobBalance = await game.balanceOf(bob.address);
            expect(bobBalance).to.equal(desiredAmountOut);

            const newWethBalance = await weth9.balanceOf(await game.getAddress());
            expect(newWethBalance).to.equal(paymentAmount + wethBalance);
        });

        it("should revert if the purchase amount is zero", async function () {
            await expect(game.purchasePoints(0)).to.be.revertedWith("amount is too small");
        });
    });


});
