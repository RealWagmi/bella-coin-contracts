import hardhat, { ethers } from "hardhat";
import { deriveSponsorWalletAddress } from "@api3/airnode-admin";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hardhat.network.name;

  console.log(`[${network}] deployer address: ${deployer.address}`);

  let AirnodeRrpV0Address = "";
  let WETH_ADDRESS = "";
  let UNDERLYING_POSITION_MANAGER_ADDRESS = "";
  let UNISWAP_V3_FACTORY = "";

  if (network === "metis") {
    //https://docs.api3.org/reference/qrng/chains.html#anu
    AirnodeRrpV0Address = "0xC02Ea0f403d5f3D45a4F1d0d817e7A2601346c9E";
    // wagmi
    UNDERLYING_POSITION_MANAGER_ADDRESS = "0xA7E119Cf6c8f5Be29Ca82611752463f0fFcb1B02";
    UNISWAP_V3_FACTORY = "0x8112E18a34b63964388a3B2984037d6a2EFE5B8A";
    WETH_ADDRESS = "0x75cb093E4D61d2A2e65D8e0BBb01DE8d89b53481"; //WMETIS 18
  }

  const BellaLiquidityVaultFactory = await ethers.getContractFactory("BellaLiquidityVault");
  const vault = await BellaLiquidityVaultFactory.deploy(AirnodeRrpV0Address);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();

  await sleep(10000);

  console.log(`BellaLiquidityVault  deployed to ${vaultAddress}`);

  const BellaDiceGameFactory = await ethers.getContractFactory("BellaDiceGame");
  const diceGame = await BellaDiceGameFactory.deploy(
    WETH_ADDRESS,
    vaultAddress,
    UNDERLYING_POSITION_MANAGER_ADDRESS,
    UNISWAP_V3_FACTORY,
    AirnodeRrpV0Address
  );
  await diceGame.waitForDeployment();
  const diceGameAddress = await diceGame.getAddress();

  console.log(`BellaDiceGame  deployed to ${diceGameAddress}`);

  await sleep(10000);
  await vault.transferOwnership(diceGameAddress);
  console.log("Ownership of BellaLiquidityVault transferred to BellaDiceGame");

  await sleep(30000);

  const anuXpub =
    "xpub6DXSDTZBd4aPVXnv6Q3SmnGUweFv6j24SK77W4qrSFuhGgi666awUiXakjXruUSCDQhhctVG7AQt67gMdaRAsDnDXv23bBRKsMWvRzo6kbf";

  const anuAirnodeAddress = "0x9d3C147cA16DB954873A498e0af5852AB39139f2";

  const sponsorWalletAddress = deriveSponsorWalletAddress(
    anuXpub,
    anuAirnodeAddress,
    diceGameAddress // used as the sponsor
  );

  console.log(`sponsorWalletAddress ${sponsorWalletAddress}`);

  await sleep(10000);

  const deadline = (await time.latest()) + 120;
  const initialTokenRate = ethers.parseUnits("1000", 18); // 1000 Bella per WETH
  await diceGame.startGame(sponsorWalletAddress, initialTokenRate, deadline);

  console.log("game started!");

  await hardhat.run("verify:verify", {
    address: vaultAddress,
    constructorArguments: [AirnodeRrpV0Address],
  });
  await sleep(5000);

  await hardhat.run("verify:verify", {
    address: diceGameAddress,
    constructorArguments: [
      WETH_ADDRESS,
      vaultAddress,
      UNDERLYING_POSITION_MANAGER_ADDRESS,
      UNISWAP_V3_FACTORY,
      AirnodeRrpV0Address,
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
