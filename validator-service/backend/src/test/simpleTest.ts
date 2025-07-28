// Simple test to verify the event listener works without database
import dotenv from 'dotenv';
dotenv.config();

import { ethers } from 'ethers';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      let output = `${timestamp} ${level}: ${message}`;
      if (Object.keys(meta).length > 0) {
        output += ` ${JSON.stringify(meta, null, 2)}`;
      }
      return output;
    })
  ),
  transports: [new winston.transports.Console()],
});

// MultiSig Wallet ABI (simplified)
const MULTISIG_ABI = [
  'event Submission(uint indexed transactionId)',
  'event Confirmation(address indexed sender, uint indexed transactionId)',
  'event Execution(uint indexed transactionId)',
  'event OwnerAddition(address indexed owner)',
  'event OwnerRemoval(address indexed owner)',
  'function getOwners() view returns (address[])',
  'function required() view returns (uint)',
  'function transactionCount() view returns (uint)',
];

async function testBasicConnection() {
  logger.info('🚀 Testing Basic MultiSig Connection');
  
  try {
    // Setup provider
    const rpcUrl = process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/76b6da167a1a45ecb381010150ee9d31';
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    
    logger.info('📡 Connected to Sepolia network');
    
    // Test wallet addresses
    const wallets = [
      {
        address: '0x9f39A39631b2E49B59A614D37465431890612b5a',
        name: 'MultiSig Wallet',
      },
      {
        address: '0xbdb8ed781577405f3FaEa59b33bA2fb05179ee61',
        name: 'MultiSig Wallet with Daily Limit',
      },
    ];
    
    for (const wallet of wallets) {
      logger.info(`\n🔍 Testing ${wallet.name}: ${wallet.address}`);
      
      // Check if contract exists
      const code = await provider.getCode(wallet.address);
      if (code === '0x') {
        logger.error(`❌ No contract found at ${wallet.address}`);
        continue;
      }
      logger.info('✅ Contract code found');
      
      // Create contract instance
      const contract = new ethers.Contract(wallet.address, MULTISIG_ABI, provider);
      
      try {
        // Get basic info
        const owners = await contract.getOwners();
        const required = await contract.required();
        const transactionCount = await contract.transactionCount();
        const balance = await provider.getBalance(wallet.address);
        
        logger.info('📊 Contract Info:', {
          owners: owners.length,
          ownerAddresses: owners,
          required: Number(required),
          transactionCount: Number(transactionCount),
          balance: ethers.formatEther(balance) + ' ETH',
        });
        
        // Get recent events
        logger.info('📚 Checking recent events...');
        
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, currentBlock - 1000);
        
        logger.info(`🔍 Searching from block ${fromBlock} to ${currentBlock}`);
        
        // Get different event types
        const eventTypes = ['Submission', 'Confirmation', 'Execution', 'OwnerAddition', 'OwnerRemoval'];
        
        for (const eventType of eventTypes) {
          try {
            const filter = contract.filters[eventType]();
            const events = await contract.queryFilter(filter, fromBlock);
            
            if (events.length > 0) {
              logger.info(`📝 Found ${events.length} ${eventType} events`);
              
              // Show latest event
              const latestEvent = events[events.length - 1];
              logger.info(`   Latest: Block ${latestEvent.blockNumber}, Tx: ${latestEvent.transactionHash}`);
            } else {
              logger.info(`📝 No ${eventType} events found`);
            }
            
          } catch (error) {
            logger.warn(`⚠️ Could not fetch ${eventType} events:`, error instanceof Error ? error.message : 'Unknown error');
          }
        }
        
        // Set up real-time event listening
        logger.info('👂 Setting up real-time event listeners...');
        
        contract.on('Submission', (transactionId, event) => {
          logger.info('🆕 NEW SUBMISSION:', {
            transactionId: Number(transactionId),
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
          });
        });
        
        contract.on('Confirmation', (sender, transactionId, event) => {
          logger.info('✅ NEW CONFIRMATION:', {
            sender,
            transactionId: Number(transactionId),
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
          });
        });
        
        contract.on('Execution', (transactionId, event) => {
          logger.info('🚀 NEW EXECUTION:', {
            transactionId: Number(transactionId),
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
          });
        });
        
        contract.on('OwnerAddition', (owner, event) => {
          logger.info('👤 NEW OWNER ADDED:', {
            owner,
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
          });
        });
        
        contract.on('OwnerRemoval', (owner, event) => {
          logger.info('👤 OWNER REMOVED:', {
            owner,
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
          });
        });
        
      } catch (error) {
        logger.error(`❌ Error reading contract ${wallet.address}:`, error);
      }
    }
    
    logger.info('\n👀 Listening for real-time events... (Press Ctrl+C to stop)');
    logger.info('💡 Try creating a transaction on one of the wallets to see real-time monitoring!');
    logger.info('🌐 Wallets monitored:');
    logger.info('   • 0x9f39A39631b2E49B59A614D37465431890612b5a (Basic MultiSig)');
    logger.info('   • 0xbdb8ed781577405f3FaEa59b33bA2fb05179ee61 (With Daily Limit)');
    
    // Keep running
    process.on('SIGINT', () => {
      logger.info('\n🛑 Stopping event monitoring...');
      process.exit(0);
    });
    
    // Keep alive
    await new Promise(() => {});
    
  } catch (error) {
    logger.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testBasicConnection();