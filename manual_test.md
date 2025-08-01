1. run `npx hardhat node`
2. run `node scripts/deployLocal.js`, got below output:

```
[dotenv@17.2.0] injecting env (3) from .env (tip: ⚙️  override existing env vars with { override: true })
🚀 Deploying MultiSig contracts to local network...
📋 Deployment details:
Network: hardhat
Chain ID: 31337n
Deployer: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Owner 1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Owner 2: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
Owner 3: 0x90F79bf6EB2c4f870365E785982E1f101E93b906

📦 Deploying Factory...
✅ Factory deployed to: 0x5FbDB2315678afecb367f032d93F642f64180aa3

📦 Deploying MultiSigWallet...
✅ MultiSigWallet deployed to: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512

📦 Deploying MultiSigWalletWithDailyLimit...
✅ MultiSigWalletWithDailyLimit deployed to: 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0

💰 Funding wallets for testing...
✅ Sent 5.0 ETH to MultiSigWallet
✅ Sent 5.0 ETH to MultiSigWalletWithDailyLimit

🔍 Verifying deployments...
MultiSigWallet balance: 5.0 ETH
MultiSigWalletWithDailyLimit balance: 5.0 ETH
MultiSigWallet owners: 3
MultiSigWallet required: 2

🎉 Deployment Summary:
==================================================
Factory: 0x5FbDB2315678afecb367f032d93F642f64180aa3
MultiSigWallet: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
MultiSigWalletWithDailyLimit: 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
Network: localhost (chainId: 31337)
RPC URL: http://127.0.0.1:8545
==================================================
📄 Deployment info saved to deployment-local.json
```

as the multisig wallet address is `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` already registered in the validator service.
no need to call api to register it again. 3. run `npx hardhat console --network localhost`

Get wallet instance:

```
const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
const wallet = MultiSigWallet.attach("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
```

4. start validator service
   `cd backend && npm run dev`

5. submit a transaction by hardhat console:

```
const [deployer, o1, o2, o3] = await ethers.getSigners();

await wallet.connect(o1).submitTransaction("0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0", ethers.parseEther("0.1"), "0x");
```

Then I see below in hardhat node output:

```
eth_sendTransaction
  Transaction: 0x1bbec17b9f8061fe43e0c1afc2c22fdf41b19d44570c847cd2dbd670dde2cbf6
  From:        0x70997970c51812dc3a010c7d01b50e0d17dc79c8
  To:          0xe7f1725e7734ce288f8367e1bb143e90bb3f0512
  Value:       0 ETH
  Gas used:    23250 of 30000000
  Block #1:    0x67e26bced972d8bf8b719c4ef8546c170a88904783b31140fcc1505947f18f5c
```

then I see logs in validator service console, also I got submitTransaction and confirmTransaction message in slack channel.
which means everything works as expected.

6. confirm the transaction by hardhat console:

```
await wallet.connect(o2).confirmTransaction(0);
```

I get the confirmation message and execution message as it satisfied 2 confirmations threshold in slack channel, and also see the logs in validator service console.
