# MultiSig Validator Tests

This directory contains all tests for the MultiSig Wallet Validator Service, organized by test type following Node.js conventions.

## Directory Structure

```
test/
├── unit/           # Unit tests (TypeScript) - fast, isolated component tests
├── integration/    # Integration tests (JavaScript) - component interaction tests
├── e2e/           # End-to-end tests - full system workflow tests
├── fixtures/      # Test data and mocks (planned)
└── README.md      # This file
```

## Test Categories

### Unit Tests (`unit/`)

Fast, isolated tests for individual components written in TypeScript:
- `checksumDebugTest.ts` - Address checksum validation
- `contractFactoryTest.ts` - Contract factory functionality  
- `eventDebugTest.ts` - Event parsing and handling
- `eventListenerTest.ts` - Event listener unit tests
- `localhostEventTest.ts` - Local blockchain event tests
- `simpleTest.ts` - Basic functionality tests

Run with:
```bash
npm run test:unit
# or specific files
npx jest test/unit/eventListenerTest.ts
```

### Integration Tests (`integration/`)

Tests that verify component interactions, written in JavaScript:
- `debug-owner-removal.js` - Owner removal workflow debugging
- `debug-transaction-state.js` - Transaction state management testing
- `test-owner-removal-fixed.js` - Fixed owner removal scenarios

Run with:
```bash
npm run test:integration
# or individually
node test/integration/debug-owner-removal.js
```

### End-to-End Tests (`e2e/`)

Full system tests that verify complete workflows:

#### Regression Tests (`e2e/regression/`)
- `multisig-regression-tests.js` - Complete system verification with all scenarios
- `quick-test.js` - Individual scenario testing for faster debugging

**Run full regression suite:**
```bash
cd backend
node test/e2e/regression/multisig-regression-tests.js
```

**Run specific scenarios:**
```bash
# Individual scenarios for focused testing
node test/e2e/regression/quick-test.js submit    # Transaction submission only
node test/e2e/regression/quick-test.js confirm   # Submission + confirmation  
node test/e2e/regression/quick-test.js execute   # Full execution flow
node test/e2e/regression/quick-test.js revoke    # Transaction revocation
node test/e2e/regression/quick-test.js owner-add # Owner addition
node test/e2e/regression/quick-test.js owner-remove # Owner removal
node test/e2e/regression/quick-test.js requirement # Requirement changes
node test/e2e/regression/quick-test.js deposit   # Deposit events
node test/e2e/regression/quick-test.js all       # All scenarios
```

## Prerequisites

Before running any tests, ensure the following are set up:

1. **Hardhat node running**: 
   ```bash
   npx hardhat node
   ```

2. **Contracts deployed**: 
   ```bash
   npx hardhat run scripts/deployLocal.js --network localhost
   ```

3. **Database initialized**: 
   ```bash
   psql -U validator_user -d multisig_validator -f schema.sql
   ```

4. **Validator service running**: 
   ```bash
   npm run dev
   ```

## Running Tests

### All tests:
```bash
npm test
```

### By category:
```bash
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests only  
npm run test:e2e         # End-to-end tests only
```

### With coverage:
```bash
npm run test:coverage
```

## Test Development Guidelines

### Adding New Tests

- **Unit tests**: Add `.ts` files to `test/unit/` for isolated component testing
- **Integration tests**: Add `.js` files to `test/integration/` for component interactions
- **E2E tests**: Add to `test/e2e/` with appropriate subdirectory for user workflows
- **Test data**: Add to `test/fixtures/` for reusable test data and mocks

### Best Practices

- **Unit tests**: Keep fast and isolated, test single functions/classes
- **Integration tests**: Test component interactions, database operations
- **E2E tests**: Test complete user workflows, full system integration
- Use descriptive test names that explain the scenario
- Add fixtures for reusable test data
- Mock external dependencies in unit tests

## Database Setup and Cleanup

### Why Database Cleanup is Important
When contracts are redeployed with the same addresses:
- Old transaction records become invalid
- Chain sync state (`last_processed_block`) needs reset  
- Event processing starts from wrong block

### Cleanup Process
The cleanup scripts handle:
- ✅ Remove old transactions for test wallets
- ✅ Clear confirmation records
- ✅ Delete old events
- ✅ Reset `last_processed_block` to 0 in chains table
- ✅ Reset sync status and error counts

## Monitoring During Tests

### Test Results
- JSON results: `test/e2e/regression/regression-results-{timestamp}.json`
- HTML reports: `test/e2e/regression/regression-report.html`
- Exit codes: 0 = success, 1 = failure

### Monitoring Services
While tests run, monitor:

1. **Hardhat Console** - Transaction details and gas usage
2. **Validator Service Logs** - Event detection and processing
   ```bash
   tail -f logs/validator-service.log
   ```
3. **Database** - Check transactions and confirmations
   ```sql
   SELECT * FROM transactions ORDER BY submitted_at DESC LIMIT 5;
   ```

## Troubleshooting

### Common Issues

**Tests fail with "contract not deployed"**
```bash
# Deploy contracts first
npx hardhat run scripts/deployLocal.js --network localhost
```

**No events detected by validator service**
```bash
# Check and reset last processed block
psql -d multisig_validator -c "SELECT network, last_processed_block FROM chains WHERE network = 'localhost';"
```

**Validator service not running**
```bash
# Start validator service
npm run dev

# Check health
curl http://localhost:3001/health
```

**Database connection issues**
```bash
# Check PostgreSQL is running
pg_isready

# Check connection in logs
tail -f logs/error.log
```

## Test Structure

### Test Flow
1. **Setup Phase** - Environment verification, contract deployment, database cleanup
2. **Test Execution** - Independent test scenarios with configurable delays
3. **Verification Phase** - Smart contract state, validator service API, database validation

### Test Coverage
- ✅ All multisig wallet operations
- ✅ All event types (9 different events)  
- ✅ Both standard and daily limit wallets
- ✅ Success and failure scenarios
- ✅ Validator service integration
- ✅ Database persistence
- ✅ API endpoint responses