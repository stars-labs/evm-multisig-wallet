const hre = require("hardhat");

async function main() {
  console.log("Deploying MultiSig Wallet contracts...");
  
  // Configuration - MODIFY THESE VALUES
  const owners = [
    "0xF9B9d028818496894267eBD3B3eA3c537d24f9B5", // RE1a
    "0x855c9E5aC7431df8524F964ab3A0F4805469049f", // RE2
    "0x4eA8869eF1a9Bf454172BBAec3586AdcAFCE86d9"  // RE3
  ];
  
  const requiredConfirmations = 2; // 2 out of 3 signatures required
  const dailyLimitWei = hre.ethers.parseEther("1.0"); // 1 ETH daily limit
  
  // Validate inputs
  if (owners.some(addr => !hre.ethers.isAddress(addr))) {
    throw new Error("Invalid owner addresses detected. Please update the addresses in deploy.js");
  }
  
  if (requiredConfirmations > owners.length || requiredConfirmations === 0) {
    throw new Error("Invalid required confirmations");
  }
  
  console.log(`Owners: ${owners.join(", ")}`);
  console.log(`Required confirmations: ${requiredConfirmations}`);
  console.log(`Daily limit: ${hre.ethers.formatEther(dailyLimitWei)} ETH`);
  
  // Deploy Factory
  console.log("\nDeploying Factory...");
  const Factory = await hre.ethers.getContractFactory("Factory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`Factory deployed to: ${factoryAddress}`);
  
  // Deploy MultiSigWallet
  console.log("\nDeploying MultiSigWallet...");
  const MultiSigWallet = await hre.ethers.getContractFactory("MultiSigWallet");
  const multiSigWallet = await MultiSigWallet.deploy(owners, requiredConfirmations);
  await multiSigWallet.waitForDeployment();
  const multiSigWalletAddress = await multiSigWallet.getAddress();
  console.log(`MultiSigWallet deployed to: ${multiSigWalletAddress}`);
  
  // Deploy MultiSigWalletWithDailyLimit
  console.log("\nDeploying MultiSigWalletWithDailyLimit...");
  const MultiSigWalletWithDailyLimit = await hre.ethers.getContractFactory("MultiSigWalletWithDailyLimit");
  const multiSigWalletWithLimit = await MultiSigWalletWithDailyLimit.deploy(
    owners, 
    requiredConfirmations, 
    dailyLimitWei
  );
  await multiSigWalletWithLimit.waitForDeployment();
  const multiSigWalletWithLimitAddress = await multiSigWalletWithLimit.getAddress();
  console.log(`MultiSigWalletWithDailyLimit deployed to: ${multiSigWalletWithLimitAddress}`);
  
  // Verify deployment
  console.log("\n=== Deployment Summary ===");
  console.log(`Factory: ${factoryAddress}`);
  console.log(`MultiSigWallet: ${multiSigWalletAddress}`); 
  console.log(`MultiSigWalletWithDailyLimit: ${multiSigWalletWithLimitAddress}`);
  
  // Save deployment info
  const deploymentInfo = {
    network: hre.network.name,
    timestamp: new Date().toISOString(),
    contracts: {
      Factory: factoryAddress,
      MultiSigWallet: multiSigWalletAddress,
      MultiSigWalletWithDailyLimit: multiSigWalletWithLimitAddress
    },
    configuration: {
      owners,
      requiredConfirmations,
      dailyLimitEth: hre.ethers.formatEther(dailyLimitWei)
    }
  };
  
  console.log("\n=== Next Steps ===");
  console.log("1. Copy the contract addresses above");
  console.log("2. Add the contracts to your wallet (MetaMask, etc.)");
  console.log("3. Send test ETH to the MultiSigWallet address");
  console.log("4. Test creating and confirming transactions");
  console.log(`5. Verify contracts on Etherscan: npx hardhat verify --network ${hre.network.name} <address>`);
  
  return deploymentInfo;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });