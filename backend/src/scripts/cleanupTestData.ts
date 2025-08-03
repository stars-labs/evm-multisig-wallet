/**
 * Database Cleanup Script for Testing
 * 
 * Cleans up test data from previous runs:
 * - Removes transactions for test wallets
 * - Resets chain sync state
 * - Clears confirmations
 * 
 * Usage: npx ts-node src/scripts/cleanupTestData.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { Database } from '../database';
import { logger } from '../utils/logger';
import { NetworkType } from '../types';
import fs from 'fs';
import path from 'path';

async function cleanupTestData() {
  const db = new Database(logger);
  
  try {
    logger.info('🧹 Starting test data cleanup...');
    
    // Load deployment info to get wallet addresses
    const deploymentPath = path.join(__dirname, '../../../../deployment-local.json');
    let walletAddresses: string[] = [];
    
    if (fs.existsSync(deploymentPath)) {
      const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
      walletAddresses = [
        deploymentInfo.contracts.MultiSigWallet,
        deploymentInfo.contracts.MultiSigWalletWithDailyLimit
      ].filter(Boolean).map(addr => addr.toLowerCase());
      
      logger.info(`Found ${walletAddresses.length} wallet addresses from deployment`);
    }
    
    // Start transaction
    await db.query('BEGIN');
    
    try {
      // 1. Get wallet IDs for localhost network
      const wallets = await db.query(`
        SELECT id, address 
        FROM wallets 
        WHERE network = $1
      `, [NetworkType.LOCALHOST]);
      
      const walletIds = wallets.map(w => w.id);
      logger.info(`Found ${walletIds.length} localhost wallets in database`);
      
      if (walletIds.length > 0) {
        // 2. Delete confirmations for these wallets
        const confirmationsResult = await db.query(`
          DELETE FROM confirmations 
          WHERE transaction_id IN (
            SELECT id FROM transactions WHERE wallet_id = ANY($1::uuid[])
          )
          RETURNING id
        `, [walletIds]);
        
        logger.info(`Deleted ${confirmationsResult.length} confirmations`);
        
        // 3. Delete transactions for these wallets
        const transactionsResult = await db.query(`
          DELETE FROM transactions 
          WHERE wallet_id = ANY($1::uuid[])
          RETURNING id
        `, [walletIds]);
        
        logger.info(`Deleted ${transactionsResult.length} transactions`);
        
        // 4. Delete events for these wallets
        const eventsResult = await db.query(`
          DELETE FROM events 
          WHERE wallet_id = ANY($1::uuid[])
          RETURNING id
        `, [walletIds]);
        
        logger.info(`Deleted ${eventsResult.length} events`);
      }
      
      // 5. Reset chain sync state for localhost
      const chainResult = await db.query(`
        UPDATE chains 
        SET 
          last_processed_block = 0,
          sync_status = 'stopped',
          last_sync_at = NULL,
          consecutive_errors = 0,
          last_error = NULL,
          last_error_at = NULL
        WHERE network = $1
        RETURNING id
      `, [NetworkType.LOCALHOST]);
      
      if (chainResult.length > 0) {
        logger.info('Reset chain sync state for localhost network');
      }
      
      // 6. If we have new wallet addresses, update existing wallets or prepare for registration
      if (walletAddresses.length > 0) {
        // Update existing wallet addresses if they changed
        for (const address of walletAddresses) {
          const existingWallet = wallets.find(w => 
            w.address.toLowerCase() === address.toLowerCase()
          );
          
          if (!existingWallet) {
            logger.info(`New wallet address ${address} will need to be registered`);
          }
        }
      }
      
      // Commit transaction
      await db.query('COMMIT');
      
      logger.info('✅ Test data cleanup completed successfully');
      
      // Print summary
      logger.info('\n📊 Cleanup Summary:');
      logger.info(`- Wallets processed: ${walletIds.length}`);
      logger.info(`- Transactions deleted: ${transactionsResult?.length || 0}`);
      logger.info(`- Confirmations deleted: ${confirmationsResult?.length || 0}`);
      logger.info(`- Events deleted: ${eventsResult?.length || 0}`);
      logger.info(`- Chain state reset: ${chainResult.length > 0 ? 'Yes' : 'No'}`);
      logger.info('- Ready for fresh test run! 🚀');
      
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    logger.error('Failed to cleanup test data:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Run cleanup if called directly
if (require.main === module) {
  cleanupTestData().catch(error => {
    logger.error('Cleanup failed:', error);
    process.exit(1);
  });
}

export default cleanupTestData;