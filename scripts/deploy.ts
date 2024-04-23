import hardhat, { ethers } from "hardhat";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hardhat.network.name;

  console.log(`[${network}] deployer address: ${deployer.address}`);

  let LinkTokenAddress = "";
  let VRFWrapper = "";
  let WETH_ADDRESS = "";
  let UNDERLYING_POSITION_MANAGER_ADDRESS = "";
  let UNISWAP_V3_FACTORY = "";

  if (network === "ethereum") {
    LinkTokenAddress = "0x514910771AF9Ca656af840dff83E8264EcF986CA";
    VRFWrapper = "0x5A861794B927983406fCE1D062e00b9368d97Df6";
    WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    UNDERLYING_POSITION_MANAGER_ADDRESS = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
    UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
  }

  const BellaLiquidityVaultFactory = await ethers.getContractFactory("BellaLiquidityVault");
  const vault = await BellaLiquidityVaultFactory.deploy(LinkTokenAddress, VRFWrapper);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();

  await sleep(5000);

  console.log(`BellaLiquidityVault  deployed to ${vaultAddress}`);

  const BellaDiceGameFactory = await ethers.getContractFactory("BellaDiceGame");
  const diceGame = await BellaDiceGameFactory.deploy(
    LinkTokenAddress,
    VRFWrapper,
    WETH_ADDRESS,
    vaultAddress,
    UNDERLYING_POSITION_MANAGER_ADDRESS,
    UNISWAP_V3_FACTORY
  );
  await diceGame.waitForDeployment();
  const diceGameAddress = await diceGame.getAddress();

  console.log(`BellaDiceGame  deployed to ${diceGameAddress}`);

  await sleep(5000);
  await vault.transferOwnership(diceGameAddress);
  console.log("Ownership of BellaLiquidityVault transferred to BellaDiceGame");

  await sleep(30000);

  await hardhat.run("verify:verify", {
    address: vaultAddress,
    constructorArguments: [LinkTokenAddress, VRFWrapper],
  });
  await sleep(5000);

  await hardhat.run("verify:verify", {
    address: diceGameAddress,
    constructorArguments: [
      LinkTokenAddress,
      VRFWrapper,
      WETH_ADDRESS,
      vaultAddress,
      UNDERLYING_POSITION_MANAGER_ADDRESS,
      UNISWAP_V3_FACTORY,
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
