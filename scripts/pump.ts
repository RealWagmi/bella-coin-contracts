import hardhat, { ethers } from "hardhat";

async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}


async function main() {
    const [deployer] = await ethers.getSigners();
    const network = hardhat.network.name;

    console.log(`[${network}] deployer address: ${deployer.address}`);

    const vault = await ethers.getContractAt("BellaLiquidityVault", "0x9ADCAECd79Ef2045D7CCb264FaA13e7733Ccb5e1");
    const isTimeToPump = await vault.isTimeToPump();
    console.log("isTimeToPump", isTimeToPump);
    await sleep(1000);
    const pumpEnabled = await vault.pumpEnabled();
    console.log("pumpEnabled", pumpEnabled);
    await sleep(1000);
    if (pumpEnabled) {
        await vault.pump();
    } else if (isTimeToPump) {
        await vault.tryToEnablePump({ value: ethers.parseEther("0.005") });
    }

    console.log("done!");
    process.exit(0);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
