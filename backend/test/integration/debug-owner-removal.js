/**
 * Debug Owner Removal Test
 * Tests only the owner removal scenario to isolate database issues
 */

const { ethers } = require("ethers");
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuration
const CONFIG = {
  rpcUrl: 'http://127.0.0.1:8545',
  validatorApiUrl: 'http://localhost:3001',
  deploymentFile: path.join(__dirname, '../../deployment-local.json'),
  delayBetweenActions: 2000,
};

async function debugOwnerRemoval() {
  console.log('🔍 Debug Owner Removal Test');
  console.log('=' .repeat(40));
  
  try {
    // Load deployment info
    const deploymentInfo = JSON.parse(fs.readFileSync(CONFIG.deploymentFile, 'utf8'));
    console.log('📋 Deployment info loaded');
    console.log(`MultiSigWallet: ${deploymentInfo.contracts.MultiSigWallet}`);
    
    // Create provider and signers (using correct Hardhat account private keys)
    const provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
    const owner1 = new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', provider); // Account 1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
    const owner2 = new ethers.Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', provider); // Account 2: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
    
    console.log(`Owner 1: ${await owner1.getAddress()}`);
    console.log(`Owner 2: ${await owner2.getAddress()}`);
    
    // Load contract
    const MultiSigWalletArtifact = require('../../artifacts/contracts/MultiSigWallet.sol/MultiSigWallet.json');
    const wallet = new ethers.Contract(
      deploymentInfo.contracts.MultiSigWallet,
      MultiSigWalletArtifact.abi,
      provider
    );
    
    console.log(`Wallet address: ${await wallet.getAddress()}`);
    
    // Step 1: Check current owners
    console.log('\n📋 Current wallet state:');
    const currentOwners = await wallet.getOwners();
    const currentRequired = await wallet.required();
    console.log(`Owners (${currentOwners.length}):`, currentOwners);
    console.log(`Required confirmations: ${currentRequired}`);
    
    if (currentOwners.length <= 2) {
      console.log('⚠️  Need to add an owner first before testing removal');
      
      // Add a temporary owner first
      const tempOwner = ethers.Wallet.createRandom();
      console.log(`\n➕ Adding temporary owner: ${tempOwner.address}`);
      
      const addOwnerData = wallet.interface.encodeFunctionData("addOwner", [tempOwner.address]);
      
      const addTx = await wallet.connect(owner1).submitTransaction(
        await wallet.getAddress(),
        0,
        addOwnerData
      );
      await addTx.wait();
      console.log(`   Add owner transaction submitted: ${addTx.hash}`);
      
      // Get transaction ID from logs
      const receipt = await addTx.wait();
      const submissionEvent = receipt.logs.find(log => 
        log.topics[0] === wallet.interface.getEvent('Submission').topicHash
      );
      const parsedLog = wallet.interface.parseLog(submissionEvent);
      const addTxId = parsedLog.args.transactionId;
      console.log(`   Transaction ID: ${addTxId}`);
      
      await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenActions));
      
      // Confirm to execute
      const confirmTx = await wallet.connect(owner2).confirmTransaction(addTxId);
      await confirmTx.wait();
      console.log(`   Owner addition confirmed and executed: ${confirmTx.hash}`);
      
      // Wait for event processing
      await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenActions));
      
      // Check updated owners
      const updatedOwners = await wallet.getOwners();
      console.log(`   Updated owners (${updatedOwners.length}):`, updatedOwners);
    }
    
    // Step 2: Test owner removal
    console.log('\n🗑️  Testing owner removal:');
    const ownersToRemove = await wallet.getOwners();
    const targetOwner = ownersToRemove[ownersToRemove.length - 1]; // Remove last owner
    console.log(`Target owner to remove: ${targetOwner}`);
    
    // Encode removeOwner function call
    const removeOwnerData = wallet.interface.encodeFunctionData("removeOwner", [targetOwner]);
    
    // Submit removal transaction
    console.log('📤 Submitting owner removal transaction...');
    const submitTx = await wallet.connect(owner1).submitTransaction(
      await wallet.getAddress(),
      0,
      removeOwnerData
    );
    
    const submitReceipt = await submitTx.wait();
    console.log(`   Submission tx hash: ${submitTx.hash}`);
    console.log(`   Block number: ${submitReceipt.blockNumber}`);
    
    // Get transaction ID
    const submissionEvent = submitReceipt.logs.find(log => 
      log.topics[0] === wallet.interface.getEvent('Submission').topicHash
    );
    
    if (!submissionEvent) {
      throw new Error('No Submission event found');
    }
    
    const parsedLog = wallet.interface.parseLog(submissionEvent);
    const txId = parsedLog.args.transactionId;
    console.log(`   Transaction ID: ${txId}`);
    
    // Wait for validator service to process
    console.log('⏳ Waiting for validator service to process submission...');
    await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenActions));
    
    // Check validator service logs
    try {
      const response = await axios.get(`${CONFIG.validatorApiUrl}/health`);
      console.log('✅ Validator service is responding');
    } catch (error) {
      console.error('❌ Validator service not responding:', error.message);
    }
    
    // Step 3: Confirm the transaction
    console.log('\n✅ Confirming removal transaction...');
    const confirmTx = await wallet.connect(owner2).confirmTransaction(txId);
    const confirmReceipt = await confirmTx.wait();
    console.log(`   Confirmation tx hash: ${confirmTx.hash}`);
    console.log(`   Block number: ${confirmReceipt.blockNumber}`);
    
    // Check for OwnerRemoval event
    const ownerRemovalEvent = confirmReceipt.logs.find(log => 
      log.topics[0] === wallet.interface.getEvent('OwnerRemoval').topicHash
    );
    
    if (ownerRemovalEvent) {
      const parsedEvent = wallet.interface.parseLog(ownerRemovalEvent);
      console.log(`   ✅ OwnerRemoval event emitted for: ${parsedEvent.args.owner}`);
    } else {
      console.log('   ⚠️  No OwnerRemoval event found');
    }
    
    // Wait for validator service to process
    console.log('⏳ Waiting for validator service to process removal...');
    await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenActions * 2));
    
    // Step 4: Verify final state
    console.log('\n📊 Final wallet state:');
    const finalOwners = await wallet.getOwners();
    const finalRequired = await wallet.required();
    console.log(`Final owners (${finalOwners.length}):`, finalOwners);
    console.log(`Final required confirmations: ${finalRequired}`);
    console.log(`Owner successfully removed: ${!finalOwners.includes(targetOwner)}`);
    
    // Check if we can query the validator service for wallet info
    try {
      const walletResponse = await axios.get(`${CONFIG.validatorApiUrl}/api/wallets`, {
        params: { network: 'localhost' }
      });
      console.log('\n📡 Validator service wallet data:');
      console.log(`Response type: ${typeof walletResponse.data}`);
      console.log(`Response data:`, walletResponse.data);
    } catch (error) {
      console.error('❌ Failed to query validator service:', error.response?.data || error.message);
    }
    
    console.log('\n🎉 Owner removal test completed successfully!');
    
  } catch (error) {
    console.error('\n💥 Test failed:', error);
    if (error.reason) {
      console.error('Reason:', error.reason);
    }
    if (error.transaction) {
      console.error('Transaction data:', error.transaction);
    }
  }
}

// Run the test
debugOwnerRemoval().catch(console.error);