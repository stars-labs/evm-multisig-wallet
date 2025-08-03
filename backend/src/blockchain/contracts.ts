// Smart contract ABIs and interfaces for MultiSig wallets
import { ethers } from 'ethers';
import winston from 'winston';

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
  index?: number; // Fallback index for sorting when logIndex is undefined
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
  private logger?: winston.Logger;
  
  constructor(
    address: string,
    provider: ethers.Provider,
    hasDailyLimit: boolean = false,
    logger?: winston.Logger
  ) {
    this.provider = provider;
    this.logger = logger;
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
      this.logger?.debug(`Querying ${eventName} events`, {
        contract: this.contract.target,
        eventName,
        fromBlock,
        toBlock
      });
      
      // Use direct contract.queryFilter for specific events
      const events = await this.contract.queryFilter(eventName, fromBlock, toBlock);
      
      // Map the events to our format
      const mappedEvents = events.map((event) => {
        const eventLog = event as ethers.EventLog;
        
        // Parse the arguments - ethers v6 provides args as an array
        const args: Record<string, any> = {};
        if (eventLog.args) {
          // Convert array args to object with indices
          eventLog.args.forEach((arg, index) => {
            args[index] = typeof arg === 'bigint' ? arg.toString() : arg;
          });
          
          // Also include named arguments if available
          const fragment = eventLog.fragment;
          if (fragment && fragment.inputs) {
            fragment.inputs.forEach((input, index) => {
              if (input.name && eventLog.args[index] !== undefined) {
                args[input.name] = typeof eventLog.args[index] === 'bigint' 
                  ? eventLog.args[index].toString() 
                  : eventLog.args[index];
              }
            });
          }
        }
        
        return {
          event: eventLog.eventName || eventName,
          address: eventLog.address,
          blockNumber: eventLog.blockNumber,
          blockHash: eventLog.blockHash,
          transactionHash: eventLog.transactionHash,
          transactionIndex: eventLog.transactionIndex,
          logIndex: eventLog.index,
          removed: eventLog.removed || false,
          args: args,
          index: eventLog.index
        };
      });
      
      if (mappedEvents.length > 0) {
        this.logger?.debug(`Found ${mappedEvents.length} ${eventName} events`, {
          eventName,
          count: mappedEvents.length,
          contract: this.contract.target
        });
      }
      
      return mappedEvents;
    } catch (error) {
      this.logger?.error(`Failed to get ${eventName} events`, {
        eventName,
        contract: this.contract.target,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }
  
  async getAllEvents(
    fromBlock: number = 0,
    toBlock: number | 'latest' = 'latest'
  ): Promise<MultiSigEvent[]> {
    try {
      this.logger?.debug('Querying all contract events', {
        contract: this.contract.target,
        fromBlock,
        toBlock
      });
      
      // Get logs directly from provider with the contract address
      // This is more reliable than using contract.queryFilter("*")
      const filter = {
        address: this.contract.target as string,
        fromBlock: fromBlock,
        toBlock: toBlock
      };
      
      this.logger?.debug('Getting logs with filter', filter);
      
      const logs = await this.provider.getLogs(filter);
      
      this.logger?.debug(`Provider returned ${logs.length} logs`, {
        contract: this.contract.target,
        logsFound: logs.length
      });
      
      const events: MultiSigEvent[] = [];
      
      // Parse each log using the contract interface
      for (const log of logs) {
        try {
          const parsedLog = this.contract.interface.parseLog({
            topics: log.topics as string[],
            data: log.data
          });
          
          if (parsedLog) {
            // Convert to our event format
            const args: Record<string, any> = {};
            if (parsedLog.args) {
              parsedLog.args.forEach((arg, index) => {
                args[index] = typeof arg === 'bigint' ? arg.toString() : arg;
                // Also add named args
                const input = parsedLog.fragment.inputs[index];
                if (input && input.name) {
                  args[input.name] = typeof arg === 'bigint' ? arg.toString() : arg;
                }
              });
            }
            
            events.push({
              event: parsedLog.name,
              address: log.address,
              blockNumber: log.blockNumber,
              blockHash: log.blockHash,
              transactionHash: log.transactionHash,
              transactionIndex: log.transactionIndex,
              logIndex: log.index,
              removed: log.removed || false,
              args: args,
              index: log.index
            });
          }
        } catch (e) {
          this.logger?.warn('Failed to parse contract log', {
            logIndex: log.index,
            blockNumber: log.blockNumber,
            error: e instanceof Error ? e.message : String(e)
          });
        }
      }
      
      // Sort events by block number and log index
      events.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) {
          return a.blockNumber - b.blockNumber;
        }
        return a.logIndex - b.logIndex;
      });
      
      if (events.length > 0) {
        this.logger?.debug(`Found contract events`, {
          totalEvents: events.length,
          eventTypes: [...new Set(events.map(e => e.event))],
          contract: this.contract.target
        });
      }
      
      return events;
    } catch (error) {
      this.logger?.error('Failed to get all events', {
        contract: this.contract.target,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(`Failed to get all events: ${error}`);
    }
  }
  
  // ============================================================================
  // UTILITY METHODS
  // ============================================================================
  
  
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
  private logger?: winston.Logger;
  
  constructor(networkConfigs: Record<string, { rpcUrl: string }>, logger?: winston.Logger) {
    this.logger = logger;
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
    
    return new MultiSigContract(address, provider, hasDailyLimit, this.logger);
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