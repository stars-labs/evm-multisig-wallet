/**
 * Quick Test Script for Development
 * 
 * Use this to quickly test specific scenarios during development
 * without running the full regression suite.
 * 
 * Usage: node test/regression/quick-test.js [scenario]
 * 
 * Available scenarios:
 * - submit: Test transaction submission
 * - confirm: Test transaction confirmation
 * - execute: Test full execution flow
 * - revoke: Test revocation
 * - owner-add: Test adding owner
 * - owner-remove: Test removing owner
 * - requirement: Test changing requirement
 * - deposit: Test deposit event
 * - all: Run all scenarios
 */

const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuration
const VALIDATOR_API_URL = 'http://localhost:3001';
const DEPLOYMENT_FILE = path.join(__dirname, '../../../../deployment-local.json');

// Test scenarios
const scenarios = {
  'submit': testSubmitOnly,
  'confirm': testSubmitAndConfirm,
  'execute': testFullExecution,
  'revoke': testRevocation,
  'owner-add': testAddOwner,
  'owner-remove': testRemoveOwner,
  'requirement': testChangeRequirement,
  'deposit': testDeposit,
  'all': runAllScenarios
};

// Get scenario from command line
const scenario = process.argv[2] || 'submit';

async function main() {
  console.log(`🧪 Running quick test: ${scenario}`);
  console.log('=' .repeat(50));
  
  // Load deployment info
  const deploymentInfo = JSON.parse(
    fs.readFileSync(DEPLOYMENT_FILE, 'utf8')
  );
  
  // Verify validator service is running
  try {
    await axios.get(`${VALIDATOR_API_URL}/health`);
    console.log('✅ Validator service is running');
  } catch (error) {
    console.error('❌ Validator service is not running. Please start it first.');
    process.exit(1);
  }
  
  // Get signers and contract
  const [deployer, owner1, owner2, owner3] = await ethers.getSigners();
  const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
  const wallet = MultiSigWallet.attach(deploymentInfo.contracts.MultiSigWallet);
  
  console.log(`Wallet: ${await wallet.getAddress()}`);
  console.log(`Owner1: ${await owner1.getAddress()}`);
  console.log(`Owner2: ${await owner2.getAddress()}`);
  console.log('');
  
  // Run selected scenario
  if (scenarios[scenario]) {
    await scenarios[scenario](wallet, owner1, owner2, owner3, deployer);
  } else {
    console.error(`❌ Unknown scenario: ${scenario}`);
    console.log('Available scenarios:', Object.keys(scenarios).join(', '));
    process.exit(1);
  }
  
  console.log('\n✅ Test completed!');
  console.log('Check validator service logs for event processing details.');
}

// Test implementations

async function testSubmitOnly(wallet, owner1, owner2, owner3, deployer) {
  console.log('📝 Testing transaction submission...');
  
  const tx = await wallet.connect(owner1).submitTransaction(
    await deployer.getAddress(),
    ethers.parseEther("0.1"),
    "0x"
  );
  
  const receipt = await tx.wait();
  const event = receipt.logs.find(log => 
    log.topics[0] === wallet.interface.getEvent('Submission').topicHash
  );
  const txId = wallet.interface.parseLog(event).args.transactionId;
  
  console.log(`Transaction submitted with ID: ${txId}`);
  console.log(`Tx hash: ${tx.hash}`);
  console.log(`Block: ${receipt.blockNumber}`);
  
  // Wait for validator service to process
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Check validator service
  try {
    const response = await axios.get(`${VALIDATOR_API_URL}/api/wallets`);
    const walletData = response.data.find(w => 
      w.address.toLowerCase() === (await wallet.getAddress()).toLowerCase()
    );
    console.log(`\nValidator Service Status:`);
    console.log(`- Pending transactions: ${walletData?.pendingTransactions?.length || 0}`);
  } catch (error) {
    console.error('Failed to check validator service:', error.message);
  }
}

async function testSubmitAndConfirm(wallet, owner1, owner2, owner3, deployer) {
  console.log('✅ Testing submission and confirmation...');
  
  // Submit
  const submitTx = await wallet.connect(owner1).submitTransaction(
    await deployer.getAddress(),
    ethers.parseEther("0.15"),
    "0x"
  );
  const submitReceipt = await submitTx.wait();
  const submissionEvent = submitReceipt.logs.find(log => 
    log.topics[0] === wallet.interface.getEvent('Submission').topicHash
  );
  const txId = wallet.interface.parseLog(submissionEvent).args.transactionId;
  
  console.log(`Transaction submitted with ID: ${txId}`);
  
  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Confirm
  const confirmTx = await wallet.connect(owner2).confirmTransaction(txId);
  const confirmReceipt = await confirmTx.wait();
  
  console.log(`Transaction confirmed by owner2`);
  console.log(`Confirmation tx: ${confirmTx.hash}`);
  
  // Check status
  const confirmCount = await wallet.getConfirmationCount(txId);
  console.log(`Confirmations: ${confirmCount}/2`);
}

async function testFullExecution(wallet, owner1, owner2, owner3, deployer) {
  console.log('🚀 Testing full execution flow...');
  
  // Submit
  const submitTx = await wallet.connect(owner1).submitTransaction(
    await deployer.getAddress(),
    ethers.parseEther("0.2"),
    "0x"
  );
  const submitReceipt = await submitTx.wait();
  const submissionEvent = submitReceipt.logs.find(log => 
    log.topics[0] === wallet.interface.getEvent('Submission').topicHash
  );
  const txId = wallet.interface.parseLog(submissionEvent).args.transactionId;
  
  console.log(`Transaction submitted with ID: ${txId}`);
  
  // Wait
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Confirm (should execute)
  const confirmTx = await wallet.connect(owner2).confirmTransaction(txId);
  const confirmReceipt = await confirmTx.wait();
  
  // Check for execution
  const executionEvent = confirmReceipt.logs.find(log => 
    log.topics[0] === wallet.interface.getEvent('Execution').topicHash
  );
  
  if (executionEvent) {
    console.log('✅ Transaction executed!');
  }
  
  const txDetails = await wallet.transactions(txId);
  console.log(`Executed: ${txDetails.executed}`);
}

async function testRevocation(wallet, owner1, owner2, owner3, deployer) {
  console.log('↩️  Testing revocation...');
  
  // Submit
  const submitTx = await wallet.connect(owner1).submitTransaction(
    await deployer.getAddress(),
    ethers.parseEther("0.1"),
    "0x"
  );
  const submitReceipt = await submitTx.wait();
  const submissionEvent = submitReceipt.logs.find(log => 
    log.topics[0] === wallet.interface.getEvent('Submission').topicHash
  );
  const txId = wallet.interface.parseLog(submissionEvent).args.transactionId;
  
  console.log(`Transaction submitted with ID: ${txId}`);
  
  // Wait
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Revoke
  const revokeTx = await wallet.connect(owner1).revokeConfirmation(txId);
  await revokeTx.wait();
  
  console.log('Confirmation revoked');
  
  const confirmCount = await wallet.getConfirmationCount(txId);
  console.log(`Confirmations after revoke: ${confirmCount}`);
}

async function testAddOwner(wallet, owner1, owner2, owner3, deployer) {
  console.log('👤➕ Testing owner addition...');
  
  const newOwner = ethers.Wallet.createRandom();
  console.log(`New owner: ${newOwner.address}`);
  
  const addOwnerData = wallet.interface.encodeFunctionData("addOwner", [newOwner.address]);
  
  // Submit
  const submitTx = await wallet.connect(owner1).submitTransaction(
    await wallet.getAddress(),
    0,
    addOwnerData
  );
  const submitReceipt = await submitTx.wait();
  const submissionEvent = submitReceipt.logs.find(log => 
    log.topics[0] === wallet.interface.getEvent('Submission').topicHash
  );
  const txId = wallet.interface.parseLog(submissionEvent).args.transactionId;
  
  console.log(`Add owner tx ID: ${txId}`);
  
  // Wait
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Confirm
  const confirmTx = await wallet.connect(owner2).confirmTransaction(txId);
  await confirmTx.wait();
  
  console.log('Owner addition executed');
  
  const owners = await wallet.getOwners();
  console.log(`Total owners: ${owners.length}`);
}

async function testRemoveOwner(wallet, owner1, owner2, owner3, deployer) {
  console.log('👤➖ Testing owner removal...');
  
  const targetOwner = await owner3.getAddress();
  console.log(`Removing: ${targetOwner}`);
  
  const removeOwnerData = wallet.interface.encodeFunctionData("removeOwner", [targetOwner]);
  
  // Submit
  const submitTx = await wallet.connect(owner1).submitTransaction(
    await wallet.getAddress(),
    0,
    removeOwnerData
  );
  const submitReceipt = await submitTx.wait();
  const submissionEvent = submitReceipt.logs.find(log => 
    log.topics[0] === wallet.interface.getEvent('Submission').topicHash
  );
  const txId = wallet.interface.parseLog(submissionEvent).args.transactionId;
  
  console.log(`Remove owner tx ID: ${txId}`);
  
  // Wait
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Confirm
  const confirmTx = await wallet.connect(owner2).confirmTransaction(txId);
  await confirmTx.wait();
  
  console.log('Owner removal executed');
  
  const owners = await wallet.getOwners();
  console.log(`Total owners: ${owners.length}`);
}

async function testChangeRequirement(wallet, owner1, owner2, owner3, deployer) {
  console.log('🔢 Testing requirement change...');
  
  const changeReqData = wallet.interface.encodeFunctionData("changeRequirement", [1]);
  
  // Submit
  const submitTx = await wallet.connect(owner1).submitTransaction(
    await wallet.getAddress(),
    0,
    changeReqData
  );
  const submitReceipt = await submitTx.wait();
  const submissionEvent = submitReceipt.logs.find(log => 
    log.topics[0] === wallet.interface.getEvent('Submission').topicHash
  );
  const txId = wallet.interface.parseLog(submissionEvent).args.transactionId;
  
  console.log(`Change requirement tx ID: ${txId}`);
  
  // Wait
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Confirm
  const confirmTx = await wallet.connect(owner2).confirmTransaction(txId);
  await confirmTx.wait();
  
  console.log('Requirement change executed');
  
  const newReq = await wallet.required();
  console.log(`New requirement: ${newReq}`);
}

async function testDeposit(wallet, owner1, owner2, owner3, deployer) {
  console.log('💰 Testing deposit...');
  
  const balanceBefore = await ethers.provider.getBalance(await wallet.getAddress());
  console.log(`Balance before: ${ethers.formatEther(balanceBefore)} ETH`);
  
  const depositTx = await owner1.sendTransaction({
    to: await wallet.getAddress(),
    value: ethers.parseEther("0.5")
  });
  await depositTx.wait();
  
  console.log(`Deposited 0.5 ETH`);
  console.log(`Tx hash: ${depositTx.hash}`);
  
  const balanceAfter = await ethers.provider.getBalance(await wallet.getAddress());
  console.log(`Balance after: ${ethers.formatEther(balanceAfter)} ETH`);
}

async function runAllScenarios(wallet, owner1, owner2, owner3, deployer) {
  console.log('🎯 Running all scenarios...\n');
  
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  
  await testSubmitOnly(wallet, owner1, owner2, owner3, deployer);
  await delay(3000);
  
  console.log('\n' + '-'.repeat(50) + '\n');
  await testSubmitAndConfirm(wallet, owner1, owner2, owner3, deployer);
  await delay(3000);
  
  console.log('\n' + '-'.repeat(50) + '\n');
  await testFullExecution(wallet, owner1, owner2, owner3, deployer);
  await delay(3000);
  
  console.log('\n' + '-'.repeat(50) + '\n');
  await testRevocation(wallet, owner1, owner2, owner3, deployer);
  await delay(3000);
  
  console.log('\n' + '-'.repeat(50) + '\n');
  await testDeposit(wallet, owner1, owner2, owner3, deployer);
}

// Run the test
main().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});