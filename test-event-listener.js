// Simple test script to demonstrate event listening on localhost
const { ethers } = require('hardhat');
const fs = require('fs');

async function startEventListener() {
  console.log('🚀 Starting real-time event listener for MultiSig wallet...');
  
  // Read deployment info
  const deploymentInfo = JSON.parse(fs.readFileSync('deployment-local.json', 'utf8'));
  const multiSigAddress = deploymentInfo.contracts.MultiSigWallet;
  
  console.log(`📋 Monitoring wallet: ${multiSigAddress}`);
  console.log(`🌐 Network: localhost (chainId: ${deploymentInfo.chainId})`);
  
  // Connect to the contract
  const MultiSig = await ethers.getContractFactory("MultiSigWallet");
  const multiSig = MultiSig.attach(multiSigAddress);
  
  // Set up event listeners
  console.log('🔄 Setting up event listeners...\n');
  
  multiSig.on('Submission', (transactionId, event) => {
    console.log(`📤 SUBMISSION Event:`, {
      transactionId: transactionId.toString(),
      blockNumber: event.blockNumber,
      txHash: event.transactionHash,
      timestamp: new Date().toISOString()
    });
  });
  
  multiSig.on('Confirmation', (sender, transactionId, event) => {
    console.log(`✅ CONFIRMATION Event:`, {
      confirmer: sender,
      transactionId: transactionId.toString(),
      blockNumber: event.blockNumber,
      txHash: event.transactionHash,
      timestamp: new Date().toISOString()
    });
  });
  
  multiSig.on('Execution', (transactionId, event) => {
    console.log(`🚀 EXECUTION Event:`, {
      transactionId: transactionId.toString(),
      blockNumber: event.blockNumber,
      txHash: event.transactionHash,
      timestamp: new Date().toISOString()
    });
  });
  
  multiSig.on('ExecutionFailure', (transactionId, event) => {
    console.log(`❌ EXECUTION FAILURE Event:`, {
      transactionId: transactionId.toString(),
      blockNumber: event.blockNumber,
      txHash: event.transactionHash,
      timestamp: new Date().toISOString()
    });
  });
  
  multiSig.on('Deposit', (sender, value, event) => {
    console.log(`💰 DEPOSIT Event:`, {
      sender,
      value: ethers.formatEther(value) + ' ETH',
      blockNumber: event.blockNumber,
      txHash: event.transactionHash,
      timestamp: new Date().toISOString()
    });
  });
  
  multiSig.on('OwnerAddition', (owner, event) => {
    console.log(`👥 OWNER ADDITION Event:`, {
      newOwner: owner,
      blockNumber: event.blockNumber,
      txHash: event.transactionHash,
      timestamp: new Date().toISOString()
    });
  });
  
  multiSig.on('OwnerRemoval', (owner, event) => {
    console.log(`👥 OWNER REMOVAL Event:`, {
      removedOwner: owner,
      blockNumber: event.blockNumber,
      txHash: event.transactionHash,
      timestamp: new Date().toISOString()
    });
  });
  
  console.log('✅ Event listeners active! Monitoring for events...');
  console.log('📊 To test, run: npx hardhat run scripts/testTransactions.js --network localhost');
  console.log('⏹️  Press Ctrl+C to stop monitoring\n');
  
  // Keep the script running
  process.on('SIGINT', () => {
    console.log('\n🛑 Stopping event listener...');
    process.exit(0);
  });
}

startEventListener().catch(console.error);