# New Project Structure

The project has been restructured from `evm-multisig-wallet` to `multisig-wallet-validator-service` with the following changes:

## Directory Structure Changes

### Before:
```
evm-multisig-wallet/
├── validator-service/
│   ├── backend/
│   └── frontend/
├── contracts/
├── scripts/
└── ...
```

### After:
```
multisig-wallet-validator/
├── backend/         (moved from validator-service/backend/)
├── frontend/        (moved from validator-service/frontend/)
├── contracts/
├── scripts/
└── ...
```

## Updated Paths

1. **Backend Server**: 
   - Old: `cd validator-service/backend && npm run dev`
   - New: `cd backend && npm run dev`

2. **Regression Tests**:
   - Path references updated from `../../../../` to `../../../`
   - Run with: `npx hardhat run backend/test/regression/multisig-regression-tests.js --network localhost`

3. **Frontend**:
   - Old: `cd validator-service/frontend && npm start`
   - New: `cd frontend && npm start`

## Note
To complete the restructuring, rename the root directory from `evm-multisig-wallet` to `multisig-wallet-validator-service`:
```bash
cd ..
mv evm-multisig-wallet multisig-wallet-validator-service
```