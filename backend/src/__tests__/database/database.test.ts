// Critical database operation tests
import { Database } from '../../database';
import { logger, cleanupTestData } from '../setup';
import { TestDataGenerator, DatabaseTestHelpers } from '../helpers/testUtils';
import { NetworkType, WalletType } from '@multisig-validator/shared';

describe('Database Operations', () => {
  let db: Database;
  let dbHelpers: DatabaseTestHelpers;

  beforeAll(async () => {
    db = new Database(logger);
    dbHelpers = new DatabaseTestHelpers(db);
    
    // Ensure database is healthy
    const isHealthy = await db.healthCheck();
    expect(isHealthy).toBe(true);
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await db.close();
  });

  describe('Database Health and Connection', () => {
    it('should establish connection successfully', async () => {
      const isHealthy = await db.healthCheck();
      expect(isHealthy).toBe(true);
    });

    it('should handle query execution with proper logging', async () => {
      const result = await db.query('SELECT 1 as test');
      expect(result).toHaveLength(1);
      expect(result[0].test).toBe(1);
    });

    it('should handle queryOne for single result', async () => {
      const result = await db.queryOne('SELECT 1 as test');
      expect(result).toEqual({ test: 1 });
    });

    it('should handle queryOne for no results', async () => {
      const result = await db.queryOne('SELECT 1 as test WHERE false');
      expect(result).toBeNull();
    });

    it('should handle transaction rollback on error', async () => {
      const testWallet = TestDataGenerator.generateTestWallet();
      
      await expect(
        db.transaction(async (client) => {
          // Insert a valid wallet
          await client.query(`
            INSERT INTO wallets (address, name, network, type, owners, required, balance, registered_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [
            testWallet.address,
            testWallet.name,
            testWallet.network,
            testWallet.type,
            JSON.stringify(testWallet.owners),
            testWallet.required,
            testWallet.balance.toString(),
            testWallet.registeredBy
          ]);
          
          // This should cause an error and rollback the transaction
          await client.query('INSERT INTO wallets (address) VALUES ($1)', ['invalid']);
        })
      ).rejects.toThrow();
      
      // Verify the wallet was not inserted due to rollback
      const wallet = await db.queryOne('SELECT * FROM wallets WHERE address = $1', [testWallet.address]);
      expect(wallet).toBeNull();
    });
  });

  describe('Wallet Database Operations', () => {
    it('should insert wallet with all required fields', async () => {
      const testWallet = TestDataGenerator.generateTestWallet();
      const walletId = await dbHelpers.insertTestWallet(testWallet);
      
      expect(walletId).toBeDefined();
      
      const insertedWallet = await dbHelpers.getWalletById(walletId);
      expect(insertedWallet).toBeDefined();
      expect(insertedWallet.address).toBe(testWallet.address);
      expect(insertedWallet.name).toBe(testWallet.name);
      expect(insertedWallet.network).toBe(testWallet.network);
      expect(insertedWallet.type).toBe(testWallet.type);
      expect(JSON.parse(insertedWallet.owners)).toEqual(testWallet.owners);
      expect(insertedWallet.required).toBe(testWallet.required);
      expect(insertedWallet.balance).toBe(testWallet.balance.toString());
      expect(insertedWallet.registered_by).toBe(testWallet.registeredBy);
    });

    it('should handle wallet upsert on conflict', async () => {
      const testWallet = TestDataGenerator.generateTestWallet();
      
      // Insert wallet first time
      const walletId1 = await dbHelpers.insertTestWallet(testWallet);
      
      // Update wallet with same address and network
      const updatedWallet = {
        ...testWallet,
        name: 'Updated Test Wallet',
        balance: testWallet.balance * 2n
      };
      
      // This should not throw due to conflict handling
      await db.query(`
        INSERT INTO wallets (address, name, network, type, owners, required, balance, registered_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (address, network) 
        DO UPDATE SET 
          name = EXCLUDED.name,
          balance = EXCLUDED.balance,
          last_sync = NOW()
      `, [
        updatedWallet.address,
        updatedWallet.name,
        updatedWallet.network,
        updatedWallet.type,
        JSON.stringify(updatedWallet.owners),
        updatedWallet.required,
        updatedWallet.balance.toString(),
        updatedWallet.registeredBy
      ]);
      
      const finalWallet = await dbHelpers.getWalletById(walletId1);
      expect(finalWallet.name).toBe('Updated Test Wallet');
      expect(finalWallet.balance).toBe((testWallet.balance * 2n).toString());
    });

    it('should enforce unique constraint on address+network', async () => {
      const testWallet = TestDataGenerator.generateTestWallet();
      
      // Insert wallet first time
      await dbHelpers.insertTestWallet(testWallet);
      
      // Try to insert same wallet again without conflict handling
      await expect(
        db.query(`
          INSERT INTO wallets (address, name, network, type, owners, required, balance, registered_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          testWallet.address,
          'Duplicate Wallet',
          testWallet.network,
          testWallet.type,
          JSON.stringify(testWallet.owners),
          testWallet.required,
          testWallet.balance.toString(),
          testWallet.registeredBy
        ])
      ).rejects.toThrow();
    });
  });

  describe('Transaction Database Operations', () => {
    let walletId: string;

    beforeEach(async () => {
      const testWallet = TestDataGenerator.generateTestWallet();
      walletId = await dbHelpers.insertTestWallet(testWallet);
    });

    it('should insert transaction record successfully', async () => {
      const testTransaction = TestDataGenerator.generateTestTransaction(walletId);
      const transactionId = await dbHelpers.insertTestTransaction(testTransaction);
      
      expect(transactionId).toBeDefined();
      
      const insertedTransaction = await dbHelpers.getTransactionById(transactionId);
      expect(insertedTransaction).toBeDefined();
      expect(insertedTransaction.wallet_id).toBe(walletId);
      expect(insertedTransaction.transaction_id).toBe(testTransaction.transactionId);
      expect(insertedTransaction.action).toBe(testTransaction.action);
      expect(insertedTransaction.submitter).toBe(testTransaction.submitter);
      expect(insertedTransaction.destination).toBe(testTransaction.destination);
      expect(insertedTransaction.value).toBe(testTransaction.value.toString());
      expect(insertedTransaction.validation_status).toBe(testTransaction.validationStatus);
      expect(insertedTransaction.risk_score).toBe(testTransaction.riskScore);
      expect(insertedTransaction.execution_status).toBe(testTransaction.executionStatus);
    });

    it('should enforce foreign key constraint with wallet', async () => {
      const testTransaction = TestDataGenerator.generateTestTransaction('invalid-wallet-id');
      
      await expect(
        dbHelpers.insertTestTransaction(testTransaction)
      ).rejects.toThrow();
    });

    it('should handle transaction status updates', async () => {
      const testTransaction = TestDataGenerator.generateTestTransaction(walletId);
      const transactionId = await dbHelpers.insertTestTransaction(testTransaction);
      
      // Update transaction status to executed
      await db.query(`
        UPDATE transactions 
        SET execution_status = 'executed', executed_at = NOW() 
        WHERE id = $1
      `, [transactionId]);
      
      const updatedTransaction = await dbHelpers.getTransactionById(transactionId);
      expect(updatedTransaction.execution_status).toBe('executed');
      expect(updatedTransaction.executed_at).not.toBeNull();
    });

    it('should store confirmations as JSONB', async () => {
      const confirmations = [
        { owner: '0xowner1', confirmedAt: new Date().toISOString() },
        { owner: '0xowner2', confirmedAt: new Date().toISOString() }
      ];
      
      const testTransaction = TestDataGenerator.generateTestTransaction(walletId, {
        confirmations
      });
      
      const transactionId = await dbHelpers.insertTestTransaction(testTransaction);
      const insertedTransaction = await dbHelpers.getTransactionById(transactionId);
      
      expect(JSON.parse(insertedTransaction.confirmations)).toEqual(confirmations);
    });

    it('should handle decimal values correctly', async () => {
      const largeValue = BigInt('1000000000000000000000'); // 1000 ETH
      const testTransaction = TestDataGenerator.generateTestTransaction(walletId, {
        value: largeValue,
        walletBalance: largeValue * 10n
      });
      
      const transactionId = await dbHelpers.insertTestTransaction(testTransaction);
      const insertedTransaction = await dbHelpers.getTransactionById(transactionId);
      
      expect(insertedTransaction.value).toBe(largeValue.toString());
      expect(insertedTransaction.wallet_balance).toBe((largeValue * 10n).toString());
    });
  });

  describe('Alert Database Operations', () => {
    let walletId: string;
    let transactionId: string;

    beforeEach(async () => {
      const testWallet = TestDataGenerator.generateTestWallet();
      walletId = await dbHelpers.insertTestWallet(testWallet);
      
      const testTransaction = TestDataGenerator.generateTestTransaction(walletId);
      transactionId = await dbHelpers.insertTestTransaction(testTransaction);
    });

    it('should insert alert with transaction reference', async () => {
      const testAlert = TestDataGenerator.generateTestAlert(walletId, transactionId);
      const alertId = await dbHelpers.insertTestAlert(testAlert);
      
      expect(alertId).toBeDefined();
      
      const insertedAlert = await dbHelpers.getAlertById(alertId);
      expect(insertedAlert).toBeDefined();
      expect(insertedAlert.wallet_id).toBe(walletId);
      expect(insertedAlert.transaction_id).toBe(transactionId);
      expect(insertedAlert.priority).toBe(testAlert.priority);
      expect(insertedAlert.type).toBe(testAlert.type);
      expect(insertedAlert.risk_level).toBe(testAlert.riskLevel);
      expect(insertedAlert.status).toBe(testAlert.status);
    });

    it('should insert alert without transaction reference', async () => {
      const testAlert = TestDataGenerator.generateTestAlert(walletId);
      const alertId = await dbHelpers.insertTestAlert(testAlert);
      
      const insertedAlert = await dbHelpers.getAlertById(alertId);
      expect(insertedAlert.transaction_id).toBeNull();
    });

    it('should handle alert status updates', async () => {
      const testAlert = TestDataGenerator.generateTestAlert(walletId, transactionId);
      const alertId = await dbHelpers.insertTestAlert(testAlert);
      
      // Acknowledge alert
      await db.query(`
        UPDATE alerts 
        SET status = 'acknowledged', acknowledged_by = 'test-user', acknowledged_at = NOW() 
        WHERE id = $1
      `, [alertId]);
      
      const updatedAlert = await dbHelpers.getAlertById(alertId);
      expect(updatedAlert.status).toBe('acknowledged');
      expect(updatedAlert.acknowledged_by).toBe('test-user');
      expect(updatedAlert.acknowledged_at).not.toBeNull();
    });

    it('should store context as JSONB', async () => {
      const context = {
        recipientInfo: { name: 'Unknown Address', riskLevel: 'high' },
        transferAmount: '1000000000000000000',
        previousTransactions: []
      };
      
      const testAlert = TestDataGenerator.generateTestAlert(walletId, transactionId, {
        context
      });
      
      const alertId = await dbHelpers.insertTestAlert(testAlert);
      const insertedAlert = await dbHelpers.getAlertById(alertId);
      
      expect(JSON.parse(insertedAlert.context)).toEqual(context);
    });
  });

  describe('Owner Database Operations', () => {
    it('should insert and update owner records', async () => {
      const ownerAddress = TestDataGenerator.generateTestOwnerAddress();
      const walletAddress = TestDataGenerator.generateTestWalletAddress();
      
      // Insert owner
      await db.query(`
        INSERT INTO owners (
          address, network, first_seen, wallets, transaction_count,
          risk_level, confidence_score, status
        ) VALUES ($1, $2, NOW(), $3, 0, 'medium', 50, 'active')
      `, [
        ownerAddress,
        NetworkType.LOCALHOST,
        JSON.stringify([walletAddress])
      ]);
      
      const owner = await db.queryOne('SELECT * FROM owners WHERE address = $1', [ownerAddress]);
      expect(owner).toBeDefined();
      expect(owner.address).toBe(ownerAddress);
      expect(JSON.parse(owner.wallets)).toEqual([walletAddress]);
      expect(owner.risk_level).toBe('medium');
      expect(owner.confidence_score).toBe(50);
      expect(owner.status).toBe('active');
    });

    it('should handle owner wallet updates', async () => {
      const ownerAddress = TestDataGenerator.generateTestOwnerAddress();
      const wallet1 = TestDataGenerator.generateTestWalletAddress();
      const wallet2 = TestDataGenerator.generateTestWalletAddress();
      
      // Insert owner with first wallet
      await db.query(`
        INSERT INTO owners (address, network, wallets)
        VALUES ($1, $2, $3)
      `, [ownerAddress, NetworkType.LOCALHOST, JSON.stringify([wallet1])]);
      
      // Update to add second wallet
      await db.query(`
        UPDATE owners 
        SET wallets = CASE 
          WHEN NOT (wallets::jsonb @> $3::jsonb)
          THEN (wallets::jsonb || $3::jsonb)
          ELSE wallets::jsonb 
        END,
        updated_at = NOW()
        WHERE address = $1 AND network = $2
      `, [ownerAddress, NetworkType.LOCALHOST, JSON.stringify([wallet2])]);
      
      const owner = await db.queryOne('SELECT * FROM owners WHERE address = $1', [ownerAddress]);
      const wallets = JSON.parse(owner.wallets);
      expect(wallets).toContain(wallet1);
      expect(wallets).toContain(wallet2);
    });
  });

  describe('Database Indexes and Performance', () => {
    beforeEach(async () => {
      // Create multiple test records for performance testing
      const wallet = TestDataGenerator.generateTestWallet();
      const walletId = await dbHelpers.insertTestWallet(wallet);
      
      // Insert multiple transactions
      for (let i = 0; i < 10; i++) {
        const transaction = TestDataGenerator.generateTestTransaction(walletId, {
          transactionId: i,
          submittedAt: new Date(Date.now() - i * 60000) // Spread over time
        });
        await dbHelpers.insertTestTransaction(transaction);
      }
    });

    it('should efficiently query transactions by wallet', async () => {
      const startTime = Date.now();
      const transactions = await db.query(`
        SELECT * FROM transactions 
        WHERE wallet_id = (SELECT id FROM wallets LIMIT 1)
        ORDER BY submitted_at DESC
      `);
      const queryTime = Date.now() - startTime;
      
      expect(transactions.length).toBe(10);
      expect(queryTime).toBeLessThan(100); // Should be fast with index
    });

    it('should efficiently query by validation status', async () => {
      const startTime = Date.now();
      const pendingTransactions = await db.query(`
        SELECT * FROM transactions 
        WHERE validation_status = 'pending'
      `);
      const queryTime = Date.now() - startTime;
      
      expect(pendingTransactions.length).toBeGreaterThan(0);
      expect(queryTime).toBeLessThan(100);
    });

    it('should efficiently use time-based queries', async () => {
      const startTime = Date.now();
      const recentTransactions = await db.query(`
        SELECT * FROM transactions 
        WHERE submitted_at > NOW() - INTERVAL '1 hour'
      `);
      const queryTime = Date.now() - startTime;
      
      expect(recentTransactions.length).toBeGreaterThan(0);
      expect(queryTime).toBeLessThan(100);
    });
  });

  describe('Database Schema Validation', () => {
    it('should enforce NOT NULL constraints', async () => {
      await expect(
        db.query('INSERT INTO wallets (name) VALUES ($1)', ['Test'])
      ).rejects.toThrow();
    });

    it('should enforce CHECK constraints on risk_score', async () => {
      const wallet = TestDataGenerator.generateTestWallet();
      const walletId = await dbHelpers.insertTestWallet(wallet);
      
      await expect(
        db.query(`
          INSERT INTO transactions (wallet_id, transaction_id, action, submitter, value, wallet_balance, required_confirmations, risk_score)
          VALUES ($1, 1, 'transfer', '0xtest', '1000', '10000', 2, 15)
        `, [walletId])
      ).rejects.toThrow(); // risk_score must be <= 10
    });

    it('should enforce enum constraints', async () => {
      const wallet = TestDataGenerator.generateTestWallet();
      const walletId = await dbHelpers.insertTestWallet(wallet);
      
      await expect(
        db.query(`
          INSERT INTO transactions (wallet_id, transaction_id, action, submitter, value, wallet_balance, required_confirmations)
          VALUES ($1, 1, 'invalid_action', '0xtest', '1000', '10000', 2)
        `, [walletId])
      ).rejects.toThrow(); // invalid action type
    });

    it('should validate JSON structure', async () => {
      const wallet = TestDataGenerator.generateTestWallet();
      
      // This should work with valid JSON
      const walletId = await db.query(`
        INSERT INTO wallets (address, name, network, type, owners, required, balance, registered_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [
        wallet.address,
        wallet.name,
        wallet.network,
        wallet.type,
        JSON.stringify(wallet.owners),
        wallet.required,
        wallet.balance.toString(),
        wallet.registeredBy
      ]);
      
      expect(walletId[0].id).toBeDefined();
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent wallet insertions', async () => {
      const promises = [];
      
      for (let i = 0; i < 5; i++) {
        const wallet = TestDataGenerator.generateTestWallet();
        promises.push(dbHelpers.insertTestWallet(wallet));
      }
      
      const walletIds = await Promise.all(promises);
      expect(walletIds).toHaveLength(5);
      expect(new Set(walletIds).size).toBe(5); // All unique
    });

    it('should handle concurrent transaction insertions', async () => {
      const wallet = TestDataGenerator.generateTestWallet();
      const walletId = await dbHelpers.insertTestWallet(wallet);
      
      const promises = [];
      for (let i = 0; i < 10; i++) {
        const transaction = TestDataGenerator.generateTestTransaction(walletId, {
          transactionId: i
        });
        promises.push(dbHelpers.insertTestTransaction(transaction));
      }
      
      const transactionIds = await Promise.all(promises);
      expect(transactionIds).toHaveLength(10);
      
      const count = await dbHelpers.countTransactions(walletId);
      expect(count).toBe(10);
    });
  });
});