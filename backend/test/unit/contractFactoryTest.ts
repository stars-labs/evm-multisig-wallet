// Test script to debug ContractFactory localhost provider issue
import dotenv from 'dotenv';
dotenv.config();

import { ContractFactory } from '../blockchain/contracts';
import { logger } from '../utils/logger';
import config from '../config';
import { ethers } from 'ethers';

async function testContractFactory() {
  logger.info('🔍 Testing ContractFactory with localhost');
  
  try {
    // Create contract factory with config networks
    logger.info('Config networks:', Object.keys(config.blockchain.networks));
    const contractFactory = new ContractFactory(config.blockchain.networks);
    
    // Test localhost provider
    logger.info('Testing localhost provider...');
    const localhostProvider = contractFactory.getProvider('localhost');
    logger.info('✅ Localhost provider created successfully');
    
    // Test connection
    const blockNumber = await localhostProvider.getBlockNumber();
    logger.info(`✅ Localhost provider connected, current block: ${blockNumber}`);
    
    // Test contract creation  
    const walletAddress = '0xe7f1725E7734CE288F8367e1Bb143E90bb3f0512';
    logger.info(`Testing contract creation for wallet: ${walletAddress}`);
    
    const contract = contractFactory.getContract(walletAddress, 'localhost', false);
    logger.info('✅ Contract created successfully');
    
    // Test basic contract call
    const owners = await contract.getOwners();
    logger.info(`✅ Contract call successful, owners: ${owners.length}`);
    
    logger.info('🎉 All tests passed!');
    
  } catch (error) {
    logger.error('❌ Test failed:', error);
  }
}

// Run the test
if (require.main === module) {
  testContractFactory().catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

export default testContractFactory;