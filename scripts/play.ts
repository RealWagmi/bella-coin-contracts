import hardhat, { ethers } from "hardhat";
import { deriveSponsorWalletAddress } from "@api3/airnode-admin";

async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}


async function main() {
    const [deployer] = await ethers.getSigners();
    const network = hardhat.network.name;

    console.log(`[${network}] deployer address: ${deployer.address}`);
    // const latestBlock = (await hardhat.network.provider.send("eth_getBlockByNumber", ["latest", false])) as { timestamp: string };
    // const deadline = parseInt(latestBlock.timestamp, 16) + 120;
    // await sleep(1000);

    const game = await ethers.getContractAt("BellaDiceGame", "0x5Cb58CEDE5C98B87bEdbF03A66EB25A6597fA3D0");
    const gameNotOver = await game.gameNotOver();
    if (gameNotOver) {

        // const desiredAmt = ethers.parseUnits("10", 18);
        // const sendValue = await game.calculatePaymentAmount(desiredAmt);
        // await game.purchasePointsEth(desiredAmt, { value: sendValue });
        // console.log("sendValue", sendValue.toString());
        // await sleep(10000);

        // let betAmts = [ethers.parseEther("1"), ethers.parseEther("1"), ethers.parseEther("1")];
        // await game.bet(betAmts, { value: ethers.parseEther("0.005") });
        // console.log("bet1");
        // await sleep(1000);
        // betAmts = [ethers.parseEther("1"), ethers.parseEther("1")];
        // await game.bet(betAmts, { value: ethers.parseEther("0.005") });
        // console.log("bet2");
        // await sleep(1000);

        // betAmts = [ethers.parseEther("1")];
        // await game.bet(betAmts, { value: ethers.parseEther("0.005") });
        // console.log("bet3");
    } else {
        console.log("game is over");
        const gameOver = await game.gameOver();//gameNotOver+3min
        if (gameOver) {
            let bellaToken = await game.bellaToken();
            console.log("bellaToken address", bellaToken);
            const bellaV3Pool = await game.bellaV3Pool();
            console.log("bellaV3Pool address", bellaV3Pool);
            if (bellaToken == ethers.ZeroAddress) {
                await game.deployBella();
                bellaToken = await game.bellaToken();
                console.log("bellaToken address", bellaToken);
            } else {
                const uniPosTokenId = await game.uniPosTokenId();
                console.log("uniPosTokenId", uniPosTokenId);
                if (uniPosTokenId == 0n) {
                    await game.distributeLiquidity();
                    const uniPosTokenId = await game.uniPosTokenId();
                    console.log("uniPosTokenId", uniPosTokenId.toString());
                } else {
                    console.log("redeem");
                    await game.redeem();
                    const bellaTokenErc20 = await ethers.getContractAt("Bella", bellaToken);
                    const balanceBella = await bellaTokenErc20.balanceOf(deployer.address);
                    console.log("balanceBella", ethers.formatEther(balanceBella));
                }
            }
        }
    }

    const balance = await game.balanceOf(deployer.address);
    console.log("balance", ethers.formatEther(balance));

    // const info = await game.getUserLastGameInfo(deployer.address);
    // console.log(info);

    console.log("done!");
    process.exit(0);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
