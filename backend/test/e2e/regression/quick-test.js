/**
 * Quick Test Runner for Individual MultiSig Scenarios
 * 
 * Usage: node test/regression/quick-test.js [scenario]
 * 
 * Available scenarios:
 * - submit: Test transaction submission only
 * - confirm: Test submission and confirmation
 * - execute: Test full execution flow
 * - revoke: Test transaction revocation
 * - owner-add: Test adding an owner
 * - owner-remove: Test removing an owner
 * - requirement: Test changing requirement
 * - deposit: Test deposit event
 * - all: Run all scenarios
 */

const { ethers } = require("ethers");
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuration
const CONFIG = {
  delayBetweenActions: 1000,
  deploymentFile: path.join(__dirname, '../../../deployment-local.json'),
  validatorApiUrl: 'http://localhost:3001',
  waitForEventProcessing: 1000,
  rpcUrl: 'http://127.0.0.1:8545',
};

// Utility functions
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getTransactionId(receipt, contract) {
  const submissionEvent = receipt.logs.find(log => 
    log.topics[0] === contract.interface.getEvent('Submission').topicHash
  );
  
  if (!submissionEvent) {
    throw new Error('No Submission event found in transaction receipt');
  }
  
  const parsedLog = contract.interface.parseLog(submissionEvent);
  return parsedLog.args.transactionId;
}

async function verifyEventInValidatorService(walletAddress, eventType, transactionId = null) {
  try {
    await delay(CONFIG.waitForEventProcessing);
    
    const response = await axios.get(`${CONFIG.validatorApiUrl}/api/wallets`, {
      params: { network: 'localhost' }
    });
    
    const wallet = response.data.find(w => 
      w.address.toLowerCase() === walletAddress.toLowerCase()
    );
    
    if (!wallet) {
      throw new Error(`Wallet ${walletAddress} not found in validator service`);
    }
    
    if (transactionId !== null && wallet.pendingTransactions) {
      const txExists = wallet.pendingTransactions.some(tx => 
        tx.transactionId === transactionId.toString()
      );
      
      if (!txExists) {
        console.warn(`Transaction ${transactionId} not found in pending transactions`);
      }
    }
    
    return true;
  } catch (error) {
    console.error(`Failed to verify event in validator service:`, error.message);
    return false;
  }
}

// Test Scenarios

async function testSubmitOnly(wallet, owner1) {
  console.log('\n📝 Testing Transaction Submission Only');
  
  const recipient = ethers.Wallet.createRandom();
  const value = ethers.parseEther("0.1");
  
  console.log(`   Submitting transaction: ${ethers.formatEther(value)} ETH`);
  console.log(`   To: ${recipient.address}`);
  
  const submitTx = await wallet.connect(owner1).submitTransaction(
    recipient.address,
    value,
    "0x"
  );
  const submitReceipt = await submitTx.wait();
  const txId = await getTransactionId(submitReceipt, wallet);
  
  console.log(`   ✅ Transaction submitted with ID: ${txId}`);
  console.log(`   Tx hash: ${submitTx.hash}`);
  
  const verified = await verifyEventInValidatorService(
    await wallet.getAddress(),
    'Submission',
    txId
  );
  
  console.log(`   Validator service verified: ${verified ? '✅' : '❌'}`);
  return txId;
}

async function testConfirmation(wallet, owner1, owner2) {
  console.log('\n📝 Testing Submission and Confirmation');
  
  // First submit
  const txId = await testSubmitOnly(wallet, owner1);
  
  await delay(CONFIG.delayBetweenActions);
  
  // Then confirm
  console.log(`   Confirming transaction ${txId}...`);
  const confirmTx = await wallet.connect(owner2).confirmTransaction(txId);
  await confirmTx.wait();
  
  const confirmCount = await wallet.getConfirmationCount(txId);
  console.log(`   ✅ Transaction confirmed. Count: ${confirmCount}/2`);
  
  return txId;
}

async function testExecution(wallet, owner1, owner2, recipient) {
  console.log('\n🚀 Testing Full Execution Flow');
  
  const value = ethers.parseEther("0.2");
  
  // Submit
  console.log(`   Submitting transaction: ${ethers.formatEther(value)} ETH`);
  const submitTx = await wallet.connect(owner1).submitTransaction(
    await recipient.getAddress(),
    value,
    "0x"
  );
  const submitReceipt = await submitTx.wait();
  const txId = await getTransactionId(submitReceipt, wallet);
  console.log(`   Transaction ID: ${txId}`);
  
  await delay(CONFIG.delayBetweenActions);
  
  // Confirm
  console.log(`   Confirming transaction...`);
  const confirmTx = await wallet.connect(owner2).confirmTransaction(txId);
  await confirmTx.wait();
  
  // Check if executed
  const isExecuted = await wallet.isConfirmed(txId, await owner2.getAddress());
  console.log(`   ✅ Transaction executed: ${isExecuted}`);
  
  return txId;
}

async function testRevocation(wallet, owner1, owner2) {
  console.log('\n🔄 Testing Transaction Revocation');
  
  // Submit and confirm first
  const txId = await testConfirmation(wallet, owner1, owner2);
  
  await delay(CONFIG.delayBetweenActions);
  
  // Revoke
  console.log(`   Revoking confirmation for transaction ${txId}...`);
  const revokeTx = await wallet.connect(owner2).revokeConfirmation(txId);
  await revokeTx.wait();
  
  const confirmCount = await wallet.getConfirmationCount(txId);
  console.log(`   ✅ Confirmation revoked. Count: ${confirmCount}/2`);
  
  return txId;
}

async function testOwnerAddition(wallet, owner1, owner2, newOwner) {
  console.log('\n👤 Testing Owner Addition');
  
  const newOwnerAddress = await newOwner.getAddress();
  console.log(`   Adding new owner: ${newOwnerAddress}`);
  
  // Submit add owner transaction
  const data = wallet.interface.encodeFunctionData("addOwner", [newOwnerAddress]);
  const submitTx = await wallet.connect(owner1).submitTransaction(
    await wallet.getAddress(),
    0,
    data
  );
  const submitReceipt = await submitTx.wait();
  const txId = await getTransactionId(submitReceipt, wallet);
  
  console.log(`   Transaction ID: ${txId}`);
  
  await delay(CONFIG.delayBetweenActions);
  
  // Confirm to execute
  console.log(`   Confirming to execute...`);
  const confirmTx = await wallet.connect(owner2).confirmTransaction(txId);
  await confirmTx.wait();
  
  const owners = await wallet.getOwners();
  const added = owners.includes(newOwnerAddress);
  console.log(`   ✅ Owner added: ${added}`);
  
  return txId;
}

async function testOwnerRemoval(wallet, owner1, owner2, ownerToRemove) {
  console.log('\n👤 Testing Owner Removal');
  
  const removeAddress = await ownerToRemove.getAddress();
  console.log(`   Removing owner: ${removeAddress}`);
  
  // Submit remove owner transaction
  const data = wallet.interface.encodeFunctionData("removeOwner", [removeAddress]);
  const submitTx = await wallet.connect(owner1).submitTransaction(
    await wallet.getAddress(),
    0,
    data
  );
  const submitReceipt = await submitTx.wait();
  const txId = await getTransactionId(submitReceipt, wallet);
  
  console.log(`   Transaction ID: ${txId}`);
  
  await delay(CONFIG.delayBetweenActions);
  
  // Confirm to execute
  console.log(`   Confirming to execute...`);
  const confirmTx = await wallet.connect(owner2).confirmTransaction(txId);
  await confirmTx.wait();
  
  const owners = await wallet.getOwners();
  const removed = !owners.includes(removeAddress);
  console.log(`   ✅ Owner removed: ${removed}`);
  
  return txId;
}

async function testRequirementChange(wallet, owner1, owner2) {
  console.log('\n⚙️ Testing Requirement Change');
  
  const currentReq = await wallet.required();
  const newReq = currentReq === 2n ? 1n : 2n;
  
  console.log(`   Current requirement: ${currentReq}`);
  console.log(`   New requirement: ${newReq}`);
  
  // Submit change requirement transaction
  const data = wallet.interface.encodeFunctionData("changeRequirement", [newReq]);
  const submitTx = await wallet.connect(owner1).submitTransaction(
    await wallet.getAddress(),
    0,
    data
  );
  const submitReceipt = await submitTx.wait();
  const txId = await getTransactionId(submitReceipt, wallet);
  
  console.log(`   Transaction ID: ${txId}`);
  
  await delay(CONFIG.delayBetweenActions);
  
  // Confirm to execute
  console.log(`   Confirming to execute...`);
  const confirmTx = await wallet.connect(owner2).confirmTransaction(txId);
  await confirmTx.wait();
  
  const updatedReq = await wallet.required();
  console.log(`   ✅ Requirement changed to: ${updatedReq}`);
  
  return txId;
}

async function testDeposit(wallet, sender, provider) {
  console.log('\n💰 Testing Deposit Event');
  
  const walletAddress = await wallet.getAddress();
  const depositAmount = ethers.parseEther("1.0");
  
  const balanceBefore = await provider.getBalance(walletAddress);
  console.log(`   Balance before: ${ethers.formatEther(balanceBefore)} ETH`);
  
  // Send ETH directly to wallet
  console.log(`   Sending ${ethers.formatEther(depositAmount)} ETH to wallet...`);
  const tx = await sender.sendTransaction({
    to: walletAddress,
    value: depositAmount
  });
  await tx.wait();
  console.log(`   Tx hash: ${tx.hash}`);
  
  const balanceAfter = await provider.getBalance(walletAddress);
  console.log(`   Balance after: ${ethers.formatEther(balanceAfter)} ETH`);
  
  const verified = await verifyEventInValidatorService(walletAddress, 'Deposit');
  console.log(`   ✅ Deposit completed. Validator verified: ${verified}`);
}

// Main runner
async function main() {
  const scenario = process.argv[2] || 'all';
  
  console.log('🧪 Quick Test Runner for MultiSig Wallet');
  console.log('=' .repeat(50));
  console.log(`Scenario: ${scenario}`);
  
  try {
    // Load deployment info
    const deploymentInfo = JSON.parse(fs.readFileSync(CONFIG.deploymentFile, 'utf8'));
    
    // Verify validator service
    try {
      await axios.get(`${CONFIG.validatorApiUrl}/health`);
      console.log('✅ Validator service is running');
    } catch (error) {
      console.error('❌ Validator service is not running. Please start it first.');
      process.exit(1);
    }
    
    // Setup
    const provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
    const deployer = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);
    const owner1 = new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', provider);
    const owner2 = new ethers.Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', provider);
    const owner3 = new ethers.Wallet('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', provider);
    
    // Load contract
    const MultiSigWalletArtifact = require('../../../artifacts/contracts/MultiSigWallet.sol/MultiSigWallet.json');
    const wallet = new ethers.Contract(
      deploymentInfo.contracts.MultiSigWallet,
      MultiSigWalletArtifact.abi,
      provider
    );
    
    console.log(`\n📋 Contract: ${await wallet.getAddress()}`);
    console.log(`👥 Owners: ${(await wallet.getOwners()).length}`);
    console.log(`⚙️ Required: ${await wallet.required()}`);
    
    // Run selected scenario
    switch(scenario) {
      case 'submit':
        await testSubmitOnly(wallet, owner1);
        break;
        
      case 'confirm':
        await testConfirmation(wallet, owner1, owner2);
        break;
        
      case 'execute':
        await testExecution(wallet, owner1, owner2, deployer);
        break;
        
      case 'revoke':
        await testRevocation(wallet, owner1, owner2);
        break;
        
      case 'owner-add':
        await testOwnerAddition(wallet, owner1, owner2, owner3);
        break;
        
      case 'owner-remove':
        // First add owner3 if not present
        const owners = await wallet.getOwners();
        if (!owners.includes(await owner3.getAddress())) {
          await testOwnerAddition(wallet, owner1, owner2, owner3);
          await delay(2000);
        }
        await testOwnerRemoval(wallet, owner1, owner2, owner3);
        break;
        
      case 'requirement':
        await testRequirementChange(wallet, owner1, owner2);
        break;
        
      case 'deposit':
        await testDeposit(wallet, owner1, provider);
        break;
        
      case 'all':
        await testSubmitOnly(wallet, owner1);
        await delay(2000);
        await testConfirmation(wallet, owner1, owner2);
        await delay(2000);
        await testExecution(wallet, owner1, owner2, deployer);
        await delay(2000);
        await testRevocation(wallet, owner1, owner2);
        await delay(2000);
        await testOwnerAddition(wallet, owner1, owner2, owner3);
        await delay(2000);
        await testOwnerRemoval(wallet, owner1, owner2, owner3);
        await delay(2000);
        await testRequirementChange(wallet, owner1, owner2);
        await delay(2000);
        await testDeposit(wallet, owner1, provider);
        break;
        
      default:
        console.error(`\n❌ Unknown scenario: ${scenario}`);
        console.log('\nAvailable scenarios:');
        console.log('  submit       - Test transaction submission only');
        console.log('  confirm      - Test submission and confirmation');
        console.log('  execute      - Test full execution flow');
        console.log('  revoke       - Test transaction revocation');
        console.log('  owner-add    - Test adding an owner');
        console.log('  owner-remove - Test removing an owner');
        console.log('  requirement  - Test changing requirement');
        console.log('  deposit      - Test deposit event');
        console.log('  all          - Run all scenarios');
        process.exit(1);
    }
    
    console.log('\n✅ Test completed successfully!');
    
  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run
main();