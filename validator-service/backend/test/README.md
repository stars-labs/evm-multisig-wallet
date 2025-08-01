# MultiSig Wallet Validator Service Test Suite

This directory contains comprehensive test scripts for the MultiSig wallet and validator service integration.

## Test Files

### 1. `regression/multisig-regression-tests.js`
Complete regression test suite that tests all multisig wallet scenarios:
- Transaction submission and confirmation
- Transaction execution (full flow)
- Transaction revocation
- Owner management (add/remove)
- Requirement changes
- Daily limit changes (for WithDailyLimit wallet)
- Direct deposits
- Execution failures

### 3. Database cleanup and setup scripts in `src/scripts/`:
- `cleanupTestData.ts` - Cleans database before test runs
- `registerLocalWallets.ts` - Registers wallets with validator service

## Running Tests

### Automated Full Regression Suite

Run the complete automated test suite:
```bash
cd validator-service/backend
node scripts/runRegressionTests.js
```

This will automatically:
1. ✅ Check/start Hardhat node
2. ✅ Deploy contracts
3. ✅ Clean database from previous runs
4. ✅ Register wallets with validator service API
5. ✅ Verify validator service is running
6. ✅ Run all regression tests
7. ✅ Generate HTML report

### Manual Prerequisites (if not using automated runner)
If running tests manually, ensure these steps are completed first:

1. **Start Hardhat node**: `npx hardhat node`
2. **Deploy contracts**: `node scripts/deployLocal.js` (from project root)
3. **Clean database**: `npx ts-node src/scripts/cleanupTestData.ts`
4. **Register wallets**: `npx ts-node src/scripts/registerLocalWallets.ts`
5. **Start validator service**: `npm run dev`

### Quick Tests

Test individual scenarios during development:

```bash
cd validator-service/backend

# Test transaction submission only
node test/regression/quick-test.js submit

# Test submission and confirmation
node test/regression/quick-test.js confirm

# Test full execution flow
node test/regression/quick-test.js execute

# Test revocation
node test/regression/quick-test.js revoke

# Test adding owner
node test/regression/quick-test.js owner-add

# Test removing owner
node test/regression/quick-test.js owner-remove

# Test changing requirement
node test/regression/quick-test.js requirement

# Test deposit event
node test/regression/quick-test.js deposit

# Run all scenarios
node test/regression/quick-test.js all
```

### Manual Testing with Hardhat Console

You can also test manually using Hardhat console:

```bash
# From project root
npx hardhat console --network localhost
```

Then load the test helpers:
```javascript
const [deployer, owner1, owner2, owner3] = await ethers.getSigners();
const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
const wallet = MultiSigWallet.attach("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
```

## Database Setup and Cleanup

### Why Database Cleanup is Important
When contracts are redeployed with the same addresses:
- Old transaction records become invalid
- Chain sync state (`last_processed_block`) needs reset
- Event processing starts from wrong block

### What the Cleanup Script Does
The `cleanupTestData.ts` script:
- ✅ Removes old transactions for test wallets
- ✅ Clears confirmation records
- ✅ Deletes old events
- ✅ Resets `last_processed_block` to 0 in chains table
- ✅ Resets sync status and error counts

## Wallet Registration

### Why Registration is Required
The validator service needs to know which wallets to monitor:
- Wallets must be registered in the database
- `monitored` flag must be set to `true`
- Network and type information is required

### What the Registration Does
- ✅ Registers MultiSigWallet at deployed address
- ✅ Registers MultiSigWalletWithDailyLimit at deployed address
- ✅ Sets both wallets as `monitored = true`
- ✅ Uses correct network (`localhost`) and types

## Test Results and Monitoring

### Test Results
- JSON results: `test/regression/regression-results-{timestamp}.json`
- HTML reports: `test/regression/regression-report.html`
- Exit codes: 0 = success, 1 = failure

### Monitoring During Tests
While tests are running, monitor:

1. **Hardhat Console** - Transaction details and gas usage
2. **Validator Service Logs** - Event detection and processing
   ```bash
   tail -f logs/validator-service.log
   ```
3. **Slack Notifications** - Real-time alerts (if configured)
4. **Database** - Check transactions and confirmations are stored
   ```sql
   SELECT * FROM transactions ORDER BY submitted_at DESC LIMIT 5;
   ```

### Test Verification
Each test verifies:
- ✅ Smart contract events are emitted correctly
- ✅ Validator service detects events
- ✅ Database records are created
- ✅ Slack notifications are sent
- ✅ API endpoints return correct data

## Troubleshooting

### Tests fail with "contract not deployed"
```bash
# Solution: Deploy contracts
cd ../../../  # Go to project root
node scripts/deployLocal.js
```

### No events detected by validator service
```bash
# Check last processed block
psql -d validator_service -c "SELECT network, last_processed_block FROM chains WHERE network = 'localhost';"

# Reset if needed
npx ts-node src/scripts/cleanupTestData.ts
```

### Validator service not running
```bash
# Start validator service
npm run dev

# Check health
curl http://localhost:3001/health
```

### Wallets not registered
```bash
# Register wallets
npx ts-node src/scripts/registerLocalWallets.ts

# Check registration
curl http://localhost:3001/api/wallets?network=localhost
```

### Database connection issues
```bash
# Check PostgreSQL is running
pg_isready

# Check connection in validator service logs
tail -f logs/error.log
```

### Hardhat node issues
```bash
# Kill existing processes
pkill -f "hardhat node"

# Start fresh
npx hardhat node
```

## Test Structure

### Test Flow
1. **Setup Phase**
   - Environment verification
   - Contract deployment
   - Database cleanup
   - Wallet registration

2. **Test Execution**
   - Each test scenario runs independently
   - Configurable delays between actions
   - Event verification after each action

3. **Verification Phase**
   - Smart contract state checks
   - Validator service API verification
   - Database record validation

### Test Coverage
- ✅ All multisig wallet operations
- ✅ All event types (9 different events)
- ✅ Both standard and daily limit wallets
- ✅ Success and failure scenarios
- ✅ Validator service integration
- ✅ Database persistence
- ✅ API endpoint responses