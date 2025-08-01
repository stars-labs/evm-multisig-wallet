const { ethers } = require("hardhat");
const fs = require('fs');

async function checkWalletState() {
  try {
    // Load deployment info
    const deploymentInfo = JSON.parse(fs.readFileSync('./deployment-local.json', 'utf8'));
    
    // Get contract instance
    const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
    const wallet = MultiSigWallet.attach(deploymentInfo.contracts.MultiSigWallet);
    
    console.log('🔍 Checking MultiSig Wallet State');
    console.log('=' .repeat(50));
    
    // Get basic info
    const required = await wallet.required();
    const owners = await wallet.getOwners();
    const balance = await ethers.provider.getBalance(await wallet.getAddress());
    
    console.log(`Contract Address: ${await wallet.getAddress()}`);
    console.log(`Required Confirmations: ${required}`);
    console.log(`Number of Owners: ${owners.length}`);
    console.log(`Owners: ${owners.join(', ')}`);
    console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
    
    // Check latest transaction
    console.log('\n📋 Checking Recent Transactions:');
    try {
      // Try to get transaction count
      const txCount = await wallet.transactionCount();
      console.log(`Total transactions: ${txCount}`);
      
      if (txCount > 0) {
        // Check last few transactions
        const start = Math.max(0, txCount - 5);
        for (let i = start; i < txCount; i++) {
          const tx = await wallet.transactions(i);
          console.log(`\nTransaction ${i}:`);
          console.log(`  To: ${tx.destination}`);
          console.log(`  Value: ${ethers.formatEther(tx.value)} ETH`);
          console.log(`  Executed: ${tx.executed}`);
          
          // Get confirmation count
          const confirmCount = await wallet.getConfirmationCount(i);
          console.log(`  Confirmations: ${confirmCount}/${required}`);
        }
      }
    } catch (error) {
      console.log('Could not retrieve transaction details:', error.message);
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkWalletState();