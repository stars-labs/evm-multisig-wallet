// Deploy multisig contracts to local Hardhat network
const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying MultiSig contracts to local network...");
  
  // Get signers (accounts from local network)
  const [deployer, owner1, owner2, owner3, ...others] = await hre.ethers.getSigners();
  
  console.log("📋 Deployment details:");
  console.log("Network:", hre.network.name);
  console.log("Chain ID:", (await hre.ethers.provider.getNetwork()).chainId);
  console.log("Deployer:", await deployer.getAddress());
  console.log("Owner 1:", await owner1.getAddress());
  console.log("Owner 2:", await owner2.getAddress());
  console.log("Owner 3:", await owner3.getAddress());
  
  // 1. Deploy Factory
  console.log("\n📦 Deploying Factory...");
  const Factory = await hre.ethers.getContractFactory("Factory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  
  const factoryAddress = await factory.getAddress();
  console.log("✅ Factory deployed to:", factoryAddress);
  
  // 2. Deploy basic MultiSigWallet
  console.log("\n📦 Deploying MultiSigWallet...");
  const MultiSigWallet = await hre.ethers.getContractFactory("MultiSigWallet");
  
  const owners = [
    await owner1.getAddress(),
    await owner2.getAddress(), 
    await owner3.getAddress()
  ];
  const required = 2; // Require 2 out of 3 signatures
  
  const multiSigWallet = await MultiSigWallet.deploy(owners, required);
  await multiSigWallet.waitForDeployment();
  
  const multiSigAddress = await multiSigWallet.getAddress();
  console.log("✅ MultiSigWallet deployed to:", multiSigAddress);
  
  // 3. Deploy MultiSigWalletWithDailyLimit
  console.log("\n📦 Deploying MultiSigWalletWithDailyLimit...");
  const MultiSigWalletWithDailyLimit = await hre.ethers.getContractFactory("MultiSigWalletWithDailyLimit");
  
  const dailyLimit = hre.ethers.parseEther("1.0"); // 1 ETH daily limit
  const multiSigWalletWithLimit = await MultiSigWalletWithDailyLimit.deploy(owners, required, dailyLimit);
  await multiSigWalletWithLimit.waitForDeployment();
  
  const multiSigWithLimitAddress = await multiSigWalletWithLimit.getAddress();
  console.log("✅ MultiSigWalletWithDailyLimit deployed to:", multiSigWithLimitAddress);
  
  // Fund the wallets with some ETH for testing
  console.log("\n💰 Funding wallets for testing...");
  
  const fundAmount = hre.ethers.parseEther("5.0"); // 5 ETH each
  
  await deployer.sendTransaction({
    to: multiSigAddress,
    value: fundAmount
  });
  console.log(`✅ Sent ${hre.ethers.formatEther(fundAmount)} ETH to MultiSigWallet`);
  
  await deployer.sendTransaction({
    to: multiSigWithLimitAddress,
    value: fundAmount
  });
  console.log(`✅ Sent ${hre.ethers.formatEther(fundAmount)} ETH to MultiSigWalletWithDailyLimit`);
  
  // Verify deployments
  console.log("\n🔍 Verifying deployments...");
  
  const wallet1Balance = await hre.ethers.provider.getBalance(multiSigAddress);
  const wallet2Balance = await hre.ethers.provider.getBalance(multiSigWithLimitAddress);
  
  console.log(`MultiSigWallet balance: ${hre.ethers.formatEther(wallet1Balance)} ETH`);
  console.log(`MultiSigWalletWithDailyLimit balance: ${hre.ethers.formatEther(wallet2Balance)} ETH`);
  
  const wallet1Owners = await multiSigWallet.getOwners();
  const wallet1Required = await multiSigWallet.required();
  
  console.log(`MultiSigWallet owners: ${wallet1Owners.length}`);
  console.log(`MultiSigWallet required: ${wallet1Required}`);
  
  // Summary
  console.log("\n🎉 Deployment Summary:");
  console.log("=".repeat(50));
  console.log(`Factory: ${factoryAddress}`);
  console.log(`MultiSigWallet: ${multiSigAddress}`);
  console.log(`MultiSigWalletWithDailyLimit: ${multiSigWithLimitAddress}`);
  console.log(`Network: localhost (chainId: ${(await hre.ethers.provider.getNetwork()).chainId})`);
  console.log(`RPC URL: http://127.0.0.1:8545`);
  console.log("=".repeat(50));
  
  // Save deployment info
  const deploymentInfo = {
    network: 'localhost',
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    rpcUrl: 'http://127.0.0.1:8545',
    contracts: {
      Factory: factoryAddress,
      MultiSigWallet: multiSigAddress,
      MultiSigWalletWithDailyLimit: multiSigWithLimitAddress
    },
    owners: owners,
    required: required,
    deployedAt: new Date().toISOString()
  };
  
  const fs = require('fs');
  fs.writeFileSync('deployment-local.json', JSON.stringify(deploymentInfo, null, 2));
  console.log("📄 Deployment info saved to deployment-local.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });