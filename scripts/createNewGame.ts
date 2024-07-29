import hardhat, { ethers } from "hardhat";
import { deriveSponsorWalletAddress } from "@api3/airnode-admin";

async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    const [deployer] = await ethers.getSigners();

    const network = hardhat.network.name;

    console.log(`[${network}] deployer address: ${deployer.address}`);

    const SEC_IN_HOUR = 3600n;
    const SEC_IN_DAY = 86400n;
    let AirnodeRrpV0Address = "";
    let UNDERLYING_POSITION_MANAGER_ADDRESS = "";
    let UNISWAP_V3_FACTORY = "";
    let SEND_VALUE; //0.002
    let QRNG_OPERATOR_ADDRESS = "";
    let WRAPPED_NATIVE = "";
    let GAME_PERIOD;
    let CONTRACT_V3Deployer;
    let sponsorWalletAddress = "";

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
        SEND_VALUE = ethers.parseEther("0.002"); // 7 $  half for sponsorWallet and half for gameRngWallet
        GAME_PERIOD = SEC_IN_DAY * 5n + (SEC_IN_DAY * 3n / 2n); // 6.5 days
        CONTRACT_V3Deployer = await ethers.getContractAt("V3Deployer", "0x73e9da1dc2fe5d0f69c479573ed089037007a8cc")
        sponsorWalletAddress = "0xD364CAC39EA7251adF5a8F1c73e6ccD9ea5a121C";
    }
    await sleep(10000);

    let tx = await CONTRACT_V3Deployer!.transferLiquidity()
    await tx.wait()
    console.log("transferLiquidity done");

    const liquidityBPS = 4000n;
    const pumpBPS = 2500n;
    const tokenParams = [
        {
            name: "Test1",
            symbol: "TST1",
            pumpInterval: 5n * SEC_IN_DAY,
            pumpBPS: pumpBPS,
            tokenBPS: 10000n,
            V3_fee: 10000
        },
    ];

    tx = await CONTRACT_V3Deployer!.setTokensParams(
        [ethers.encodeBytes32String("example1")],
        tokenParams,
        liquidityBPS
    );
    await tx.wait()
    console.log("setTokensParams done");

    tx = await CONTRACT_V3Deployer!.deployTokens()
    await tx.wait()
    console.log("deploy token done");

    tx = await CONTRACT_V3Deployer!.distributeLiquidity()
    await tx.wait()
    console.log("deploy token done");

    console.log("active game", await CONTRACT_V3Deployer!.activeGame());
    await sleep(10000);


    const DiceGame = await ethers.getContractFactory("DiceGame");
    //address _gameRngWalletAddress, uint _gamePeriod, IV3Deployer _V3Deployer
    const CONTRACT_DICEGAME = await DiceGame.deploy(
        QRNG_OPERATOR_ADDRESS,
        //@ts-ignore
        GAME_PERIOD,
        CONTRACT_V3Deployer!.target,
        WRAPPED_NATIVE
    );
    await CONTRACT_DICEGAME.waitForDeployment();
    console.log(`DICEGAME  deployed to ${CONTRACT_DICEGAME.target}`);

    await sleep(10000);

    const latestBlock = (await hardhat.network.provider.send("eth_getBlockByNumber", ["latest", false])) as {
        timestamp: string;
    };
    const deadline = parseInt(latestBlock.timestamp, 16) + 120;
    console.log("starting game...", deadline);
    const initialTokenRate = ethers.parseUnits("1000000", 18); //  /// 1000 points for 0.001 WETH (3.6$)


    await CONTRACT_V3Deployer!.createGame(CONTRACT_DICEGAME.target, sponsorWalletAddress, initialTokenRate, deadline, { value: SEND_VALUE });
    console.log("game started!");

    console.log("active game", await CONTRACT_V3Deployer!.activeGame());


    await sleep(30000);

    await hardhat.run("verify:verify", {
        address: CONTRACT_DICEGAME.target,
        constructorArguments: [
            QRNG_OPERATOR_ADDRESS,
            GAME_PERIOD,
            CONTRACT_V3Deployer!.target,
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
