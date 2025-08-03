const { ethers } = require('ethers');

async function main() {
  const provider = new ethers.JsonRpcProvider('http://localhost:8545');
  const walletAddress = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
  
  // Minimal ABI to check contract state
  const abi = [
    'function getOwners() view returns (address[])',
    'function required() view returns (uint)',
    'function transactionCount() view returns (uint)',
    'function isOwner(address) view returns (bool)',
    'function submitTransaction(address destination, uint value, bytes data) returns (uint transactionId)',
    'event Submission(uint indexed transactionId)'
  ];
  
  const contract = new ethers.Contract(walletAddress, abi, provider);
  
  try {
    // Check contract state
    const owners = await contract.getOwners();
    console.log('Owners:', owners);
    
    const required = await contract.required();
    console.log('Required confirmations:', required.toString());
    
    const txCount = await contract.transactionCount();
    console.log('Transaction count:', txCount.toString());
    
    // Check if account 1 is owner
    const signer1 = await provider.getSigner(1);
    const address1 = await signer1.getAddress();
    const isOwner = await contract.isOwner(address1);
    console.log(`Is ${address1} an owner?`, isOwner);
    
    // Try to submit a transaction
    console.log('\nSubmitting transaction...');
    const contractWithSigner = contract.connect(signer1);
    
    const tx = await contractWithSigner.submitTransaction(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      ethers.parseEther('0.001'),
      '0x',
      { gasLimit: 500000 }
    );
    
    console.log('Transaction hash:', tx.hash);
    const receipt = await tx.wait();
    console.log('Receipt:', {
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      logs: receipt.logs.length
    });
    
    if (receipt.logs.length > 0) {
      console.log('\nLogs:');
      receipt.logs.forEach((log, i) => {
        console.log(`Log ${i}:`, {
          address: log.address,
          topics: log.topics,
          data: log.data
        });
      });
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.data) {
      console.error('Error data:', error.data);
    }
  }
}

main().catch(console.error);