/**
 * Test Owner Removal with Fixed Database Issue
 * This test adds an owner first, then removes them to test the fixed database constraint
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
  delayBetweenActions: 3000, // Longer delay to ensure processing
};

async function testOwnerRemovalFixed() {
  console.log('🧪 Test Owner Removal with Fixed Database Issue');
  console.log('=' .repeat(50));
  
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
    
    console.log(`Testing with wallet: ${await wallet.getAddress()}`);
    
    // Step 1: Check current state
    let owners = await wallet.getOwners();
    let required = await wallet.required();
    console.log(`Current owners (${owners.length}): ${owners}`);
    console.log(`Required confirmations: ${required}`);
    
    // Step 2: Add a temporary owner to remove
    const tempOwner = ethers.Wallet.createRandom();
    console.log(`\n➕ Adding temporary owner: ${tempOwner.address}`);
    
    const addOwnerData = wallet.interface.encodeFunctionData("addOwner", [tempOwner.address]);
    const addTx = await wallet.connect(owner1).submitTransaction(
      await wallet.getAddress(),
      0,
      addOwnerData
    );
    const addReceipt = await addTx.wait();
    
    // Get add transaction ID
    const addSubmissionEvent = addReceipt.logs.find(log => 
      log.topics[0] === wallet.interface.getEvent('Submission').topicHash
    );
    const addParsedLog = wallet.interface.parseLog(addSubmissionEvent);
    const addTxId = addParsedLog.args.transactionId;
    
    console.log(`   Add transaction submitted with ID: ${addTxId}`);
    console.log(`   Transaction hash: ${addTx.hash}`);
    
    // Wait and confirm if needed
    await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenActions));
    
    // Check if we need to confirm (if required > 1)
    if (required > 1) {
      console.log(`   Confirming addition transaction...`);
      const confirmAddTx = await wallet.connect(owner2).confirmTransaction(addTxId);
      await confirmAddTx.wait();
      console.log(`   Addition confirmed: ${confirmAddTx.hash}`);
    }
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenActions));
    
    // Verify owner was added
    owners = await wallet.getOwners();
    console.log(`   Updated owners (${owners.length}): ${owners}`);
    
    if (!owners.includes(tempOwner.address)) {
      throw new Error('Temporary owner was not added successfully');
    }
    
    // Step 3: Now remove the temporary owner
    console.log(`\n🗑️  Removing temporary owner: ${tempOwner.address}`);
    
    const removeOwnerData = wallet.interface.encodeFunctionData("removeOwner", [tempOwner.address]);
    const removeTx = await wallet.connect(owner1).submitTransaction(
      await wallet.getAddress(),
      0,
      removeOwnerData
    );
    const removeReceipt = await removeTx.wait();
    
    // Get remove transaction ID
    const removeSubmissionEvent = removeReceipt.logs.find(log => 
      log.topics[0] === wallet.interface.getEvent('Submission').topicHash
    );
    const removeParsedLog = wallet.interface.parseLog(removeSubmissionEvent);
    const removeTxId = removeParsedLog.args.transactionId;
    
    console.log(`   Remove transaction submitted with ID: ${removeTxId}`);
    console.log(`   Transaction hash: ${removeTx.hash}`);
    
    // Wait for validator service to process submission
    await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenActions));
    
    // Confirm if needed
    if (required > 1) {
      console.log(`   Confirming removal transaction...`);
      const confirmRemoveTx = await wallet.connect(owner2).confirmTransaction(removeTxId);
      const confirmRemoveReceipt = await confirmRemoveTx.wait();
      console.log(`   Removal confirmed: ${confirmRemoveTx.hash}`);
      
      // Check for OwnerRemoval event
      const ownerRemovalEvent = confirmRemoveReceipt.logs.find(log => 
        log.topics[0] === wallet.interface.getEvent('OwnerRemoval').topicHash
      );
      
      if (ownerRemovalEvent) {
        const parsedEvent = wallet.interface.parseLog(ownerRemovalEvent);
        console.log(`   ✅ OwnerRemoval event emitted for: ${parsedEvent.args.owner}`);
      }
    }
    
    // Wait for validator service to process the removal
    console.log(`\n⏳ Waiting for validator service to process owner removal...`);
    await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenActions * 2));
    
    // Step 4: Verify final state
    const finalOwners = await wallet.getOwners();
    console.log(`\n📊 Final owners (${finalOwners.length}): ${finalOwners}`);
    console.log(`Owner successfully removed: ${!finalOwners.includes(tempOwner.address)}`);
    
    // Step 5: Check validator service state
    console.log(`\n📡 Checking validator service state...`);
    try {
      const response = await axios.get(`${CONFIG.validatorApiUrl}/api/wallets`, {
        params: { network: 'localhost' }
      });
      
      const walletAddress = await wallet.getAddress();
      const validatorWallet = response.data.data.wallets.find(w => 
        w.address.toLowerCase() === walletAddress.toLowerCase()
      );
      
      if (validatorWallet) {
        console.log(`Validator service owners: ${validatorWallet.owners}`);
        console.log(`Owners match blockchain: ${JSON.stringify(validatorWallet.owners.sort()) === JSON.stringify(finalOwners.sort())}`);
      } else {
        console.log(`❌ Wallet not found in validator service`);
      }
      
    } catch (error) {
      console.error(`❌ Failed to query validator service: ${error.message}`);
    }
    
    console.log(`\n🎉 Owner removal test completed!`);
    
  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    if (error.reason) {
      console.error('Reason:', error.reason);
    }
  }
}

// Run the test
testOwnerRemovalFixed().catch(console.error);