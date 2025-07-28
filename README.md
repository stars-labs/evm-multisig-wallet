# MultiSig Wallet Testnet Deployment

## Quick Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. **Update deployment script:**
   Edit `scripts/deploy.js` and replace the placeholder addresses with your actual wallet addresses:
   ```javascript
   const owners = [
     "0xYourAddress1",  // Replace with actual addresses
     "0xYourAddress2",  // Replace with actual addresses  
     "0xYourAddress3"   // Replace with actual addresses
   ];
   ```

4. **Deploy to Sepolia:**
   ```bash
   npm run deploy:sepolia
   ```

## Environment Variables

- `PRIVATE_KEY`: Your wallet private key (deployer account)
- `SEPOLIA_RPC_URL`: Sepolia RPC endpoint (get from Infura/Alchemy)
- `ETHERSCAN_API_KEY`: For contract verification

## Contract Overview

The deployment includes three contracts:

1. **Factory**: Creates contract instances
2. **MultiSigWallet**: Core multisig (requires N of M signatures)
3. **MultiSigWalletWithDailyLimit**: Multisig + daily withdrawal limit

## Deployed Contracts (Sepolia Testnet)

- **Factory**: `0xb56E6f244000C403490De104e9F0789c0D446Db2`
- **MultiSigWallet**: `0x9f39A39631b2E49B59A614D37465431890612b5a`
- **MultiSigWalletWithDailyLimit**: `0xbdb8ed781577405f3FaEa59b33bA2fb05179ee61`

**Configuration:**
- Owners: 3 addresses (RE1a, RE2, RE3)
- Required confirmations: 2 of 3
- Daily limit: 1.0 ETH

## Testing the Wallet

After deployment:

1. Send test ETH to the wallet address
2. Create a transaction using `submitTransaction()`
3. Other owners confirm with `confirmTransaction()`
4. Transaction executes when threshold is reached

## Contract Verification

```bash
npx hardhat verify --network sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```