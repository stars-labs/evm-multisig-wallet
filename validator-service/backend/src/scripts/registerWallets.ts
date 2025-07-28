// Script to register monitored wallets in the database
import dotenv from 'dotenv';
dotenv.config();

import { Database } from '../database';
import { logger } from '../utils/logger';
import { NetworkType, WalletType } from '@multisig-validator/shared';

interface WalletToRegister {
  address: string;
  name: string;
  description: string;
  network: NetworkType;
  type: WalletType;
}

const walletsToRegister: WalletToRegister[] = [
  {
    address: '0x9f39A39631b2E49B59A614D37465431890612b5a',
    name: 'Test MultiSig Wallet',
    description: 'Basic multisig wallet deployed for testing',
    network: NetworkType.SEPOLIA,
    type: WalletType.MULTISIG_WALLET,
  },
  {
    address: '0xbdb8ed781577405f3FaEa59b33bA2fb05179ee61',
    name: 'Test MultiSig Wallet with Daily Limit',
    description: 'Multisig wallet with daily spending limit deployed for testing',
    network: NetworkType.SEPOLIA,
    type: WalletType.MULTISIG_WALLET_WITH_DAILY_LIMIT,
  },
];

async function registerWallets() {
  logger.info('🚀 Starting wallet registration');
  
  const db = new Database(logger);
  
  try {
    // Test database connection
    const isHealthy = await db.healthCheck();
    if (!isHealthy) {
      throw new Error('Database connection failed');
    }
    logger.info('✅ Database connection successful');
    
    for (const wallet of walletsToRegister) {
      logger.info(`📝 Registering wallet: ${wallet.name} (${wallet.address})`);
      
      // Check if wallet already exists
      const existing = await db.queryOne(
        'SELECT id FROM wallets WHERE address = $1 AND network = $2',
        [wallet.address.toLowerCase(), wallet.network]
      );
      
      if (existing) {
        logger.info(`⚠️  Wallet already exists: ${wallet.address}`);
        continue;
      }
      
      // Default values for new wallet
      const owners: string[] = ['0xF9B9d028818496894267eBD3B3eA3c537d24f9B5', '0x855c9E5aC7431df8524F964ab3A0F4805469049f', '0x4eA8869eF1a9Bf454172BBAec3586AdcAFCE86d9'];
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
          wallet.address.toLowerCase(),
          wallet.name,
          wallet.description,
          wallet.network,
          wallet.type,
          JSON.stringify(owners),
          2, // required signatures
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
    const walletCount = await db.queryOne('SELECT COUNT(*) as count FROM wallets WHERE monitored = true');
    logger.info(`📊 Total monitored wallets: ${walletCount.count}`);
    
    logger.info('🎉 Wallet registration completed successfully');
    
  } catch (error) {
    logger.error('❌ Failed to register wallets:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Run the registration
if (require.main === module) {
  registerWallets().catch((error) => {
    console.error('Registration failed:', error);
    process.exit(1);
  });
}

export default registerWallets;