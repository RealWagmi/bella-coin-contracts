import hardhat, { ethers } from "hardhat";
import { deriveSponsorWalletAddress } from "@api3/airnode-admin";

async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    const [deployer] = await ethers.getSigners();

    const network = hardhat.network.name;

    console.log(`[${network}] deployer address: ${deployer.address}`);

    const SEC_IN_HOUR = 3600;
    let AirnodeRrpV0Address = "";
    let UNDERLYING_POSITION_MANAGER_ADDRESS = "";
    let UNISWAP_V3_FACTORY = "";
    let SEND_VALUE; //0.002
    let QRNG_OPERATOR_ADDRESS = "";
    let WRAPPED_NATIVE = "";

    if (network === "metis") {
        //https://docs.api3.org/reference/qrng/chains.html#anu
        AirnodeRrpV0Address = "0xC02Ea0f403d5f3D45a4F1d0d817e7A2601346c9E";
        // wagmi
        UNDERLYING_POSITION_MANAGER_ADDRESS = "0xA7E119Cf6c8f5Be29Ca82611752463f0fFcb1B02";
        UNISWAP_V3_FACTORY = "0x8112E18a34b63964388a3B2984037d6a2EFE5B8A";
        SEND_VALUE = ethers.parseEther("0.002"); // 7 $  half for sponsorWallet and half for gameRngWallet
        QRNG_OPERATOR_ADDRESS = "0x73e68EF04F2eddCeF36f47C2F2a86a4Dd711a9c2";
    }

    if (network === "optimism") {
        //https://docs.api3.org/reference/qrng/chains.html#anu
        AirnodeRrpV0Address = "0xa0AD79D995DdeeB18a14eAef56A549A04e3Aa1Bd";
        UNDERLYING_POSITION_MANAGER_ADDRESS = "0x11b6215E7b69F2B6AaB98c0CfD9f204462314412";
        UNISWAP_V3_FACTORY = "0xC49c177736107fD8351ed6564136B9ADbE5B1eC3";
        QRNG_OPERATOR_ADDRESS = "0x63795e0f9223Ec4BFeF5fBE3dbf9331F1C57cC5c";
        WRAPPED_NATIVE = "0x4200000000000000000000000000000000000006";
    }


    const V3Deployer = await ethers.getContractFactory("V3Deployer");
    //address _airnodeRrpAddress, address _positionManagerAddress, address _factoryAddress, address _wrappedNative
    const CONTRACT_V3Deployer = await V3Deployer.deploy(
        AirnodeRrpV0Address,
        UNDERLYING_POSITION_MANAGER_ADDRESS,
        UNISWAP_V3_FACTORY,
        WRAPPED_NATIVE
    );
    await CONTRACT_V3Deployer.waitForDeployment();

    console.log(`V3Deployer  deployed to ${CONTRACT_V3Deployer.target}`);

    await sleep(10000);

    const DiceGame = await ethers.getContractFactory("DiceGame");
    //address _gameRngWalletAddress, uint _gamePeriod, IV3Deployer _V3Deployer
    const CONTRACT_DICEGAME = await DiceGame.deploy(
        QRNG_OPERATOR_ADDRESS,
        5 * SEC_IN_HOUR,
        CONTRACT_V3Deployer.target,
        WRAPPED_NATIVE
    );
    await CONTRACT_DICEGAME.waitForDeployment();

    console.log(`DICEGAME  deployed to ${CONTRACT_DICEGAME.target}`);

    await sleep(10000);

    const quintessenceXpub =
        "xpub6CyZcaXvbnbqGfqqZWvWNUbGvdd5PAJRrBeAhy9rz1bbnFmpVLg2wPj1h6TyndFrWLUG3kHWBYpwacgCTGWAHFTbUrXEg6LdLxoEBny2YDz";

    const quintessenceAirnodeAddress = "0x224e030f03Cd3440D88BD78C9BF5Ed36458A1A25"; // constant in TOKEN SC

    const sponsorWalletAddress = deriveSponsorWalletAddress(
        quintessenceXpub,
        quintessenceAirnodeAddress,
        CONTRACT_V3Deployer.target.toString() // used as the sponsor
    );

    console.log(`sponsorWalletAddress ${sponsorWalletAddress}`);

    await sleep(10000);

    // const latestBlock = (await hardhat.network.provider.send("eth_getBlockByNumber", ["latest", false])) as {
    //   timestamp: string;
    // };
    // const deadline = parseInt(latestBlock.timestamp, 16) + 120;
    // console.log("starting game...", deadline);
    // const initialTokenRate = ethers.parseUnits("1000000", 18); //  /// 1000 points for 0.001 WETH (3.6$)

    // await diceGame.startGame(sponsorWalletAddress, initialTokenRate, deadline, { value: SEND_VALUE });

    // console.log("game started!");

    // await sleep(30000);

    await hardhat.run("verify:verify", {
        address: CONTRACT_V3Deployer.target,
        constructorArguments: [
            AirnodeRrpV0Address,
            UNDERLYING_POSITION_MANAGER_ADDRESS,
            UNISWAP_V3_FACTORY,
            WRAPPED_NATIVE,
        ],
    });

    await hardhat.run("verify:verify", {
        address: CONTRACT_DICEGAME.target,
        constructorArguments: [
            QRNG_OPERATOR_ADDRESS,
            5 * SEC_IN_HOUR,
            CONTRACT_V3Deployer.target,
            WRAPPED_NATIVE
        ],
    });

    console.log("done!");
    process.exit(0);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
