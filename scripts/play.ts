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
    // const desiredAmt = ethers.parseUnits("10", 18);
    // const sendValue = await game.calculatePaymentAmount(desiredAmt);
    // await game.purchasePointsEth(desiredAmt, { value: sendValue });
    // console.log("sendValue", sendValue.toString());
    // await sleep(10000);
    // let betAmts = [ethers.parseEther("1"), ethers.parseEther("1"), ethers.parseEther("1")];
    // await game.bet(betAmts, { value: ethers.parseEther("0.005") });
    // console.log("bet1");
    // await sleep(10000);
    // betAmts = [ethers.parseEther("1"), ethers.parseEther("2")];
    // await game.bet(betAmts, { value: ethers.parseEther("0.005") });
    // console.log("bet2");
    // await sleep(10000);

    // betAmts = [ethers.parseEther("1")];
    // await game.bet(betAmts, { value: ethers.parseEther("0.005") });
    // console.log("bet3");

    const balance = await game.balanceOf(deployer.address);
    console.log("balance", ethers.formatEther(balance));

    const info = await game.getUserLastGameInfo(deployer.address);
    console.log(info);

    console.log("done!");
    process.exit(0);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
