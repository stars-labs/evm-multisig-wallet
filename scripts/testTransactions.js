// Test script to create multisig transactions on local network
const hre = require("hardhat");

async function main() {
  console.log("🚀 Creating test multisig transactions...");
  
  // Get signers (wallet owners)
  const [deployer, owner1, owner2, owner3] = await hre.ethers.getSigners();
  
  // Read deployment info
  const fs = require('fs');
  const deploymentInfo = JSON.parse(fs.readFileSync('deployment-local.json', 'utf8'));
  
  const multiSigAddress = deploymentInfo.contracts.MultiSigWallet;
  const multiSigWithLimitAddress = deploymentInfo.contracts.MultiSigWalletWithDailyLimit;
  
  console.log("📋 Test setup:");
  console.log("MultiSig Wallet:", multiSigAddress);
  console.log("Owner 1:", await owner1.getAddress());
  console.log("Owner 2:", await owner2.getAddress());
  console.log("Owner 3:", await owner3.getAddress());
  
  // Connect to the multisig contract
  const MultiSig = await hre.ethers.getContractFactory("MultiSigWallet");
  const multiSig = MultiSig.attach(multiSigAddress);
  
  // Test 1: Submit a transaction
  console.log("\n🔥 Test 1: Submitting a transaction...");
  
  const recipient = await deployer.getAddress(); // Send to deployer for testing
  const value = hre.ethers.parseEther("0.1"); // 0.1 ETH
  const data = "0x"; // Empty data for simple ETH transfer
  
  console.log(`Submitting transaction: ${hre.ethers.formatEther(value)} ETH to ${recipient}`);
  
  // Submit transaction as owner1
  const submitTx = await multiSig.connect(owner1).submitTransaction(recipient, value, data);
  const submitReceipt = await submitTx.wait();
  
  console.log("✅ Transaction submitted!");
  console.log("Tx hash:", submitTx.hash);
  console.log("Block number:", submitReceipt.blockNumber);
  
  // Get the transaction ID from the event
  const submissionEvent = submitReceipt.logs.find(log => 
    log.topics[0] === multiSig.interface.getEvent('Submission').topicHash
  );
  
  if (submissionEvent) {
    const decodedEvent = multiSig.interface.parseLog(submissionEvent);
    const transactionId = decodedEvent.args.transactionId;
    console.log("Transaction ID:", transactionId.toString());
    
    // Wait a moment for event processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Test 2: Confirm the transaction
    console.log("\n✅ Test 2: Confirming the transaction...");
    
    const confirmTx = await multiSig.connect(owner2).confirmTransaction(transactionId);
    const confirmReceipt = await confirmTx.wait();
    
    console.log("✅ Transaction confirmed by owner2!");
    console.log("Tx hash:", confirmTx.hash);
    console.log("Block number:", confirmReceipt.blockNumber);
    
    // Wait a moment for event processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check if transaction was executed (should be since we have 2/3 confirmations)
    const txDetails = await multiSig.transactions(transactionId);
    console.log("Transaction executed:", txDetails.executed); // executed field
    
    if (txDetails.executed) {
      console.log("🚀 Transaction was automatically executed!");
    } else {
      console.log("⏳ Transaction needs more confirmations");
    }
    
    // Test 3: Submit another transaction to test multiple TXs
    console.log("\n🔥 Test 3: Submitting another transaction...");
    
    const value2 = hre.ethers.parseEther("0.05"); // 0.05 ETH
    const submitTx2 = await multiSig.connect(owner2).submitTransaction(recipient, value2, data);
    const submitReceipt2 = await submitTx2.wait();
    
    const submissionEvent2 = submitReceipt2.logs.find(log => 
      log.topics[0] === multiSig.interface.getEvent('Submission').topicHash
    );
    
    if (submissionEvent2) {
      const decodedEvent2 = multiSig.interface.parseLog(submissionEvent2);
      const transactionId2 = decodedEvent2.args.transactionId;
      console.log("✅ Second transaction submitted! ID:", transactionId2.toString());
      
      // Confirm it with owner3
      await new Promise(resolve => setTimeout(resolve, 1000));
      const confirmTx2 = await multiSig.connect(owner3).confirmTransaction(transactionId2);
      await confirmTx2.wait();
      console.log("✅ Second transaction confirmed by owner3!");
    }
    
  } else {
    console.log("❌ Could not find Submission event");
  }
  
  // Summary
  console.log("\n📊 Test Summary:");
  const currentTxCount = await multiSig.transactionCount();
  const balance = await hre.ethers.provider.getBalance(multiSigAddress);
  
  console.log(`Total transactions: ${currentTxCount}`);
  console.log(`Wallet balance: ${hre.ethers.formatEther(balance)} ETH`);
  console.log("\n🎉 Test transactions completed!");
  console.log("💡 Check your validator service logs to see real-time event detection!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });