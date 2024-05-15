import hardhat, { ethers } from "hardhat";
import { deriveSponsorWalletAddress } from "@api3/airnode-admin";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hardhat.network.name;

  console.log(`[${network}] deployer address: ${deployer.address}`);

  let AirnodeRrpV0Address = "";
  let WAGMI_ADDRESS = "";
  let UNDERLYING_POSITION_MANAGER_ADDRESS = "";
  let UNISWAP_V3_FACTORY = "";
  let SEND_VALUE;
  let QRNG_OPERATOR_ADDRESS = "";

  if (network === "metis") {
    //https://docs.api3.org/reference/qrng/chains.html#anu
    AirnodeRrpV0Address = "0xC02Ea0f403d5f3D45a4F1d0d817e7A2601346c9E";
    // wagmi
    UNDERLYING_POSITION_MANAGER_ADDRESS = "0xA7E119Cf6c8f5Be29Ca82611752463f0fFcb1B02";
    UNISWAP_V3_FACTORY = "0x8112E18a34b63964388a3B2984037d6a2EFE5B8A";
    WAGMI_ADDRESS = "0xaf20f5f19698f1D19351028cd7103B63D30DE7d7"; //WAGMI
    SEND_VALUE = ethers.parseEther("0.2");
    QRNG_OPERATOR_ADDRESS = "0x73e68EF04F2eddCeF36f47C2F2a86a4Dd711a9c2";
  }

  const BellaDiceGameFactory = await ethers.getContractFactory("BellaDiceGame");
  const diceGame = await BellaDiceGameFactory.deploy(
    QRNG_OPERATOR_ADDRESS,
    WAGMI_ADDRESS,
    UNDERLYING_POSITION_MANAGER_ADDRESS,
    UNISWAP_V3_FACTORY,
    AirnodeRrpV0Address
  );
  await diceGame.waitForDeployment();
  const diceGameAddress = await diceGame.getAddress();

  console.log(`BellaDiceGame  deployed to ${diceGameAddress}`);

  await sleep(30000);

  const quintessenceXpub =
    "xpub6CyZcaXvbnbqGfqqZWvWNUbGvdd5PAJRrBeAhy9rz1bbnFmpVLg2wPj1h6TyndFrWLUG3kHWBYpwacgCTGWAHFTbUrXEg6LdLxoEBny2YDz";

  const quintessenceAirnodeAddress = "0x224e030f03Cd3440D88BD78C9BF5Ed36458A1A25";

  const sponsorWalletAddress = deriveSponsorWalletAddress(
    quintessenceXpub,
    quintessenceAirnodeAddress,
    diceGameAddress // used as the sponsor
  );

  console.log(`sponsorWalletAddress ${sponsorWalletAddress}`);

  await sleep(10000);

  const latestBlock = (await hardhat.network.provider.send("eth_getBlockByNumber", ["latest", false])) as {
    timestamp: string;
  };
  const deadline = parseInt(latestBlock.timestamp, 16) + 120;
  await sleep(1000);
  console.log("starting game...", deadline);
  const initialTokenRate = ethers.parseUnits("1000", 18); // 1000 Bella per Wagmi
  await diceGame.startGame(sponsorWalletAddress, initialTokenRate, deadline, { value: SEND_VALUE });

  console.log("game started!");

  await sleep(30000);

  await hardhat.run("verify:verify", {
    address: diceGameAddress,
    constructorArguments: [
      QRNG_OPERATOR_ADDRESS,
      WAGMI_ADDRESS,
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
