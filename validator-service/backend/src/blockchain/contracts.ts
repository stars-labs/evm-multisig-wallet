// Smart contract ABIs and interfaces for MultiSig wallets
import { ethers } from 'ethers';

// ============================================================================
// MULTISIG WALLET ABI
// ============================================================================

export const MULTISIG_WALLET_ABI = [
  // Events
  'event Confirmation(address indexed sender, uint indexed transactionId)',
  'event Revocation(address indexed sender, uint indexed transactionId)',
  'event Submission(uint indexed transactionId)',
  'event Execution(uint indexed transactionId)',
  'event ExecutionFailure(uint indexed transactionId)',
  'event Deposit(address indexed sender, uint value)',
  'event OwnerAddition(address indexed owner)',
  'event OwnerRemoval(address indexed owner)',
  'event RequirementChange(uint required)',
  
  // Read functions
  'function owners(uint) view returns (address)',
  'function getOwners() view returns (address[])',
  'function required() view returns (uint)',
  'function transactionCount() view returns (uint)',
  'function transactions(uint) view returns (address destination, uint value, bytes data, bool executed)',
  'function confirmations(uint, address) view returns (bool)',
  'function isConfirmed(uint transactionId) view returns (bool)',
  'function getConfirmationCount(uint transactionId) view returns (uint count)',
  'function getTransactionCount(bool pending, bool executed) view returns (uint count)',
  'function getConfirmations(uint transactionId) view returns (address[] _confirmations)',
  'function getTransactionIds(uint from, uint to, bool pending, bool executed) view returns (uint[] _transactionIds)',
  
  // Write functions
  'function addOwner(address owner)',
  'function removeOwner(address owner)',
  'function replaceOwner(address owner, address newOwner)',
  'function changeRequirement(uint _required)',
  'function submitTransaction(address destination, uint value, bytes data) returns (uint transactionId)',
  'function confirmTransaction(uint transactionId)',
  'function revokeConfirmation(uint transactionId)',
  'function executeTransaction(uint transactionId)',
] as const;

// ============================================================================
// MULTISIG WALLET WITH DAILY LIMIT ABI
// ============================================================================

export const MULTISIG_WALLET_WITH_DAILY_LIMIT_ABI = [
  ...MULTISIG_WALLET_ABI,
  // Additional events
  'event DailyLimitChange(uint dailyLimit)',
  
  // Additional read functions
  'function dailyLimit() view returns (uint)',
  'function lastDay() view returns (uint)',
  'function spentToday() view returns (uint)',
  'function calcMaxWithdraw() view returns (uint)',
  
  // Additional write functions
  'function changeDailyLimit(uint _dailyLimit)',
] as const;

// ============================================================================
// EVENT INTERFACES
// ============================================================================

export interface MultiSigEvent {
  event: string;
  address: string;
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
  removed: boolean;
  topics?: string[];
  args: any;
}

export interface SubmissionEvent extends MultiSigEvent {
  event: 'Submission';
  args: any;
}

export interface ConfirmationEvent extends MultiSigEvent {
  event: 'Confirmation';
  args: any;
}

export interface RevocationEvent extends MultiSigEvent {
  event: 'Revocation';
  args: any;
}

export interface ExecutionEvent extends MultiSigEvent {
  event: 'Execution';
  args: any;
}

export interface ExecutionFailureEvent extends MultiSigEvent {
  event: 'ExecutionFailure';
  args: any;
}

export interface DepositEvent extends MultiSigEvent {
  event: 'Deposit';
  args: any;
}

export interface OwnerAdditionEvent extends MultiSigEvent {
  event: 'OwnerAddition';
  args: any;
}

export interface OwnerRemovalEvent extends MultiSigEvent {
  event: 'OwnerRemoval';
  args: any;
}

export interface RequirementChangeEvent extends MultiSigEvent {
  event: 'RequirementChange';
  args: any;
}

export interface DailyLimitChangeEvent extends MultiSigEvent {
  event: 'DailyLimitChange';
  args: any;
}

// ============================================================================
// CONTRACT INTERACTION HELPERS
// ============================================================================

export class MultiSigContract {
  private contract: ethers.Contract;
  private provider: ethers.Provider;
  
  constructor(
    address: string,
    provider: ethers.Provider,
    hasDailyLimit: boolean = false
  ) {
    this.provider = provider;
    const abi = hasDailyLimit ? MULTISIG_WALLET_WITH_DAILY_LIMIT_ABI : MULTISIG_WALLET_ABI;
    // Ensure address is properly checksummed for ethers.js v6
    const checksummedAddress = ethers.getAddress(address);
    this.contract = new ethers.Contract(checksummedAddress, abi, provider);
  }
  
  // ============================================================================
  // READ METHODS
  // ============================================================================
  
  async getOwners(): Promise<string[]> {
    try {
      return await this.contract.getOwners();
    } catch (error) {
      throw new Error(`Failed to get owners: ${error}`);
    }
  }
  
  async getRequired(): Promise<number> {
    try {
      const required = await this.contract.required();
      return Number(required);
    } catch (error) {
      throw new Error(`Failed to get required confirmations: ${error}`);
    }
  }
  
  async getTransactionCount(): Promise<number> {
    try {
      const count = await this.contract.transactionCount();
      return Number(count);
    } catch (error) {
      throw new Error(`Failed to get transaction count: ${error}`);
    }
  }
  
  async getTransaction(transactionId: number) {
    try {
      const tx = await this.contract.transactions(transactionId);
      return {
        destination: tx.destination,
        value: tx.value.toString(),
        data: tx.data,
        executed: tx.executed,
      };
    } catch (error) {
      throw new Error(`Failed to get transaction ${transactionId}: ${error}`);
    }
  }
  
  async isConfirmed(transactionId: number): Promise<boolean> {
    try {
      return await this.contract.isConfirmed(transactionId);
    } catch (error) {
      throw new Error(`Failed to check confirmation status: ${error}`);
    }
  }
  
  async getConfirmationCount(transactionId: number): Promise<number> {
    try {
      const count = await this.contract.getConfirmationCount(transactionId);
      return Number(count);
    } catch (error) {
      throw new Error(`Failed to get confirmation count: ${error}`);
    }
  }
  
  async getConfirmations(transactionId: number): Promise<string[]> {
    try {
      return await this.contract.getConfirmations(transactionId);
    } catch (error) {
      throw new Error(`Failed to get confirmations: ${error}`);
    }
  }
  
  async getDailyLimit(): Promise<string | null> {
    try {
      if (this.contract.interface.hasFunction('dailyLimit')) {
        const limit = await this.contract.dailyLimit();
        return limit.toString();
      }
      return null;
    } catch (error) {
      return null; // Contract doesn't have daily limit
    }
  }
  
  async getBalance(): Promise<string> {
    try {
      const balance = await this.provider.getBalance(this.contract.target);
      return balance.toString();
    } catch (error) {
      throw new Error(`Failed to get balance: ${error}`);
    }
  }
  
  // ============================================================================
  // EVENT FILTERING
  // ============================================================================
  
  async getEvents(
    eventName: string,
    fromBlock: number = 0,
    toBlock: number | 'latest' = 'latest'
  ): Promise<MultiSigEvent[]> {
    try {
      const filter = this.contract.filters[eventName]();
      const events = await this.contract.queryFilter(filter, fromBlock, toBlock);
      
      return events.map(event => {
        const eventLog = event as any; // ethers.js EventLog
        return {
          event: eventLog.eventName || eventName,
          address: eventLog.address,
          blockNumber: eventLog.blockNumber,
          blockHash: eventLog.blockHash,
          transactionHash: eventLog.transactionHash,
          transactionIndex: eventLog.transactionIndex,
          logIndex: eventLog.logIndex || 0,
          removed: eventLog.removed || false,
          args: this.parseEventArgs(eventLog.args || []),
        };
      });
    } catch (error) {
      throw new Error(`Failed to get ${eventName} events: ${error}`);
    }
  }
  
  async getAllEvents(
    fromBlock: number = 0,
    toBlock: number | 'latest' = 'latest'
  ): Promise<MultiSigEvent[]> {
    try {
      const eventNames = [
        'Submission',
        'Confirmation',
        'Revocation', 
        'Execution',
        'ExecutionFailure',
        'Deposit',
        'OwnerAddition',
        'OwnerRemoval',
        'RequirementChange',
        'DailyLimitChange'
      ];
      
      const allEvents: MultiSigEvent[] = [];
      
      for (const eventName of eventNames) {
        try {
          const events = await this.getEvents(eventName, fromBlock, toBlock);
          allEvents.push(...events);
        } catch (error) {
          // Skip events that don't exist on this contract
          continue;
        }
      }
      
      // Sort by block number and log index
      return allEvents.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) {
          return a.blockNumber - b.blockNumber;
        }
        return a.logIndex - b.logIndex;
      });
    } catch (error) {
      throw new Error(`Failed to get all events: ${error}`);
    }
  }
  
  // ============================================================================
  // UTILITY METHODS
  // ============================================================================
  
  private parseEventArgs(args: any[]): Record<string, any> {
    const parsed: Record<string, any> = {};
    
    for (let i = 0; i < args.length; i++) {
      const value = args[i];
      if (typeof value === 'bigint') {
        parsed[i] = value;
      } else {
        parsed[i] = value;
      }
    }
    
    return parsed;
  }
  
  getAddress(): string {
    return this.contract.target as string;
  }
  
  getInterface(): ethers.Interface {
    return this.contract.interface;
  }
  
  // ============================================================================
  // TRANSACTION DECODING
  // ============================================================================
  
  decodeTransactionData(data: string): any {
    try {
      if (data === '0x' || !data) {
        return { functionName: 'transfer', parameters: {} };
      }
      
      const decoded = this.contract.interface.parseTransaction({ data });
      
      if (!decoded) {
        return { functionName: 'unknown', parameters: {}, rawData: data };
      }
      
      const parameters: Record<string, any> = {};
      
      // Convert args to named parameters
      if (decoded.args) {
        for (let i = 0; i < decoded.args.length; i++) {
          const param = decoded.fragment.inputs[i];
          const value = decoded.args[i];
          
          if (param) {
            if (typeof value === 'bigint') {
              parameters[param.name] = value.toString();
            } else {
              parameters[param.name] = value;
            }
          }
        }
      }
      
      return {
        functionName: decoded.name,
        parameters,
        selector: decoded.selector,
      };
    } catch (error) {
      return { 
        functionName: 'unknown', 
        parameters: {}, 
        rawData: data,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// ============================================================================
// CONTRACT FACTORY
// ============================================================================

export class ContractFactory {
  private providers: Map<string, ethers.Provider> = new Map();
  
  constructor(networkConfigs: Record<string, { rpcUrl: string }>) {
    for (const [network, config] of Object.entries(networkConfigs)) {
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      this.providers.set(network, provider);
    }
  }
  
  getContract(
    address: string,
    network: string,
    hasDailyLimit: boolean = false
  ): MultiSigContract {
    const provider = this.providers.get(network);
    if (!provider) {
      throw new Error(`Provider not found for network: ${network}`);
    }
    
    return new MultiSigContract(address, provider, hasDailyLimit);
  }
  
  getProvider(network: string): ethers.Provider {
    const provider = this.providers.get(network);
    if (!provider) {
      throw new Error(`Provider not found for network: ${network}`);
    }
    return provider;
  }
  
  async validateContract(address: string, network: string): Promise<boolean> {
    try {
      const provider = this.getProvider(network);
      const code = await provider.getCode(address);
      return code !== '0x';
    } catch (error) {
      return false;
    }
  }
  
  async detectContractType(address: string, network: string): Promise<'MultiSigWallet' | 'MultiSigWalletWithDailyLimit' | 'unknown'> {
    try {
      const contract = this.getContract(address, network, true);
      
      // Try to call dailyLimit function
      await contract.getDailyLimit();
      return 'MultiSigWalletWithDailyLimit';
    } catch (error) {
      try {
        // Try basic MultiSig functions
        const contract = this.getContract(address, network, false);
        await contract.getOwners();
        return 'MultiSigWallet';
      } catch (error) {
        return 'unknown';
      }
    }
  }
}

export default {
  MULTISIG_WALLET_ABI,
  MULTISIG_WALLET_WITH_DAILY_LIMIT_ABI,
  MultiSigContract,
  ContractFactory,
};