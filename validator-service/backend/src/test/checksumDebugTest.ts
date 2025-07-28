// Debug the checksum issue
import dotenv from 'dotenv';
dotenv.config();

import { ethers } from 'ethers';
import { logger } from '../utils/logger';

async function debugChecksum() {
  logger.info('🔍 Debugging address checksum issue');
  
  // Test various address formats
  const addresses = [
    '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512', // From deployment
    '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512', // All lowercase
    '0xE7F1725E7734CE288F8367E1BB143E90BB3F0512', // All uppercase
  ];
  
  const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  
  for (const addr of addresses) {
    logger.info(`Testing address: ${addr}`);
    
    try {
      const checksummed = ethers.getAddress(addr);
      logger.info(`✅ Checksum valid: ${checksummed}`);
      
      // Test contract code exists
      const code = await provider.getCode(checksummed);
      logger.info(`Contract code exists: ${code !== '0x'}`);
      
    } catch (error: any) {
      logger.error(`❌ Checksum failed: ${error.message}`);
    }
  }
  
  // Test the actual address from deployment file
  const fs = require('fs');
  const path = require('path');
  
  try {
    const deploymentPath = path.join(process.cwd(), '../../deployment-local.json');
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    const deployedAddr = deployment.contracts.MultiSigWallet;
    
    logger.info(`\nDeployment file address: ${deployedAddr}`);
    
    const checksummed = ethers.getAddress(deployedAddr);
    logger.info(`✅ Deployment address checksum valid: ${checksummed}`);
    
    // Test creating contract
    const abi = ['function getOwners() view returns (address[])'];
    const contract = new ethers.Contract(checksummed, abi, provider);
    const owners = await contract.getOwners();
    logger.info(`✅ Contract call successful, owners: ${owners.length}`);
    
  } catch (error: any) {
    logger.error(`❌ Deployment address test failed: ${error.message}`);
  }
}

// Run the test
if (require.main === module) {
  debugChecksum().catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

export default debugChecksum;