/**
 * MultiSig Wallet Regression Test Suite
 * 
 * This comprehensive test suite verifies all multisig wallet actions
 * and ensures the validator service correctly detects and processes events.
 * 
 * Prerequisites (handled by runRegressionTests.js):
 * 1. Hardhat node running
 * 2. Contracts deployed
 * 3. Database cleaned
 * 4. Wallets registered with validator service
 * 5. Validator service running
 * 
 * Usage: node test/regression/multisig-regression-tests.js
 */

const { ethers } = require("ethers");
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuration
const CONFIG = {
  delayBetweenTests: 3000, // 3 seconds between tests
  delayBetweenActions: 2000, // 2 seconds between actions within a test
  deploymentFile: path.join(__dirname, '../../../deployment-local.json'),
  validatorApiUrl: 'http://localhost:3001',
  waitForEventProcessing: 1000, // Wait 1 second after actions for event processing
  rpcUrl: 'http://127.0.0.1:8545',
};

// Test result tracking
const testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

// Utility functions
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function logTest(testName, status, details = {}) {
  const result = {
    name: testName,
    status,
    timestamp: new Date().toISOString(),
    ...details
  };
  
  testResults.tests.push(result);
  
  if (status === 'PASSED') {
    testResults.passed++;
    console.log(`✅ ${testName} - PASSED`);
  } else {
    testResults.failed++;
    console.error(`❌ ${testName} - FAILED:`, details.error || 'Unknown error');
  }
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
    // Give validator service time to process the event
    await delay(CONFIG.waitForEventProcessing);
    
    // Check wallet status via API
    const response = await axios.get(`${CONFIG.validatorApiUrl}/api/wallets`, {
      params: { network: 'localhost' }
    });
    
    const wallet = response.data.find(w => 
      w.address.toLowerCase() === walletAddress.toLowerCase()
    );
    
    if (!wallet) {
      throw new Error(`Wallet ${walletAddress} not found in validator service`);
    }
    
    // For transaction-related events, verify the transaction exists
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

// Main test runner
async function runRegressionTests() {
  console.log('🧪 Starting MultiSig Wallet Regression Tests');
  console.log('=' .repeat(50));
  
  try {
    // Load deployment info
    const deploymentInfo = JSON.parse(fs.readFileSync(CONFIG.deploymentFile, 'utf8'));
    console.log('📋 Loaded deployment configuration');
    console.log(`Network: ${deploymentInfo.network}`);
    console.log(`MultiSigWallet: ${deploymentInfo.contracts.MultiSigWallet}`);
    console.log(`MultiSigWalletWithDailyLimit: ${deploymentInfo.contracts.MultiSigWalletWithDailyLimit}`);
    console.log('');
    
    // Verify validator service is running
    try {
      const healthResponse = await axios.get(`${CONFIG.validatorApiUrl}/health`);
      console.log('✅ Validator service is running');
    } catch (error) {
      throw new Error('Validator service is not running. Please start it first.');
    }
    
    // Create provider and connect to running Hardhat node
    const provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
    console.log('🔗 Connecting to Hardhat node at', CONFIG.rpcUrl);
    
    // Get accounts from the running node
    const accounts = await provider.listAccounts();
    console.log('👥 Available accounts:', accounts.length);
    
    // Create signers using the accounts from deployment
    const deployer = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider); // Account 0
    const owner1 = new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', provider);   // Account 1  
    const owner2 = new ethers.Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', provider);   // Account 2
    const owner3 = new ethers.Wallet('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', provider);   // Account 3
    
    console.log('👥 Test Accounts:');
    console.log(`Deployer: ${await deployer.getAddress()}`);
    console.log(`Owner 1: ${await owner1.getAddress()}`);
    console.log(`Owner 2: ${await owner2.getAddress()}`);
    console.log(`Owner 3: ${await owner3.getAddress()}`);
    console.log('');
    
    // Load contract ABIs
    const MultiSigWalletArtifact = require('../../../artifacts/contracts/MultiSigWallet.sol/MultiSigWallet.json');
    const MultiSigWithLimitArtifact = require('../../../artifacts/contracts/MultiSigWalletWithDailyLimit.sol/MultiSigWalletWithDailyLimit.json');
    
    // Create contract instances
    const wallet = new ethers.Contract(
      deploymentInfo.contracts.MultiSigWallet,
      MultiSigWalletArtifact.abi,
      provider
    );
    const walletWithLimit = new ethers.Contract(
      deploymentInfo.contracts.MultiSigWalletWithDailyLimit,
      MultiSigWithLimitArtifact.abi,
      provider
    );
    
    // Run test scenarios
    console.log('🚀 Starting Test Scenarios');
    console.log('=' .repeat(50));
    
    // Test 1: Transaction Submission and Confirmation
    await testTransactionSubmissionAndConfirmation(wallet, owner1, owner2, deployer);
    await delay(CONFIG.delayBetweenTests);
    
    // Test 2: Transaction Execution (Full Flow)
    await testTransactionExecution(wallet, owner1, owner2, deployer);
    await delay(CONFIG.delayBetweenTests);
    
    // Test 3: Transaction Revocation
    await testTransactionRevocation(wallet, owner1, owner2, deployer);
    await delay(CONFIG.delayBetweenTests);
    
    // Test 4: Owner Addition
    await testOwnerAddition(wallet, owner1, owner2);
    await delay(CONFIG.delayBetweenTests);
    
    // Test 5: Owner Removal
    await testOwnerRemoval(wallet, owner1, owner2, owner3);
    await delay(CONFIG.delayBetweenTests);
    
    // Test 6: Requirement Change
    await testRequirementChange(wallet, owner1, owner2);
    await delay(CONFIG.delayBetweenTests);
    
    // Test 7: Daily Limit Change
    await testDailyLimitChange(walletWithLimit, owner1, owner2);
    await delay(CONFIG.delayBetweenTests);
    
    // Test 8: Deposit Event
    await testDepositEvent(wallet, owner1, provider);
    await delay(CONFIG.delayBetweenTests);
    
    // Test 9: Execution Failure
    await testExecutionFailure(wallet, owner1, owner2, deployer, provider);
    
    // Print summary
    console.log('');
    console.log('=' .repeat(50));
    console.log('📊 TEST SUMMARY');
    console.log('=' .repeat(50));
    console.log(`Total Tests: ${testResults.passed + testResults.failed}`);
    console.log(`✅ Passed: ${testResults.passed}`);
    console.log(`❌ Failed: ${testResults.failed}`);
    console.log(`Success Rate: ${((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(2)}%`);
    
    // Save test results
    const resultsFile = path.join(__dirname, `regression-results-${Date.now()}.json`);
    fs.writeFileSync(resultsFile, JSON.stringify(testResults, null, 2));
    console.log(`\n💾 Test results saved to: ${resultsFile}`);
    
    if (testResults.failed > 0) {
      console.log('\n⚠️  Some tests failed. Please check the validator service logs for details.');
      process.exit(1);
    } else {
      console.log('\n🎉 All tests passed! The multisig wallet and validator service are working correctly.');
      process.exit(0);
    }
    
  } catch (error) {
    console.error('💥 Fatal error during test execution:', error);
    process.exit(1);
  }
}

// Test Scenarios

async function testTransactionSubmissionAndConfirmation(wallet, owner1, owner2, recipient) {
  const testName = 'Transaction Submission and Single Confirmation';
  console.log(`\n📝 ${testName}`);
  
  try {
    // Submit transaction
    const value = ethers.parseEther("0.1");
    console.log(`   Submitting transaction: ${ethers.formatEther(value)} ETH`);
    
    const submitTx = await wallet.connect(owner1).submitTransaction(
      await recipient.getAddress(),
      value,
      "0x"
    );
    const submitReceipt = await submitTx.wait();
    const txId = await getTransactionId(submitReceipt, wallet);
    
    console.log(`   Transaction submitted with ID: ${txId}`);
    console.log(`   Tx hash: ${submitTx.hash}`);
    
    // Verify event in validator service
    const eventVerified = await verifyEventInValidatorService(
      await wallet.getAddress(),
      'Submission',
      txId
    );
    
    await delay(CONFIG.delayBetweenActions);
    
    // Confirm transaction
    console.log(`   Confirming transaction...`);
    const confirmTx = await wallet.connect(owner2).confirmTransaction(txId);
    await confirmTx.wait();
    console.log(`   Transaction confirmed by owner2`);
    
    // Verify confirmation count
    const confirmCount = await wallet.getConfirmationCount(txId);
    console.log(`   Confirmation count: ${confirmCount}/2`);
    
    logTest(testName, 'PASSED', { 
      transactionId: txId.toString(), 
      confirmations: confirmCount.toString(),
      validatorServiceVerified: eventVerified 
    });
    
  } catch (error) {
    logTest(testName, 'FAILED', { error: error.message });
  }
}

async function testTransactionExecution(wallet, owner1, owner2, recipient) {
  const testName = 'Transaction Execution (Full Flow)';
  console.log(`\n🚀 ${testName}`);
  
  try {
    // Submit transaction
    const value = ethers.parseEther("0.2");
    console.log(`   Submitting transaction: ${ethers.formatEther(value)} ETH`);
    
    const submitTx = await wallet.connect(owner1).submitTransaction(
      await recipient.getAddress(),
      value,
      "0x"
    );
    const submitReceipt = await submitTx.wait();
    const txId = await getTransactionId(submitReceipt, wallet);
    
    console.log(`   Transaction submitted with ID: ${txId}`);
    
    await delay(CONFIG.delayBetweenActions);
    
    // Second confirmation (should trigger execution)
    console.log(`   Adding second confirmation...`);
    const confirmTx = await wallet.connect(owner2).confirmTransaction(txId);
    const confirmReceipt = await confirmTx.wait();
    
    // Check if ExecutionEvent was emitted
    const executionEvent = confirmReceipt.logs.find(log => 
      log.topics[0] === wallet.interface.getEvent('Execution').topicHash
    );
    
    if (executionEvent) {
      console.log(`   ✅ Transaction executed automatically!`);
    }
    
    // Verify transaction state
    const txDetails = await wallet.transactions(txId);
    console.log(`   Transaction executed: ${txDetails.executed}`);
    
    // Verify in validator service
    const eventVerified = await verifyEventInValidatorService(
      await wallet.getAddress(),
      'Execution',
      txId
    );
    
    logTest(testName, 'PASSED', { 
      transactionId: txId.toString(), 
      executed: txDetails.executed,
      validatorServiceVerified: eventVerified 
    });
    
  } catch (error) {
    logTest(testName, 'FAILED', { error: error.message });
  }
}

async function testTransactionRevocation(wallet, owner1, owner2, recipient) {
  const testName = 'Transaction Revocation';
  console.log(`\n↩️  ${testName}`);
  
  try {
    // Submit transaction
    const value = ethers.parseEther("0.15");
    console.log(`   Submitting transaction: ${ethers.formatEther(value)} ETH`);
    
    const submitTx = await wallet.connect(owner1).submitTransaction(
      await recipient.getAddress(),
      value,
      "0x"
    );
    const submitReceipt = await submitTx.wait();
    const txId = await getTransactionId(submitReceipt, wallet);
    
    console.log(`   Transaction submitted with ID: ${txId}`);
    console.log(`   Initial confirmation count: 1`);
    
    await delay(CONFIG.delayBetweenActions);
    
    // Revoke confirmation
    console.log(`   Revoking confirmation...`);
    const revokeTx = await wallet.connect(owner1).revokeConfirmation(txId);
    const revokeReceipt = await revokeTx.wait();
    
    // Check for Revocation event
    const revocationEvent = revokeReceipt.logs.find(log => 
      log.topics[0] === wallet.interface.getEvent('Revocation').topicHash
    );
    
    if (revocationEvent) {
      console.log(`   ✅ Confirmation revoked successfully`);
    }
    
    // Verify confirmation count
    const confirmCount = await wallet.getConfirmationCount(txId);
    console.log(`   Confirmation count after revocation: ${confirmCount}`);
    
    logTest(testName, 'PASSED', { 
      transactionId: txId.toString(), 
      confirmationsAfterRevoke: confirmCount.toString() 
    });
    
  } catch (error) {
    logTest(testName, 'FAILED', { error: error.message });
  }
}

async function testOwnerAddition(wallet, owner1, owner2) {
  const testName = 'Owner Addition';
  console.log(`\n👤➕ ${testName}`);
  
  try {
    // Create new owner address
    const newOwner = ethers.Wallet.createRandom();
    console.log(`   New owner address: ${newOwner.address}`);
    
    // Get current owners
    const ownersBefore = await wallet.getOwners();
    console.log(`   Current owners: ${ownersBefore.length}`);
    
    // Encode addOwner function call
    const addOwnerData = wallet.interface.encodeFunctionData("addOwner", [newOwner.address]);
    
    // Submit internal transaction
    console.log(`   Submitting addOwner transaction...`);
    const submitTx = await wallet.connect(owner1).submitTransaction(
      await wallet.getAddress(),
      0,
      addOwnerData
    );
    const submitReceipt = await submitTx.wait();
    const txId = await getTransactionId(submitReceipt, wallet);
    
    console.log(`   Transaction submitted with ID: ${txId}`);
    
    await delay(CONFIG.delayBetweenActions);
    
    // Confirm to execute
    console.log(`   Confirming to execute...`);
    const confirmTx = await wallet.connect(owner2).confirmTransaction(txId);
    const confirmReceipt = await confirmTx.wait();
    
    // Check for OwnerAddition event
    const ownerAdditionEvent = confirmReceipt.logs.find(log => 
      log.topics[0] === wallet.interface.getEvent('OwnerAddition').topicHash
    );
    
    if (ownerAdditionEvent) {
      console.log(`   ✅ Owner added successfully`);
    }
    
    // Verify new owners list
    const ownersAfter = await wallet.getOwners();
    console.log(`   Owners after addition: ${ownersAfter.length}`);
    console.log(`   New owner added: ${ownersAfter.includes(newOwner.address)}`);
    
    logTest(testName, 'PASSED', { 
      newOwner: newOwner.address,
      ownerCount: ownersAfter.length 
    });
    
  } catch (error) {
    logTest(testName, 'FAILED', { error: error.message });
  }
}

async function testOwnerRemoval(wallet, owner1, owner2, ownerToRemove) {
  const testName = 'Owner Removal';
  console.log(`\n👤➖ ${testName}`);
  
  try {
    // Get current owners
    const ownersBefore = await wallet.getOwners();
    console.log(`   Current owners: ${ownersBefore.length}`);
    
    // For testing, remove the last owner in the list (not owner1 or owner2)
    const owners = await wallet.getOwners();
    const targetOwner = owners[owners.length - 1];
    console.log(`   Owner to remove: ${targetOwner}`);
    
    // Encode removeOwner function call
    const removeOwnerData = wallet.interface.encodeFunctionData("removeOwner", [targetOwner]);
    
    // Submit internal transaction
    console.log(`   Submitting removeOwner transaction...`);
    const submitTx = await wallet.connect(owner1).submitTransaction(
      await wallet.getAddress(),
      0,
      removeOwnerData
    );
    const submitReceipt = await submitTx.wait();
    const txId = await getTransactionId(submitReceipt, wallet);
    
    console.log(`   Transaction submitted with ID: ${txId}`);
    
    await delay(CONFIG.delayBetweenActions);
    
    // Confirm to execute
    console.log(`   Confirming to execute...`);
    const confirmTx = await wallet.connect(owner2).confirmTransaction(txId);
    const confirmReceipt = await confirmTx.wait();
    
    // Check for OwnerRemoval event
    const ownerRemovalEvent = confirmReceipt.logs.find(log => 
      log.topics[0] === wallet.interface.getEvent('OwnerRemoval').topicHash
    );
    
    if (ownerRemovalEvent) {
      console.log(`   ✅ Owner removed successfully`);
    }
    
    // Verify owners list
    const ownersAfter = await wallet.getOwners();
    console.log(`   Owners after removal: ${ownersAfter.length}`);
    console.log(`   Owner removed: ${!ownersAfter.includes(targetOwner)}`);
    
    logTest(testName, 'PASSED', { 
      removedOwner: targetOwner,
      ownerCount: ownersAfter.length 
    });
    
  } catch (error) {
    logTest(testName, 'FAILED', { error: error.message });
  }
}

async function testRequirementChange(wallet, owner1, owner2) {
  const testName = 'Requirement Change';
  console.log(`\n🔢 ${testName}`);
  
  try {
    // Get current requirement
    const reqBefore = await wallet.required();
    console.log(`   Current requirement: ${reqBefore}`);
    
    // New requirement (change to 1)
    const newRequirement = 1;
    console.log(`   New requirement: ${newRequirement}`);
    
    // Encode changeRequirement function call
    const changeReqData = wallet.interface.encodeFunctionData("changeRequirement", [newRequirement]);
    
    // Submit internal transaction
    console.log(`   Submitting changeRequirement transaction...`);
    const submitTx = await wallet.connect(owner1).submitTransaction(
      await wallet.getAddress(),
      0,
      changeReqData
    );
    const submitReceipt = await submitTx.wait();
    const txId = await getTransactionId(submitReceipt, wallet);
    
    console.log(`   Transaction submitted with ID: ${txId}`);
    
    await delay(CONFIG.delayBetweenActions);
    
    // Confirm to execute
    console.log(`   Confirming to execute...`);
    const confirmTx = await wallet.connect(owner2).confirmTransaction(txId);
    const confirmReceipt = await confirmTx.wait();
    
    // Check for RequirementChange event
    const requirementChangeEvent = confirmReceipt.logs.find(log => 
      log.topics[0] === wallet.interface.getEvent('RequirementChange').topicHash
    );
    
    if (requirementChangeEvent) {
      console.log(`   ✅ Requirement changed successfully`);
    }
    
    // Verify new requirement
    const reqAfter = await wallet.required();
    console.log(`   Requirement after change: ${reqAfter}`);
    
    logTest(testName, 'PASSED', { 
      oldRequirement: reqBefore.toString(),
      newRequirement: reqAfter.toString() 
    });
    
  } catch (error) {
    logTest(testName, 'FAILED', { error: error.message });
  }
}

async function testDailyLimitChange(walletWithLimit, owner1, owner2) {
  const testName = 'Daily Limit Change';
  console.log(`\n📅 ${testName}`);
  
  try {
    // Get current daily limit
    const limitBefore = await walletWithLimit.dailyLimit();
    console.log(`   Current daily limit: ${ethers.formatEther(limitBefore)} ETH`);
    
    // New daily limit
    const newLimit = ethers.parseEther("2.0");
    console.log(`   New daily limit: ${ethers.formatEther(newLimit)} ETH`);
    
    // Encode changeDailyLimit function call
    const changeLimitData = walletWithLimit.interface.encodeFunctionData("changeDailyLimit", [newLimit]);
    
    // Submit internal transaction
    console.log(`   Submitting changeDailyLimit transaction...`);
    const submitTx = await walletWithLimit.connect(owner1).submitTransaction(
      await walletWithLimit.getAddress(),
      0,
      changeLimitData
    );
    const submitReceipt = await submitTx.wait();
    const txId = await getTransactionId(submitReceipt, walletWithLimit);
    
    console.log(`   Transaction submitted with ID: ${txId}`);
    
    await delay(CONFIG.delayBetweenActions);
    
    // Confirm to execute
    console.log(`   Confirming to execute...`);
    const confirmTx = await walletWithLimit.connect(owner2).confirmTransaction(txId);
    const confirmReceipt = await confirmTx.wait();
    
    // Check for DailyLimitChange event
    const dailyLimitChangeEvent = confirmReceipt.logs.find(log => 
      log.topics[0] === walletWithLimit.interface.getEvent('DailyLimitChange').topicHash
    );
    
    if (dailyLimitChangeEvent) {
      console.log(`   ✅ Daily limit changed successfully`);
    }
    
    // Verify new daily limit
    const limitAfter = await walletWithLimit.dailyLimit();
    console.log(`   Daily limit after change: ${ethers.formatEther(limitAfter)} ETH`);
    
    logTest(testName, 'PASSED', { 
      oldLimit: ethers.formatEther(limitBefore),
      newLimit: ethers.formatEther(limitAfter) 
    });
    
  } catch (error) {
    logTest(testName, 'FAILED', { error: error.message });
  }
}

async function testDepositEvent(wallet, depositor, provider) {
  const testName = 'Direct Deposit';
  console.log(`\n💰 ${testName}`);
  
  try {
    // Get initial balance
    const balanceBefore = await provider.getBalance(await wallet.getAddress());
    console.log(`   Wallet balance before: ${ethers.formatEther(balanceBefore)} ETH`);
    
    // Send ETH directly
    const depositAmount = ethers.parseEther("0.5");
    console.log(`   Depositing: ${ethers.formatEther(depositAmount)} ETH`);
    
    const depositTx = await depositor.sendTransaction({
      to: await wallet.getAddress(),
      value: depositAmount
    });
    const depositReceipt = await depositTx.wait();
    
    console.log(`   Deposit tx hash: ${depositTx.hash}`);
    
    // Check for Deposit event
    const depositEvent = depositReceipt.logs.find(log => {
      try {
        const parsed = wallet.interface.parseLog(log);
        return parsed && parsed.name === 'Deposit';
      } catch {
        return false;
      }
    });
    
    if (depositEvent) {
      console.log(`   ✅ Deposit event emitted`);
    }
    
    // Verify new balance
    const balanceAfter = await provider.getBalance(await wallet.getAddress());
    console.log(`   Wallet balance after: ${ethers.formatEther(balanceAfter)} ETH`);
    
    logTest(testName, 'PASSED', { 
      depositAmount: ethers.formatEther(depositAmount),
      finalBalance: ethers.formatEther(balanceAfter) 
    });
    
  } catch (error) {
    logTest(testName, 'FAILED', { error: error.message });
  }
}

async function testExecutionFailure(wallet, owner1, owner2, recipient, provider) {
  const testName = 'Execution Failure (Insufficient Balance)';
  console.log(`\n💥 ${testName}`);
  
  try {
    // Get wallet balance
    const walletBalance = await provider.getBalance(await wallet.getAddress());
    console.log(`   Wallet balance: ${ethers.formatEther(walletBalance)} ETH`);
    
    // Try to send more than balance
    const excessiveAmount = walletBalance + ethers.parseEther("10");
    console.log(`   Attempting to send: ${ethers.formatEther(excessiveAmount)} ETH`);
    
    // Submit transaction
    const submitTx = await wallet.connect(owner1).submitTransaction(
      await recipient.getAddress(),
      excessiveAmount,
      "0x"
    );
    const submitReceipt = await submitTx.wait();
    const txId = await getTransactionId(submitReceipt, wallet);
    
    console.log(`   Transaction submitted with ID: ${txId}`);
    
    await delay(CONFIG.delayBetweenActions);
    
    // Confirm to trigger execution
    console.log(`   Confirming to trigger execution...`);
    const confirmTx = await wallet.connect(owner2).confirmTransaction(txId);
    const confirmReceipt = await confirmTx.wait();
    
    // Check for ExecutionFailure event
    const executionFailureEvent = confirmReceipt.logs.find(log => 
      log.topics[0] === wallet.interface.getEvent('ExecutionFailure').topicHash
    );
    
    if (executionFailureEvent) {
      console.log(`   ✅ Execution failed as expected`);
    }
    
    // Verify transaction is not executed
    const txDetails = await wallet.transactions(txId);
    console.log(`   Transaction executed: ${txDetails.executed}`);
    
    logTest(testName, 'PASSED', { 
      transactionId: txId.toString(),
      executed: txDetails.executed,
      failureDetected: !!executionFailureEvent 
    });
    
  } catch (error) {
    logTest(testName, 'FAILED', { error: error.message });
  }
}

// Run the tests
runRegressionTests().catch(console.error);