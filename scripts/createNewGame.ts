import hardhat, { ethers } from "hardhat";
import { deriveSponsorWalletAddress } from "@api3/airnode-admin";

async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createKeysArray(quantity: number) {
    const encodedArray = [];
    for (let i = 1; i <= quantity; i++) {
        encodedArray.push(ethers.encodeBytes32String(`example${i}`));
    }
    return encodedArray;
}

function timeConverter(UNIX_timestamp: number) {
    var a = new Date(UNIX_timestamp * 1000);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var year = a.getFullYear();
    var month = months[a.getMonth()];
    var date = a.getDate();
    var hour = a.getHours();
    var min = a.getMinutes();
    var sec = a.getSeconds();
    var time = date + ' ' + month + ' ' + year + ' ' + hour + ':' + min + ':' + sec;
    return time;
}

async function getTimestamp(bn: number): Promise<number | null> {
    const block = await ethers.provider.getBlock(bn);
    if (block) {
        return block.timestamp;
    } else {
        console.warn(`Block ${bn} not found`);
        return null;
    }
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
        GAME_PERIOD = SEC_IN_DAY * 4n - SEC_IN_HOUR * 3n;
    }

    if (network === "optimism") {
        //https://docs.api3.org/reference/qrng/chains.html#anu
        AirnodeRrpV0Address = "0xa0AD79D995DdeeB18a14eAef56A549A04e3Aa1Bd";
        UNDERLYING_POSITION_MANAGER_ADDRESS = "0x11b6215E7b69F2B6AaB98c0CfD9f204462314412";
        UNISWAP_V3_FACTORY = "0xC49c177736107fD8351ed6564136B9ADbE5B1eC3";
        QRNG_OPERATOR_ADDRESS = "0x63795e0f9223Ec4BFeF5fBE3dbf9331F1C57cC5c";
        WRAPPED_NATIVE = "0x4200000000000000000000000000000000000006";
        SEND_VALUE = ethers.parseEther("0.002"); // 7 $  half for sponsorWallet and half for gameRngWallet
        GAME_PERIOD = SEC_IN_DAY * 5n - SEC_IN_HOUR * 3n;
        CONTRACT_V3Deployer = await ethers.getContractAt("V3Deployer", "0x73e9da1dc2fe5d0f69c479573ed089037007a8cc")
        sponsorWalletAddress = "0xD364CAC39EA7251adF5a8F1c73e6ccD9ea5a121C";
    }

    if (network === "base") {
        //https://docs.api3.org/reference/qrng/chains.html#anu
        AirnodeRrpV0Address = "0xa0AD79D995DdeeB18a14eAef56A549A04e3Aa1Bd";
        UNDERLYING_POSITION_MANAGER_ADDRESS = "0x8187808B163E7CBAcCc4D0A9B138AE6196ac1f72";
        UNISWAP_V3_FACTORY = "0x576A1301B42942537d38FB147895fE83fB418fD4";
        QRNG_OPERATOR_ADDRESS = "0x63795e0f9223Ec4BFeF5fBE3dbf9331F1C57cC5c";
        WRAPPED_NATIVE = "0x4200000000000000000000000000000000000006";
        SEND_VALUE = ethers.parseEther("0.002"); // 7 $  half for sponsorWallet and half for gameRngWallet
        GAME_PERIOD = SEC_IN_DAY * 5n - SEC_IN_HOUR * 3n;
    }

    let tx = await CONTRACT_V3Deployer!.transferLiquidity()
    await tx.wait()
    console.log("transferLiquidity done");

    const liquidityBPS = 5000n;
    const pumpBPS = 2500n;
    const tokensQuantity = 2;
    // const keys = createKeysArray(tokensQuantity); // I can't use it for prod
    const keys = ["0xc7393a6f45b3052dd0a7acc73a7965e67508e78d9e0e7ebc96aa8d3a8ea46898", "0x94602bbd23d1585fa591cee35ca8473d4494c19b5ca774d93dc61fca2cbca0f8"];

    const tokenParams = [
        {
            name: "Gojo Token",
            symbol: "GTK",
            pumpInterval: SEC_IN_HOUR/6n,
            pumpBPS: pumpBPS,
            tokenBPS: 9363n,
            V3_fee: 10000
        },
        {
            name: "SafeCrypto",
            symbol: "SFC",
            pumpInterval: SEC_IN_HOUR/6n,
            pumpBPS: pumpBPS,
            tokenBPS: 637n,
            V3_fee: 10000
        }
    ];

    tx = await CONTRACT_V3Deployer!.setTokensParams(
        keys,
        tokenParams,
        liquidityBPS
    );
    await tx.wait()
    console.log("setTokensParams done");

    for (let i = 1; i <= tokensQuantity; i++) {
        tx = await CONTRACT_V3Deployer!.deployTokens()
        await tx.wait()
        console.log(`deploy token ${i} done`);
    }

    const gameInfo = await CONTRACT_V3Deployer!.getGameInfo(await CONTRACT_V3Deployer!.activeGame())
    
    const tokenAddresses = [];
    for (let i = 0; i < tokensQuantity; i++) {
        tokenAddresses.push(gameInfo[4][i][0])
    }
    console.log("tokenAddresses", tokenAddresses);

    await sleep(20000);
    for (let i = 0; i < tokensQuantity; i++) {
        await hardhat.run("verify:verify", {
            address: tokenAddresses[i],
            constructorArguments: [
                AirnodeRrpV0Address,
                WRAPPED_NATIVE,
                UNDERLYING_POSITION_MANAGER_ADDRESS,
                sponsorWalletAddress,
                tokenParams[i].name,
                tokenParams[i].symbol,
                tokenParams[i].pumpInterval,
                tokenParams[i].pumpBPS
            ]
        });
    }

    for (let i = 1; i <= tokensQuantity; i++) {
        tx = await CONTRACT_V3Deployer!.distributeLiquidity()
        await tx.wait()
        console.log(`distributeLiquidity token ${i} done`);
    }

    console.log("active game", await CONTRACT_V3Deployer!.activeGame());
    await sleep(10000);

    // const timeNowUnix = await getTimestamp(await ethers.provider.getBlockNumber());
    // const endAt = BigInt(timeNowUnix!)+ GAME_PERIOD!;
    // console.log("Game end at:", timeConverter(Number(endAt)));
    // await sleep(30000);

    // const DiceGame = await ethers.getContractFactory("DiceGame");
    // //address _gameRngWalletAddress, uint _gamePeriod, IV3Deployer _V3Deployer
    // const CONTRACT_DICEGAME = await DiceGame.deploy(
    //     QRNG_OPERATOR_ADDRESS,
    //     //@ts-ignore
    //     GAME_PERIOD,
    //     CONTRACT_V3Deployer!.target,
    //     WRAPPED_NATIVE
    // );
    // await CONTRACT_DICEGAME.waitForDeployment();
    // console.log(`DICEGAME  deployed to ${CONTRACT_DICEGAME.target}`);

    // await sleep(10000);

    // const latestBlock = (await hardhat.network.provider.send("eth_getBlockByNumber", ["latest", false])) as {
    //     timestamp: string;
    // };
    // const deadline = parseInt(latestBlock.timestamp, 16) + 120;
    // console.log("starting game...", deadline);
    // const initialTokenRate = ethers.parseUnits("1000000", 18); //  /// 1000 points for 0.001 WETH (3.6$)


    // await CONTRACT_V3Deployer!.createGame(CONTRACT_DICEGAME.target, sponsorWalletAddress, initialTokenRate, deadline, { value: SEND_VALUE });
    // console.log("game started!");

    // console.log("active game", await CONTRACT_V3Deployer!.activeGame());

    // await sleep(10000);

    // await hardhat.run("verify:verify", {
    //     address: CONTRACT_DICEGAME.target,
    //     constructorArguments: [
    //         QRNG_OPERATOR_ADDRESS,
    //         GAME_PERIOD,
    //         CONTRACT_V3Deployer!.target,
    //         WRAPPED_NATIVE
    //     ],
    // });

    console.log("done!");
    process.exit(0);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
