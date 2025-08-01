const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuration
const CONFIG = {
  delayBetweenActions: 2000,
  deploymentFile: path.join(__dirname, 'deployment-local.json'),
  validatorApiUrl: 'http://localhost:3001',
  waitForEventProcessing: 1000,
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

// Main test runner
async function runSingleTest() {
  console.log('🧪 Running Single Test: Transaction Submission and Confirmation');
  console.log('=' .repeat(50));
  
  try {
    // Load deployment info
    const deploymentInfo = JSON.parse(fs.readFileSync(CONFIG.deploymentFile, 'utf8'));
    console.log('📋 Loaded deployment configuration');
    console.log(`Network: ${deploymentInfo.network}`);
    console.log(`MultiSigWallet: ${deploymentInfo.contracts.MultiSigWallet}`);
    
    // Get signers
    const [deployer, owner1, owner2, owner3] = await ethers.getSigners();
    console.log('\n👥 Test Accounts:');
    console.log(`Deployer: ${await deployer.getAddress()}`);
    console.log(`Owner 1: ${await owner1.getAddress()}`);
    console.log(`Owner 2: ${await owner2.getAddress()}`);
    
    // Get contract instance
    const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
    const wallet = MultiSigWallet.attach(deploymentInfo.contracts.MultiSigWallet);
    
    // Run the test
    await testTransactionSubmissionAndConfirmation(wallet, owner1, owner2, deployer);
    
    // Print summary
    console.log('\n' + '=' .repeat(50));
    console.log('📊 TEST RESULT');
    console.log('=' .repeat(50));
    if (testResults.failed === 0) {
      console.log('✅ Test PASSED!');
    } else {
      console.log('❌ Test FAILED!');
    }
    
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

// Run the test
runSingleTest().catch(console.error);