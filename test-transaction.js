// Test script to submit a transaction to the MultiSig wallet
const { ethers } = require("hardhat");

async function main() {
    // Contract address from deployment
    const contractAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
    
    // Get signers
    const [owner1, owner2, owner3] = await ethers.getSigners();
    
    console.log("Submitting transaction from:", owner1.address);
    console.log("Contract address:", contractAddress);
    
    // Get contract instance
    const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
    const wallet = MultiSigWallet.attach(contractAddress);
    
    // Submit a transaction
    const destination = owner3.address; // Send to third owner
    const value = ethers.parseEther("0.1"); // 0.1 ETH
    const data = "0x"; // Empty data
    
    console.log("Submitting transaction:");
    console.log("- Destination:", destination);
    console.log("- Value:", ethers.formatEther(value), "ETH");
    
    try {
        const tx = await wallet.connect(owner1).submitTransaction(destination, value, data);
        console.log("Transaction submitted!");
        console.log("- Transaction hash:", tx.hash);
        
        const receipt = await tx.wait();
        console.log("- Block number:", receipt.blockNumber);
        console.log("- Gas used:", receipt.gasUsed.toString());
        
        // Check all events in receipt
        console.log("- Receipt logs count:", receipt.logs.length);
        if (receipt.logs.length > 0) {
            receipt.logs.forEach((log, index) => {
                console.log(`  Log ${index}:`, {
                    address: log.address,
                    topics: log.topics,
                    data: log.data
                });
            });
        }
        
        // Get transaction ID from events
        const submissionEvent = receipt.logs.find(log => 
            log.topics[0] === ethers.id("Submission(uint256)")
        );
        
        if (submissionEvent) {
            const transactionId = parseInt(submissionEvent.topics[1], 16);
            console.log("- Transaction ID:", transactionId);
        } else {
            console.log("- No Submission event found");
        }
        
    } catch (error) {
        console.error("Error submitting transaction:", error);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });