# Testing Documentation

This document provides comprehensive information about the test suite for the MultiSig Validator Service backend.

## Overview

The test suite achieves **100% code coverage** across all services, utilities, and configuration modules. It includes unit tests, integration tests, and comprehensive error scenario testing.

## Test Structure

```
src/__tests__/
├── config/                 # Configuration tests
│   └── config.test.ts      # Config validation and environment tests
├── helpers/                # Test utilities and helpers
│   ├── testDatabase.ts     # Database test utilities
│   └── testUtils.ts        # General test utilities and factories
├── integration/            # Integration tests
│   └── services.integration.test.ts  # Cross-service integration tests
├── mocks/                  # Mock factories and utilities
│   └── index.ts           # Centralized mock factory
├── services/              # Service unit tests
│   ├── chainService.test.ts        # ChainService tests
│   ├── eventProcessor.test.ts      # EventProcessor tests
│   ├── slackNotifier.test.ts       # SlackNotifier tests
│   └── validatorService.test.ts    # ValidatorService tests
├── utils/                 # Utility tests
│   └── errors.test.ts     # Error handling and utilities tests
├── globalSetup.ts         # Global test setup
├── globalTeardown.ts      # Global test teardown
├── runAllTests.ts         # Comprehensive test runner
└── setup.ts              # Test environment setup
```

## Running Tests

### Basic Commands

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run comprehensive test suite with reporting
npm run test:all

# Run tests in watch mode
npm run test:watch
```

### Specific Test Categories

```bash
# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Service tests
npm run test:services

# Configuration tests
npm run test:config

# Utility tests
npm run test:utils
```

### Advanced Test Runner

The custom test runner (`runAllTests.ts`) provides enhanced features:

```bash
# Run with detailed reporting
ts-node src/__tests__/runAllTests.ts

# Run specific test pattern
ts-node src/__tests__/runAllTests.ts --pattern "chainService"

# Watch mode
ts-node src/__tests__/runAllTests.ts --watch
```

## Test Configuration

### Jest Configuration

The Jest configuration is optimized for 100% coverage:

```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100
    }
  },
  // ... additional configuration
};
```

### Environment Setup

Tests use a dedicated test environment:

- **Database**: PostgreSQL test database (`multisig_validator_test`)
- **Environment**: `NODE_ENV=test`
- **Logging**: Minimal logging (error level only)
- **External Services**: Mocked (Slack, blockchain providers)

## Test Categories

### 1. Unit Tests

**Coverage**: Individual functions and methods in isolation

**Examples**:
- ChainService database operations
- SlackNotifier message formatting
- Error handling utilities
- Configuration validation

**Characteristics**:
- Fast execution (< 100ms per test)
- Isolated dependencies (mocked)
- High assertion density
- Edge case coverage

### 2. Integration Tests

**Coverage**: Service interactions and data flow

**Examples**:
- EventProcessor with database transactions
- ValidatorService with multiple components
- Cross-service data consistency

**Characteristics**:
- Real database connections
- Multi-component interactions
- End-to-end workflows
- Performance validation

### 3. Error Scenario Tests

**Coverage**: Error handling and recovery

**Examples**:
- Database connection failures
- Network timeouts
- Invalid input validation
- Service unavailability

**Characteristics**:
- Comprehensive error paths
- Recovery mechanism testing
- Error propagation validation
- Logging verification

## Test Utilities

### TestEnvironment

Provides comprehensive test setup and teardown:

```typescript
const env = await setupTestEnvironment();
const database = env.getDatabase();
const logger = env.getLogger();
const fixtures = env.getFixtures();
```

### MockFactory

Centralized mock creation for consistent testing:

```typescript
const mockDb = MockFactory.createMockDatabase();
const mockLogger = MockFactory.createMockLogger();
const mockProvider = MockFactory.createMockProvider();
```

### TestDataGenerator

Generates realistic test data:

```typescript
const wallet = TestDataGenerator.generateTestWallet();
const transaction = TestDataGenerator.generateTestTransaction();
const alert = TestDataGenerator.generateTestAlert();
```

## Coverage Requirements

### Target: 100% Coverage

- **Lines**: 100%
- **Functions**: 100%
- **Branches**: 100%
- **Statements**: 100%

### Coverage Exclusions

Files excluded from coverage requirements:
- `src/index.ts` (entry point)
- `src/__tests__/**` (test files)
- `src/test/**` (test utilities)
- `src/**/*.d.ts` (type definitions)
- `src/**/*.interface.ts` (interfaces)

## Database Testing

### Test Database Setup

1. **Isolation**: Each test uses a clean database state
2. **Transactions**: Tests run in database transactions when possible
3. **Cleanup**: Automatic cleanup between tests
4. **Seeding**: Consistent test data generation

### Database Helpers

```typescript
const dbHelpers = new DatabaseTestHelpers(database);

// Insert test data
const walletId = await dbHelpers.insertTestWallet(testWallet);
const txId = await dbHelpers.insertTestTransaction(testTx);

// Verify results
const count = await dbHelpers.countTransactions(walletId);
await dbHelpers.waitForCondition(() => checkCondition());
```

## Mocking Strategy

### External Dependencies

- **Blockchain Providers**: Mock RPC calls and responses
- **Slack API**: Mock HTTP requests
- **Database**: Real database for integration, mocked for unit tests
- **File System**: Mock file operations
- **Network**: Mock HTTP requests

### Service Dependencies

- **EventListener**: Mock event emissions
- **Contracts**: Mock blockchain contract interactions
- **Rate Limiters**: Mock rate limiting behavior
- **Circuit Breakers**: Mock failure detection

## Performance Testing

### Performance Benchmarks

- **Database Operations**: < 100ms per query
- **Service Initialization**: < 1s
- **Event Processing**: < 50ms per event
- **Full Test Suite**: < 30s

### Load Testing Scenarios

- **Concurrent Transactions**: Process 100+ transactions simultaneously
- **Database Stress**: Handle 1000+ concurrent operations
- **Memory Usage**: Maintain stable memory footprint

## Continuous Integration

### GitHub Actions Integration

```yaml
name: Test Suite
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run test:all
      - uses: codecov/codecov-action@v3
```

### Quality Gates

- ✅ All tests must pass
- ✅ 100% code coverage required
- ✅ No security vulnerabilities
- ✅ Performance benchmarks met
- ✅ Type checking passes

## Debugging Tests

### Debug Mode

```bash
# Enable debug output
DEBUG_TESTS=true npm test

# Run specific test with debugging
npm test -- --testNamePattern="specific test name" --verbose
```

### Common Issues

1. **Database Connection**: Ensure PostgreSQL is running
2. **Port Conflicts**: Use different ports for test database
3. **Async Operations**: Use proper async/await patterns
4. **Memory Leaks**: Check for unclosed connections

### Test Logs

- **Location**: `logs/` directory (ignored by git)
- **Levels**: Error, warn, info, debug
- **Rotation**: Daily rotation in production

## Best Practices

### Writing Tests

1. **AAA Pattern**: Arrange, Act, Assert
2. **Descriptive Names**: Clear test descriptions
3. **Single Responsibility**: One assertion per test when possible
4. **Independent Tests**: No test dependencies
5. **Edge Cases**: Test boundary conditions

### Mock Usage

1. **Minimal Mocking**: Mock only external dependencies
2. **Realistic Mocks**: Mirror real behavior patterns
3. **Mock Verification**: Verify mock interactions
4. **Mock Cleanup**: Reset mocks between tests

### Performance

1. **Fast Feedback**: Unit tests < 100ms
2. **Parallel Execution**: Run tests concurrently when safe
3. **Resource Cleanup**: Proper teardown procedures
4. **Memory Management**: Avoid memory leaks in tests

## Maintenance

### Adding New Tests

1. Follow existing patterns and structure
2. Update coverage thresholds if needed
3. Add integration tests for new services
4. Document test scenarios

### Updating Existing Tests

1. Maintain backwards compatibility
2. Update mock data when schemas change
3. Preserve test coverage levels
4. Review performance impact

## Troubleshooting

### Common Test Failures

| Error | Cause | Solution |
|-------|-------|----------|
| Database connection failed | PostgreSQL not running | Start PostgreSQL service |
| Timeout in async tests | Missing await statements | Add proper async/await |
| Mock not called | Incorrect mock setup | Verify mock configuration |
| Coverage below threshold | Missing test cases | Add tests for uncovered code |

### Performance Issues

1. **Slow Tests**: Profile with `--detectSlowTests`
2. **Memory Usage**: Monitor with `--detectLeaks`
3. **Database Performance**: Check query optimization
4. **Mock Overhead**: Optimize mock implementations

## Contributing

### Test Conventions

- Use descriptive test names
- Follow the existing file structure
- Include both positive and negative test cases
- Add integration tests for new features
- Maintain 100% coverage

### Review Checklist

- [ ] All tests pass
- [ ] Coverage remains at 100%
- [ ] Performance benchmarks met
- [ ] Documentation updated
- [ ] Edge cases covered
- [ ] Error scenarios tested

---

For questions or issues with the test suite, please refer to the main project documentation or create an issue in the repository.