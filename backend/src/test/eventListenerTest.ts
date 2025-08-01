// Test script for MultiSig Event Listener
import dotenv from 'dotenv';
dotenv.config();

import winston from 'winston';
import { MultiSigEventListener, WalletConfig } from '../blockchain/eventListener';
import { ContractFactory } from '../blockchain/contracts';
import { NetworkType, WalletType } from '@multisig-validator/shared';
import config from '../config';

// Create a simple console logger for testing
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

async function testEventListener() {
  logger.info('🚀 Starting MultiSig Event Listener Test');
  
  try {
    // 1. Test contract factory
    logger.info('📡 Testing Contract Factory...');
    const contractFactory = new ContractFactory(config.blockchain.networks);
    
    // Test wallet addresses from our deployment
    const testWallets = [
      {
        address: '0x9f39A39631b2E49B59A614D37465431890612b5a',
        network: NetworkType.SEPOLIA,
        name: 'Test MultiSig Wallet',
      },
      {
        address: '0xbdb8ed781577405f3FaEa59b33bA2fb05179ee61',
        network: NetworkType.SEPOLIA,
        name: 'Test MultiSig Wallet with Daily Limit',
      },
    ];
    
    // Validate contracts exist
    for (const wallet of testWallets) {
      logger.info(`🔍 Validating contract: ${wallet.name}`);
      
      const isValid = await contractFactory.validateContract(wallet.address, wallet.network);
      if (!isValid) {
        throw new Error(`Contract not found: ${wallet.address}`);
      }
      logger.info(`✅ Contract validated: ${wallet.address}`);
      
      // Detect contract type
      const contractType = await contractFactory.detectContractType(wallet.address, wallet.network);
      logger.info(`🔎 Contract type detected: ${contractType}`);
      
      // Get contract details
      const contract = contractFactory.getContract(
        wallet.address,
        wallet.network,
        contractType === 'MultiSigWalletWithDailyLimit'
      );
      
      const owners = await contract.getOwners();
      const required = await contract.getRequired();
      const balance = await contract.getBalance();
      const transactionCount = await contract.getTransactionCount();
      
      logger.info(`📊 Contract Details:`, {
        address: wallet.address,
        owners: owners.length,
        ownerAddresses: owners,
        required,
        balance: `${balance} wei`,
        transactionCount,
      });
      
      // Get daily limit if available
      const dailyLimit = await contract.getDailyLimit();
      if (dailyLimit) {
        logger.info(`💰 Daily Limit: ${dailyLimit} wei`);
      }
    }
    
    // 2. Test event listener
    logger.info('🎧 Testing Event Listener...');
    const eventListener = new MultiSigEventListener(logger);
    
    // Set up event handlers
    eventListener.on('transactionSubmitted', (data) => {
      logger.info('🆕 TRANSACTION SUBMITTED:', {
        wallet: data.wallet.address,
        transactionId: data.submission.transactionId,
        action: data.action,
        submitter: data.submission.submitter,
        destination: data.submission.destination,
        value: data.submission.value,
      });
    });
    
    eventListener.on('transactionConfirmed', (data) => {
      logger.info('✅ TRANSACTION CONFIRMED:', {
        wallet: data.wallet.address,
        transactionId: data.confirmation.transactionId,
        confirmer: data.confirmation.confirmer,
      });
    });
    
    eventListener.on('transactionExecuted', (data) => {
      logger.info('🚀 TRANSACTION EXECUTED:', {
        wallet: data.wallet.address,
        transactionId: data.transactionId,
      });
    });
    
    eventListener.on('ownerAdded', (data) => {
      logger.info('👤 OWNER ADDED:', {
        wallet: data.wallet.address,
        owner: data.change.owner,
      });
    });
    
    eventListener.on('ownerRemoved', (data) => {
      logger.info('👤 OWNER REMOVED:', {
        wallet: data.wallet.address,
        owner: data.change.owner,
      });
    });
    
    eventListener.on('deposit', (data) => {
      logger.info('💰 DEPOSIT RECEIVED:', {
        wallet: data.wallet.address,
        sender: data.deposit.sender,
        value: data.deposit.value,
      });
    });
    
    eventListener.on('error', (error) => {
      logger.error('❌ EVENT LISTENER ERROR:', error);
    });
    
    eventListener.on('walletError', (error) => {
      logger.error('❌ WALLET ERROR:', error);
    });
    
    // Add wallets for monitoring
    logger.info('📝 Adding wallets for monitoring...');
    for (const wallet of testWallets) {
      const walletConfig: WalletConfig = {
        address: wallet.address,
        network: wallet.network,
        type: wallet.address === '0xbdb8ed781577405f3FaEa59b33bA2fb05179ee61' 
          ? WalletType.MULTISIG_WALLET_WITH_DAILY_LIMIT 
          : WalletType.MULTISIG_WALLET,
        active: true,
        startBlock: 5650000, // Start from a recent block
      };
      
      eventListener.addWallet(walletConfig);
      logger.info(`✅ Added wallet: ${wallet.name} (${wallet.address})`);
    }
    
    // Start event listener
    logger.info('🎬 Starting event listener...');
    await eventListener.start();
    
    // Get status
    const status = eventListener.getStatus();
    logger.info('📊 Event Listener Status:', status);
    
    // Get current blocks
    const currentBlocks = await eventListener.getCurrentBlocks();
    logger.info('🧱 Current Blocks:', currentBlocks);
    
    // 3. Test historical events
    logger.info('📚 Testing historical event retrieval...');
    for (const wallet of testWallets) {
      try {
        const contract = contractFactory.getContract(
          wallet.address,
          wallet.network,
          wallet.address === '0xbdb8ed781577405f3FaEa59b33bA2fb05179ee61'
        );
        
        // Get recent events (last 1000 blocks)
        const provider = contractFactory.getProvider(wallet.network);
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, currentBlock - 1000);
        
        logger.info(`🔍 Checking events for ${wallet.name} from block ${fromBlock} to ${currentBlock}`);
        
        const events = await contract.getAllEvents(fromBlock, currentBlock);
        logger.info(`📋 Found ${events.length} historical events for ${wallet.name}`);
        
        // Log first few events
        for (const event of events.slice(0, 5)) {
          logger.info(`📝 Event: ${event.event}`, {
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
            args: event.args,
          });
        }
        
      } catch (error) {
        logger.warn(`⚠️ Could not retrieve historical events for ${wallet.name}:`, error);
      }
    }
    
    // Keep running to monitor for new events
    logger.info('👀 Monitoring for new events... (Press Ctrl+C to stop)');
    logger.info('💡 Try creating a transaction on one of the wallets to see real-time monitoring!');
    
    // Set up graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('🛑 Shutting down event listener...');
      await eventListener.stop();
      logger.info('✅ Event listener stopped');
      process.exit(0);
    });
    
    // Keep the process running
    await new Promise(() => {}); // Run indefinitely
    
  } catch (error) {
    logger.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testEventListener().catch((error) => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}

export default testEventListener;