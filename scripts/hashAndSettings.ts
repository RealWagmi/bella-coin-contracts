import hardhat, { ethers } from "hardhat";


async function main() {
    const [deployer] = await ethers.getSigners();
    const network = hardhat.network.name;
    console.log(`[${network}] deployer address: ${deployer.address}`);
    console.log("current block number", await ethers.provider.getBlockNumber());
    const pumpInterval = 600n;
    const pumpBPS = 2500n;
    const liquidityBPS = 5000n;
    const BP = 10000;
    const V3Fee = 10000; // 1%
    const WRAPPED_NATIVE = "0x4200000000000000000000000000000000000006";
    const AirnodeRrpV0Address = "0xa0AD79D995DdeeB18a14eAef56A549A04e3Aa1Bd";
    const UNDERLYING_POSITION_MANAGER_ADDRESS = "0x11b6215E7b69F2B6AaB98c0CfD9f204462314412";
    const UNISWAP_V3_FACTORY = "0xC49c177736107fD8351ed6564136B9ADbE5B1eC3";
    const sponsorWallet = "0x9539891e8149534D251077Fb6c15041e3D9d972f";
  
    const DICE_GAME = "0xe82ab1717e902237e6431b9eAd525a308fAa6e11";
    const V3Deployer = "0xe76065483240A690d4DA226eeEB759107447C73f"
    const names = ["Cat1", "Cat2", "Cat3", "Cat4", "Cat5"];
    const symbols = ["CATA", "CATB", "CATC", "CATD", "CATE"];
    const keys = names.map(el => ethers.encodeBytes32String(el));

    const tokenParams = [
        {
            name: names[0],
            symbol: symbols[0],
            pumpInterval: pumpInterval,
            pumpBPS: pumpBPS,
            tokenBPS: 0.05 * BP,
            V3_fee: V3Fee
        },
        {
            name: names[1],
            symbol: symbols[1],
            pumpInterval: pumpInterval,
            pumpBPS: pumpBPS,
            tokenBPS: 0.2 * BP,
            V3_fee: V3Fee
        },
        {
            name: names[2],
            symbol: symbols[2],
            pumpInterval: pumpInterval,
            pumpBPS: pumpBPS,
            tokenBPS: 0.3 * BP,
            V3_fee: V3Fee
        },
        {
            name: names[3],
            symbol: symbols[3],
            pumpInterval: pumpInterval,
            pumpBPS: pumpBPS,
            tokenBPS: 0.4 * BP,
            V3_fee: V3Fee
        },
        {
            name: names[4],
            symbol: symbols[4],
            pumpInterval: pumpInterval,
            pumpBPS: pumpBPS,
            tokenBPS: 0.05 * BP,
            V3_fee: V3Fee
        },
    ];

   
    // const CONTRACT_DICE_GAME = await ethers.getContractAt("DiceGame", DICE_GAME);
    // const CONTRACT_V3Deployer = await ethers.getContractAt("V3Deployer", V3Deployer);
    // let tx;
    // tx = await CONTRACT_V3Deployer.transferLiquidity();
    // await tx.wait(3);

    // tx =  await CONTRACT_V3Deployer.setTokensParams(
    //     keys,
    //     tokenParams,
    //     liquidityBPS
    // );
    // await tx.wait(2); 
    // console.log("settings done");
    

    // tx = await CONTRACT_V3Deployer.deployTokens() 
    // await tx.wait(2); 
    // console.log("deploy done");
    // tx = await CONTRACT_V3Deployer.deployTokens() 
    // await tx.wait(2); 
    // console.log("deploy done");
    // tx = await CONTRACT_V3Deployer.deployTokens() 
    // await tx.wait(2); 
    // console.log("deploy done");
    // tx = await CONTRACT_V3Deployer.deployTokens() 
    // await tx.wait(2); 
    // console.log("deploy done");
    // tx = await CONTRACT_V3Deployer.deployTokens() 
    // await tx.wait(2); 
    // console.log("deploy done");

    // tx = await CONTRACT_V3Deployer.distributeLiquidity() 
    // await tx.wait(2);
    // console.log("distributeLiquidity done");
    // tx = await CONTRACT_V3Deployer.distributeLiquidity() 
    // await tx.wait(2);
    // console.log("distributeLiquidity done");
    // tx = await CONTRACT_V3Deployer.distributeLiquidity() 
    // await tx.wait(2);
    // console.log("distributeLiquidity done");
    // tx = await CONTRACT_V3Deployer.distributeLiquidity() 
    // await tx.wait(2);
    // console.log("distributeLiquidity done");
    // tx = await CONTRACT_V3Deployer.distributeLiquidity() 
    // await tx.wait(2);
    // console.log("distributeLiquidity done");
    

    // await hardhat.run("verify:verify", {
    //     address: "0x1c3376FC8BD6175672502D74843B399c8532C13A",
    //     constructorArguments: [
    //         AirnodeRrpV0Address,
    //         WRAPPED_NATIVE,
    //         UNDERLYING_POSITION_MANAGER_ADDRESS,
    //         sponsorWallet,
    //         names[0],
    //         symbols[0],
    //         pumpInterval,
    //         pumpBPS
    //     ],
    //     contract: "contracts/Token.sol:Token"
    // });


    await hardhat.run("verify:verify", {
        address: "0x33f14e4145fb17B11a6fea7C395e47977B3Cdeb0",
        constructorArguments: [
            AirnodeRrpV0Address,
            WRAPPED_NATIVE,
            UNDERLYING_POSITION_MANAGER_ADDRESS,
            sponsorWallet,
            names[1],
            symbols[1],
            pumpInterval,
            pumpBPS
        ],
        contract: "contracts/Token.sol:Token"
    });



    await hardhat.run("verify:verify", {
        address: "0xd873B21bbA85C6Ae02FB6AC9b934308F63fdA9C1",
        constructorArguments: [
            AirnodeRrpV0Address,
            WRAPPED_NATIVE,
            UNDERLYING_POSITION_MANAGER_ADDRESS,
            sponsorWallet,
            names[2],
            symbols[2],
            pumpInterval,
            pumpBPS
        ],
        contract: "contracts/Token.sol:Token"
    });


    await hardhat.run("verify:verify", {
        address: "0xf1a094aA14C322534AadfFAB420775874A1bED3B",
        constructorArguments: [
            AirnodeRrpV0Address,
            WRAPPED_NATIVE,
            UNDERLYING_POSITION_MANAGER_ADDRESS,
            sponsorWallet,
            names[3],
            symbols[3],
            pumpInterval,
            pumpBPS
        ],
        contract: "contracts/Token.sol:Token"
    });


    await hardhat.run("verify:verify", {
        address: "0xf18dcA58e1C643627D217C24750715173586B43c",
        constructorArguments: [
            AirnodeRrpV0Address,
            WRAPPED_NATIVE,
            UNDERLYING_POSITION_MANAGER_ADDRESS,
            sponsorWallet,
            names[4],
            symbols[4],
            pumpInterval,
            pumpBPS
        ],
        contract: "contracts/Token.sol:Token"
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