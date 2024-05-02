import hardhat, { ethers } from "hardhat";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hardhat.network.name;

  console.log(`[${network}] deployer address: ${deployer.address}`);

  const bella = await ethers.getContractAt("BellaToken", "0x9bedfe60F093f8889C27B70640dD9CAD7F53EB6c");
  const isTimeToPump = await bella.isTimeToPump();
  console.log("isTimeToPump", isTimeToPump);
  await sleep(1000);
  const pumpEnabled = await bella.pumpEnabled();
  console.log("pumpEnabled", pumpEnabled);
  await sleep(1000);
  if (pumpEnabled) {
    await bella.pump();
  } else if (isTimeToPump) {
    await bella.tryToEnablePump({ value: ethers.parseEther("0.003") });
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
