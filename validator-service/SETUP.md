# MultiSig Validator Service Setup Guide

## Prerequisites

1. **PostgreSQL 14+** with TimescaleDB extension
2. **Node.js 18+** and npm
3. **Git** (for cloning and version control)

## 1. Database Setup

### Install PostgreSQL with TimescaleDB

**Option A: Using Homebrew (macOS)**
```bash
# Install PostgreSQL
brew install postgresql@14

# Start PostgreSQL service
brew services start postgresql@14

# Install TimescaleDB
brew tap timescale/tap
brew install timescaledb

# Add TimescaleDB to PostgreSQL config
timescaledb-tune --quiet --yes
```

**Option B: Using Docker**
```bash
# Run PostgreSQL with TimescaleDB
docker run -d \
  --name multisig-postgres \
  -e POSTGRES_PASSWORD=password123 \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=multisig_validator \
  -p 5432:5432 \
  timescale/timescaledb:latest-pg14
```

### Create Database and User

```bash
# Connect to PostgreSQL
psql -h localhost -U postgres

# Create database and user
CREATE DATABASE multisig_validator;
CREATE USER validator_user WITH PASSWORD 'secure_password_123';
GRANT ALL PRIVILEGES ON DATABASE multisig_validator TO validator_user;

# Connect to the new database
\c multisig_validator

# Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

# Exit psql
\q
```

### Run Database Migrations

```bash
# Navigate to backend directory
cd validator-service/backend

# Run the schema migration
psql -h localhost -U validator_user -d multisig_validator -f ../schema.sql
```

## 2. Environment Configuration

Create environment configuration files:

```bash
# Create backend .env file
cat > validator-service/backend/.env << EOF
# Database
DATABASE_URL=postgresql://validator_user:secure_password_123@localhost:5432/multisig_validator
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=multisig_validator
DATABASE_USER=validator_user
DATABASE_PASSWORD=secure_password_123

# Blockchain RPC URLs
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/76b6da167a1a45ecb381010150ee9d31
MAINNET_RPC_URL=https://mainnet.infura.io/v3/76b6da167a1a45ecb381010150ee9d31

# Service Configuration
LOG_LEVEL=debug
NODE_ENV=development
PORT=3000

# Monitoring
ENABLE_VALIDATION=true
AUTO_PROCESS_ALERTS=true
SYNC_INTERVAL=30000
EOF
```

## 3. Install Dependencies

```bash
# Install backend dependencies
cd validator-service/backend
npm install

# Install shared dependencies
cd ../shared
npm install

# Return to backend for running
cd ../backend
```

## 4. Start the Validator Service

### Option 1: Start All Components

```bash
# Start PostgreSQL (if not already running)
brew services start postgresql@14
# OR for Docker:
# docker start multisig-postgres

# Start the validator service
cd validator-service/backend
npm run start
```

### Option 2: Development Mode with Hot Reload

```bash
cd validator-service/backend
npm run dev
```

### Option 3: Test Mode (No Database Required)

```bash
# Run simple connectivity test
cd validator-service/backend
npm run test:simple

# Run full event listener test (requires database)
npm run test:events
```

## 5. Verify Setup

### Check Database Connection
```bash
psql -h localhost -U validator_user -d multisig_validator -c "SELECT NOW();"
```

### Check Service Status
```bash
# Service should show:
# - ✅ Database connected
# - ✅ Event listeners started
# - ✅ Monitoring 2 wallets on Sepolia
# - 👀 Listening for real-time events...
```

## 6. Monitored Wallets

The service automatically monitors these deployed wallets:

- **Basic MultiSig**: `0x9f39A39631b2E49B59A614D37465431890612b5a`
- **MultiSig with Daily Limit**: `0xbdb8ed781577405f3FaEa59b33bA2fb05179ee61`

## 7. Testing

### Create a test transaction to verify monitoring:

1. Visit [Sepolia Etherscan](https://sepolia.etherscan.io/address/0x9f39A39631b2E49B59A614D37465431890612b5a#writeContract)
2. Connect your wallet
3. Call `submitTransaction` with test parameters
4. Watch the validator service logs for real-time event detection

## Common Issues

### Database Connection Failed
```bash
# Check PostgreSQL is running
brew services list | grep postgresql
# OR for Docker:
# docker ps | grep postgres

# Check connection
pg_isready -h localhost -p 5432
```

### RPC Rate Limiting
- The service includes automatic retry logic
- Consider upgrading to a paid Infura plan for higher limits
- Monitor the logs for "Too Many Requests" warnings

### Missing Dependencies
```bash
# Reinstall all dependencies
cd validator-service
rm -rf */node_modules */package-lock.json
cd backend && npm install
cd ../shared && npm install
```

## Next Steps

Once running, you can:
1. Add more wallets via the service API
2. Configure alert notifications (email/Slack)
3. Build the frontend dashboard
4. Set up monitoring and alerting