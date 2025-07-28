// Test script to check if localhost events are being processed
import dotenv from 'dotenv';
dotenv.config();

import { Database } from '../database';
import { MultiSigContract, ContractFactory } from '../blockchain/contracts';
import { logger } from '../utils/logger';
import { NetworkType } from '@multisig-validator/shared';
import config from '../config';

async function testLocalhostEventProcessing() {
  logger.info('🔍 Testing localhost event processing');
  
  const db = new Database(logger);
  
  try {
    // Test database connection
    const isHealthy = await db.healthCheck();
    if (!isHealthy) {
      throw new Error('Database connection failed');
    }
    logger.info('✅ Database connection successful');
    
    // Create contract factory
    const contractFactory = new ContractFactory({
      localhost: { rpcUrl: 'http://127.0.0.1:8545' }
    });
    
    // Get localhost wallet from database
    const wallet = await db.queryOne(`
      SELECT address, type FROM wallets 
      WHERE network = $1 AND monitored = true 
      LIMIT 1
    `, [NetworkType.LOCALHOST]);
    
    if (!wallet) {
      throw new Error('No localhost wallet found in database');
    }
    
    logger.info(`📋 Testing wallet: ${wallet.address}`);
    
    // Get contract instance
    const contract = contractFactory.getContract(
      wallet.address,
      'localhost',
      wallet.type === 'MultiSigWalletWithDailyLimit'
    );
    
    // Get current block number
    const provider = contractFactory.getProvider('localhost');
    const currentBlock = await provider.getBlockNumber();
    logger.info(`📊 Current block: ${currentBlock}`);
    
    // Check recent events
    logger.info('🔍 Checking recent events...');
    const events = await contract.getAllEvents(Math.max(0, currentBlock - 20), currentBlock);
    logger.info(`Found ${events.length} events in last 20 blocks`);
    
    for (const event of events) {
      logger.info(`Event: ${event.event} at block ${event.blockNumber}`, {
        args: event.args,
        txHash: event.transactionHash
      });
      
      if (event.event === 'Submission') {
        const txId = Number(event.args[0] || event.args.transactionId);
        logger.info(`Getting transaction details for ID: ${txId}`);
        
        try {
          const txDetails = await contract.getTransaction(txId);
          logger.info('Transaction details:', txDetails);
        } catch (error) {
          logger.error(`Failed to get transaction ${txId}:`, error);
        }
      }
    }
    
    // Check database for transactions
    logger.info('🔍 Checking database for stored transactions...');
    const dbTransactions = await db.query(`
      SELECT t.transaction_id, w.address, t.action, t.block_number, t.submitted_at
      FROM transactions t 
      JOIN wallets w ON t.wallet_id = w.id 
      WHERE w.network = $1
      ORDER BY t.submitted_at DESC
      LIMIT 5
    `, [NetworkType.LOCALHOST]);
    
    logger.info(`Found ${dbTransactions.length} transactions in database`);
    for (const tx of dbTransactions) {
      logger.info(`DB Transaction: ID=${tx.transaction_id}, Action=${tx.action}, Block=${tx.block_number}`);
    }
    
    logger.info('✅ Test completed');
    
  } catch (error) {
    logger.error('❌ Test failed:', error);
  } finally {
    await db.close();
  }
}

// Run the test
if (require.main === module) {
  testLocalhostEventProcessing().catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

export default testLocalhostEventProcessing;