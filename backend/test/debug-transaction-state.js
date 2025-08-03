/**
 * Debug Transaction State
 * Check the state of specific transactions to understand why confirmations fail
 */

const { ethers } = require("ethers");
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  rpcUrl: 'http://127.0.0.1:8545',
  deploymentFile: path.join(__dirname, '../../deployment-local.json'),
};

async function debugTransactionState() {
  console.log('🔍 Debug Transaction State');
  console.log('=' .repeat(40));
  
  try {
    // Load deployment info
    const deploymentInfo = JSON.parse(fs.readFileSync(CONFIG.deploymentFile, 'utf8'));
    
    // Create provider and signers
    const provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
    const owner1 = new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', provider);
    const owner2 = new ethers.Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', provider);
    
    // Load contract
    const MultiSigWalletArtifact = require('../../artifacts/contracts/MultiSigWallet.sol/MultiSigWallet.json');
    const wallet = new ethers.Contract(
      deploymentInfo.contracts.MultiSigWallet,
      MultiSigWalletArtifact.abi,
      provider
    );
    
    console.log(`Wallet address: ${await wallet.getAddress()}`);
    console.log(`Owner 1: ${await owner1.getAddress()}`);
    console.log(`Owner 2: ${await owner2.getAddress()}`);
    
    // Check current state
    const owners = await wallet.getOwners();
    const required = await wallet.required();
    const transactionCount = await wallet.transactionCount();
    
    console.log('\n📊 Current Wallet State:');
    console.log(`Owners: ${owners}`);
    console.log(`Required confirmations: ${required}`);
    console.log(`Transaction count: ${transactionCount}`);
    
    // Check specific transactions (look at the most recent ones)
    console.log('\n🔍 Recent Transactions:');
    const startTx = Math.max(0, Number(transactionCount) - 5);
    
    for (let i = startTx; i < transactionCount; i++) {
      try {
        const tx = await wallet.transactions(i);
        const confirmationCount = await wallet.getConfirmationCount(i);
        
        console.log(`\nTransaction ${i}:`);
        console.log(`  Destination: ${tx.destination}`);
        console.log(`  Value: ${ethers.formatEther(tx.value)} ETH`);
        console.log(`  Data: ${tx.data}`);
        console.log(`  Executed: ${tx.executed}`);
        console.log(`  Confirmations: ${confirmationCount}/${required}`);
        
        // Check who has confirmed
        const confirmers = [];
        for (const owner of owners) {
          const hasConfirmed = await wallet.confirmations(i, owner);
          if (hasConfirmed) {
            confirmers.push(owner);
          }
        }
        console.log(`  Confirmed by: ${confirmers}`);
        
        // Check if owner2 can confirm this transaction
        try {
          // This will fail but tell us why
          await wallet.connect(owner2).confirmTransaction.staticCall(i);
          console.log(`  ✅ Owner2 can confirm transaction ${i}`);
        } catch (error) {
          console.log(`  ❌ Owner2 cannot confirm transaction ${i}: ${error.reason || error.message}`);
        }
        
      } catch (error) {
        console.log(`Transaction ${i}: Error reading - ${error.message}`);
      }
    }
    
    // Test creating a simple transaction to see if the wallet is working
    console.log('\n🧪 Testing simple transaction submission:');
    try {
      const testTx = await wallet.connect(owner1).submitTransaction.staticCall(
        await owner1.getAddress(), // Send to owner1
        ethers.parseEther("0.01"),
        "0x"
      );
      console.log(`✅ Can submit simple transaction, would get ID: ${testTx}`);
    } catch (error) {
      console.log(`❌ Cannot submit simple transaction: ${error.reason || error.message}`);
    }
    
    // Test confirming a non-existent transaction
    console.log('\n🧪 Testing confirmation of non-existent transaction:');
    try {
      await wallet.connect(owner2).confirmTransaction.staticCall(999);
      console.log(`✅ No error confirming non-existent transaction`);
    } catch (error) {
      console.log(`❌ Error confirming non-existent transaction: ${error.reason || error.message}`);
    }
    
  } catch (error) {
    console.error('\n💥 Debug failed:', error);
  }
}

// Run the debug
debugTransactionState().catch(console.error);