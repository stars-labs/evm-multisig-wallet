// Test setup and global configuration
import winston from 'winston';
import { Database } from '../database';
import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Global test timeout
jest.setTimeout(30000);

// Suppress console logs during tests unless explicitly needed
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'error',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      silent: process.env.NODE_ENV === 'test' && !process.env.DEBUG_TESTS
    })
  ]
});

// Global database instance for tests
let testDb: Database;

beforeAll(async () => {
  // Create test database connection
  testDb = new Database(logger);
  
  // Ensure database is healthy
  const isHealthy = await testDb.healthCheck();
  if (!isHealthy) {
    throw new Error('Test database is not available. Please ensure PostgreSQL is running and configured correctly.');
  }
  
  // Clean up any existing test data
  await cleanupTestData();
});

afterAll(async () => {
  // Clean up test data
  await cleanupTestData();
  
  // Close database connection
  if (testDb) {
    await testDb.close();
  }
});

// Clean up function to remove test data
async function cleanupTestData(): Promise<void> {
  if (!testDb) return;
  
  try {
    // Delete in order to respect foreign key constraints
    await testDb.query('DELETE FROM notifications WHERE 1=1');
    await testDb.query('DELETE FROM alerts WHERE 1=1');
    await testDb.query('DELETE FROM transactions WHERE 1=1');
    await testDb.query('DELETE FROM owners WHERE address LIKE \'0xtest%\' OR address LIKE \'0xTEST%\'');
    await testDb.query('DELETE FROM recipients WHERE address LIKE \'0xtest%\' OR address LIKE \'0xTEST%\'');
    await testDb.query('DELETE FROM wallets WHERE address LIKE \'0xtest%\' OR address LIKE \'0xTEST%\' OR name LIKE \'Test%\'');
    await testDb.query('DELETE FROM configurations WHERE created_by = \'test\'');
    await testDb.query('DELETE FROM audit_logs WHERE user_id = \'test\'');
    
    logger.debug('Test data cleaned up successfully');
  } catch (error) {
    logger.error('Failed to cleanup test data:', error);
    // Don't throw here as it might interfere with test teardown
  }
}

// Export utilities for use in tests
export {
  testDb,
  logger,
  cleanupTestData
};

// Global test utilities
global.testDb = testDb;
global.logger = logger;
global.cleanupTestData = cleanupTestData;