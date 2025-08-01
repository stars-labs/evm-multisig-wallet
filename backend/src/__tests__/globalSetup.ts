// Global test setup - runs once before all tests
import { config } from 'dotenv';
import path from 'path';

export default async function globalSetup() {
  // Load test environment variables
  config({ path: path.join(__dirname, '..', '..', '.env.test') });
  
  // Ensure NODE_ENV is set to test
  process.env.NODE_ENV = 'test';
  
  // Set test-specific environment variables
  process.env.LOG_LEVEL = 'error'; // Minimize logging during tests
  process.env.SLACK_ENABLED = 'false'; // Disable Slack notifications
  process.env.DB_SSL = 'false'; // Disable SSL for test database
  
  // Set default test database config if not provided
  if (!process.env.TEST_DB_HOST) {
    process.env.TEST_DB_HOST = 'localhost';
  }
  if (!process.env.TEST_DB_PORT) {
    process.env.TEST_DB_PORT = '5432';
  }
  if (!process.env.TEST_DB_USER) {
    process.env.TEST_DB_USER = 'postgres';
  }
  if (!process.env.TEST_DB_PASSWORD) {
    process.env.TEST_DB_PASSWORD = 'test';
  }
  if (!process.env.TEST_DB_NAME) {
    process.env.TEST_DB_NAME = 'multisig_validator_test';
  }
  
  // Set JWT secret for tests
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-jwt-secret-key-that-is-long-enough-for-validation-requirements';
  }
  
  // Set database connection for config
  process.env.DB_HOST = process.env.TEST_DB_HOST;
  process.env.DB_PORT = process.env.TEST_DB_PORT;
  process.env.DB_USER = process.env.TEST_DB_USER;
  process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD;
  process.env.DB_NAME = process.env.TEST_DB_NAME;
  
  console.log('🧪 Global test setup completed');
}