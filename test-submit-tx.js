const { ethers } = require('ethers');

async function main() {
  // Connect to local node
  const provider = new ethers.JsonRpcProvider('http://localhost:8545');
  
  // Get signers
  const signers = await provider.listAccounts();
  const owner1 = signers[0];
  const owner2 = signers[1];
  console.log('Owner 1:', owner1);
  console.log('Owner 2:', owner2);
  
  // Contract address
  const walletAddress = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
  
  // ABI for submitTransaction
  const abi = [
    'function submitTransaction(address destination, uint value, bytes data) returns (uint transactionId)',
    'event Submission(uint indexed transactionId)'
  ];
  
  // Connect to contract
  const signer = await provider.getSigner(1); // Use owner2 (index 1)
  const wallet = new ethers.Contract(walletAddress, abi, signer);
  
  // Submit transaction
  console.log('Submitting transaction...');
  const tx = await wallet.submitTransaction(
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',  // destination (account 0)
    ethers.parseEther('0.01'),  // value
    '0x'  // empty data
  );
  
  console.log('Transaction hash:', tx.hash);
  const receipt = await tx.wait();
  console.log('Block number:', receipt.blockNumber);
  
  // Check for events
  const submissionEvent = receipt.logs.find(log => {
    try {
      const parsed = wallet.interface.parseLog(log);
      return parsed.name === 'Submission';
    } catch (e) {
      return false;
    }
  });
  
  if (submissionEvent) {
    const parsed = wallet.interface.parseLog(submissionEvent);
    console.log('✅ Submission event found! Transaction ID:', parsed.args[0].toString());
  } else {
    console.log('❌ No Submission event found');
  }
}

main().catch(console.error);