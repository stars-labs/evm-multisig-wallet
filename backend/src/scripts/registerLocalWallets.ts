// Register local development wallets in the database
import dotenv from 'dotenv';
dotenv.config();

import { Database } from '../database';
import { logger } from '../utils/logger';
import { NetworkType, WalletType } from '@multisig-validator/shared';
import fs from 'fs';
import path from 'path';

async function registerLocalWallets() {
  logger.info('🚀 Registering local development wallets');
  
  const db = new Database(logger);
  
  try {
    // Test database connection
    const isHealthy = await db.healthCheck();
    if (!isHealthy) {
      throw new Error('Database connection failed');
    }
    logger.info('✅ Database connection successful');
    
    // Read deployment info
    const deploymentPath = path.join(process.cwd(), '../../deployment-local.json');
    if (!fs.existsSync(deploymentPath)) {
      throw new Error(`deployment-local.json not found at ${deploymentPath}. Run deployment first.`);
    }
    
    const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    logger.info('📄 Loaded deployment info:', deploymentInfo.contracts);
    
    const walletsToRegister = [
      {
        address: deploymentInfo.contracts.MultiSigWallet,
        name: 'Local MultiSig Wallet',
        description: 'Basic multisig wallet deployed to local Hardhat network',
        network: NetworkType.LOCALHOST,
        type: WalletType.MULTISIG_WALLET,
      },
      {
        address: deploymentInfo.contracts.MultiSigWalletWithDailyLimit,
        name: 'Local MultiSig Wallet with Daily Limit',
        description: 'Multisig wallet with daily spending limit deployed to local Hardhat network',
        network: NetworkType.LOCALHOST,
        type: WalletType.MULTISIG_WALLET_WITH_DAILY_LIMIT,
      },
    ];
    
    // Clear existing localhost wallets first
    await db.query(
      'DELETE FROM wallets WHERE network = $1',
      [NetworkType.LOCALHOST]
    );
    logger.info('🗑️ Cleared existing localhost wallets');
    
    for (const wallet of walletsToRegister) {
      logger.info(`📝 Registering wallet: ${wallet.name} (${wallet.address})`);
      
      // Default values for new wallet
      const owners: string[] = deploymentInfo.owners;
      const alertThresholds = {
        transferPercentage: 10,
        rapidTransactionCount: 3,
        rapidTransactionWindow: 3600,
        dailyLimitIncreasePercent: 50,
        unknownRecipientAlert: true,
        ownerChangeAlert: true,
        requirementChangeAlert: true
      };
      const contactList: any[] = [];
      const notificationChannels: string[] = ['email'];
      
      // Insert wallet record
      const result = await db.queryOne(
        `INSERT INTO wallets (
          address, name, description, network, type, owners, required, 
          daily_limit, balance, monitored, alert_thresholds, contact_list, 
          notification_channels, registered_by, registered_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        ) RETURNING id`,
        [
          wallet.address, // Keep original checksum
          wallet.name,
          wallet.description,
          wallet.network,
          wallet.type,
          JSON.stringify(owners),
          deploymentInfo.required, // required signatures
          null, // daily_limit (null for basic multisig)
          '0', // initial balance
          true, // monitored
          JSON.stringify(alertThresholds),
          JSON.stringify(contactList),
          JSON.stringify(notificationChannels),
          'system', // registered_by
          new Date().toISOString()
        ]
      );
      
      logger.info(`✅ Wallet registered with ID: ${result.id}`);
    }
    
    // Verify registration
    const walletCount = await db.queryOne(
      'SELECT COUNT(*) as count FROM wallets WHERE network = $1 AND monitored = true',
      [NetworkType.LOCALHOST]
    );
    logger.info(`📊 Total monitored localhost wallets: ${walletCount.count}`);
    
    logger.info('🎉 Local wallet registration completed successfully');
    
    // Display summary
    logger.info('\n📋 Registered Wallets:');
    for (const wallet of walletsToRegister) {
      logger.info(`  ${wallet.name}: ${wallet.address}`);
    }
    logger.info(`\n🌐 Network: localhost (chainId: ${deploymentInfo.chainId})`);
    logger.info(`🔗 RPC URL: ${deploymentInfo.rpcUrl}`);
    
  } catch (error) {
    logger.error('❌ Failed to register local wallets:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Run the registration
if (require.main === module) {
  registerLocalWallets().catch((error) => {
    console.error('Registration failed:', error);
    process.exit(1);
  });
}

export default registerLocalWallets;