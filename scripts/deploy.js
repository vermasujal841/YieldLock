const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying YieldLock contract to Core Blockchain...");

  // Get the contract factory
  const YieldLock = await ethers.getContractFactory("YieldLock");

  // Deploy parameters
  const stakingTokenAddress = "0x0000000000000000000000000000000000000000"; // Replace with actual token address
  const rewardTokenAddress = "0x0000000000000000000000000000000000000000"; // Replace with actual token address

  // Deploy the contract
  const yieldLock = await YieldLock.deploy(
    stakingTokenAddress,
    rewardTokenAddress
  );

  // Wait for deployment to complete
  await yieldLock.deployed();

  console.log("YieldLock deployed to:", yieldLock.address);
  console.log("Transaction hash:", yieldLock.deployTransaction.hash);

  // Verify deployment
  console.log("Verifying deployment...");
  const code = await ethers.provider.getCode(yieldLock.address);
  if (code === "0x") {
    console.log("❌ Contract deployment failed!");
  } else {
    console.log("✅ Contract deployed successfully!");
    console.log("Contract address:", yieldLock.address);
    console.log("Network: Core Testnet");
    console.log("Block number:", yieldLock.deployTransaction.blockNumber);

    // Display initial contract state
    const poolCounter = await yieldLock.poolCounter();
    console.log("Initial pool counter:", poolCounter.toString());
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
