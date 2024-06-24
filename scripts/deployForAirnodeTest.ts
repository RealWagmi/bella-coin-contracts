import hardhat, { ethers } from "hardhat";
import { deriveSponsorWalletAddress } from "@api3/airnode-admin";

async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = hardhat.network.name;
    console.log(`[${network}] deployer address: ${deployer.address}`);
    console.log("current block number", await ethers.provider.getBlockNumber()); 

    const AirnodeRrpV0Address = "0xa0AD79D995DdeeB18a14eAef56A549A04e3Aa1Bd";
    const FactoryForTestAirnode = await ethers.getContractFactory("FactoryForTestAirnode");
    const CONTRACT_FACTORY = await FactoryForTestAirnode.deploy(AirnodeRrpV0Address);
    await CONTRACT_FACTORY.waitForDeployment();

    console.log(`FactoryForTestAirnode  deployed to ${CONTRACT_FACTORY.target}`);

    await sleep(10000);

    const quintessenceXpub =
        "xpub6CyZcaXvbnbqGfqqZWvWNUbGvdd5PAJRrBeAhy9rz1bbnFmpVLg2wPj1h6TyndFrWLUG3kHWBYpwacgCTGWAHFTbUrXEg6LdLxoEBny2YDz";

    const quintessenceAirnodeAddress = "0x224e030f03Cd3440D88BD78C9BF5Ed36458A1A25"; // constant in TOKEN SC

    const sponsorWalletAddress = deriveSponsorWalletAddress(
        quintessenceXpub,
        quintessenceAirnodeAddress,
        CONTRACT_FACTORY.target.toString() // used as the sponsor
    );

    console.log(`sponsorWalletAddress ${sponsorWalletAddress}`); 

    await sleep(10000);


    await hardhat.run("verify:verify", {
        address: CONTRACT_FACTORY.target,
        constructorArguments: [AirnodeRrpV0Address],
        contract: "contracts/FactoryForTestAirnode.sol:FactoryForTestAirnode"
    });

    await sleep(10000);

    let tx = await CONTRACT_FACTORY.setSponsor(sponsorWalletAddress);
    await tx.wait();

    tx = await CONTRACT_FACTORY.createGame();
    await tx.wait();

    tx = await CONTRACT_FACTORY.createGame();
    await tx.wait();

    const first = await CONTRACT_FACTORY.games(1);
    const second = await CONTRACT_FACTORY.games(2);
    console.log("firs game", first); 
    console.log("second game", second); 

    await hardhat.run("verify:verify", {
        address: first,
        constructorArguments: [AirnodeRrpV0Address, sponsorWalletAddress],
        contract: "contracts/TestAirnodeCallback.sol:QrngExample"
    });

    await sleep(10000);


    const send = {
        to: sponsorWalletAddress,
        value: ethers.parseEther("0.001")
    }
    const sendTx = await deployer.sendTransaction(send);
    await sendTx.wait();


    console.log("done!");
    process.exit(0);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
