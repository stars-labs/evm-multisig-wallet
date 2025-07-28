// Debug test to examine actual event structure from the multisig wallet
import dotenv from 'dotenv';
dotenv.config();

import { ethers } from 'ethers';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      let output = `${timestamp} ${level}: ${message}`;
      if (Object.keys(meta).length > 0) {
        output += ` ${JSON.stringify(meta, (key, value) => 
          typeof value === 'bigint' ? value.toString() : value, 2)}`;
      }
      return output;
    })
  ),
  transports: [new winston.transports.Console()],
});

// MultiSig Wallet ABI with detailed event signatures
const MULTISIG_ABI = [
  'event Submission(uint indexed transactionId)',
  'event Confirmation(address indexed sender, uint indexed transactionId)',
  'event Execution(uint indexed transactionId)',
  'function getTransaction(uint transactionId) view returns (address destination, uint value, bytes data, bool executed)',
  'function transactionCount() view returns (uint)',
];

async function debugEvents() {
  logger.info('🔍 Debug: Examining MultiSig Event Structure');
  
  try {
    const rpcUrl = process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/76b6da167a1a45ecb381010150ee9d31';
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    
    const walletAddress = '0x9f39A39631b2E49B59A614D37465431890612b5a';
    const contract = new ethers.Contract(walletAddress, MULTISIG_ABI, provider);
    
    logger.info('📊 Checking current transaction count...');
    const txCount = await contract.transactionCount();
    logger.info(`Current transaction count: ${txCount}`);
    
    // Get recent events
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 2000); // Look back 2000 blocks
    
    logger.info(`🔍 Searching events from block ${fromBlock} to ${currentBlock}`);
    
    // Get Submission events
    logger.info('📝 Getting Submission events...');
    const submissionFilter = contract.filters.Submission();
    const submissionEvents = await contract.queryFilter(submissionFilter, fromBlock);
    
    logger.info(`Found ${submissionEvents.length} Submission events:`);
    for (const event of submissionEvents) {
      const eventLog = event as ethers.EventLog;
      logger.info('Submission Event:', {
        event: eventLog.eventName,
        fragment: eventLog.fragment?.name,
        args: eventLog.args,
        argsArray: Array.from(eventLog.args || []),
        transactionId: eventLog.args?.transactionId,
        transactionIdString: eventLog.args?.transactionId?.toString(),
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
      });
      
      // Try to get transaction details
      if (eventLog.args?.transactionId !== undefined) {
        try {
          const txId = Number(eventLog.args.transactionId);
          logger.info(`Getting transaction details for ID ${txId}...`);
          const txDetails = await contract.getTransaction(txId);
          logger.info('Transaction details:', {
            destination: txDetails[0],
            value: txDetails[1].toString(),
            data: txDetails[2],
            executed: txDetails[3],
          });
        } catch (error) {
          logger.error('Failed to get transaction details:', error);
        }
      }
    }
    
    // Get Confirmation events
    logger.info('📝 Getting Confirmation events...');
    const confirmationFilter = contract.filters.Confirmation();
    const confirmationEvents = await contract.queryFilter(confirmationFilter, fromBlock);
    
    logger.info(`Found ${confirmationEvents.length} Confirmation events:`);
    for (const event of confirmationEvents) {
      const eventLog = event as ethers.EventLog;
      logger.info('Confirmation Event:', {
        event: eventLog.eventName,
        fragment: eventLog.fragment?.name,
        args: eventLog.args,
        argsArray: Array.from(eventLog.args || []),
        sender: eventLog.args?.sender,
        transactionId: eventLog.args?.transactionId,
        transactionIdString: eventLog.args?.transactionId?.toString(),
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
      });
    }
    
    // Get Execution events
    logger.info('📝 Getting Execution events...');
    const executionFilter = contract.filters.Execution();
    const executionEvents = await contract.queryFilter(executionFilter, fromBlock);
    
    logger.info(`Found ${executionEvents.length} Execution events:`);
    for (const event of executionEvents) {
      const eventLog = event as ethers.EventLog;
      logger.info('Execution Event:', {
        event: eventLog.eventName,
        fragment: eventLog.fragment?.name,
        args: eventLog.args,
        argsArray: Array.from(eventLog.args || []),
        transactionId: eventLog.args?.transactionId,
        transactionIdString: eventLog.args?.transactionId?.toString(),
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
      });
    }
    
  } catch (error) {
    logger.error('❌ Debug test failed:', error);
  }
}

// Run the debug test
debugEvents();