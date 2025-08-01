// Winston logger configuration
import winston from 'winston';
import config from '../config';

const { combine, timestamp, errors, json, printf, colorize } = winston.format;

// Helper function to serialize BigInt values
const serializeBigInt = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeBigInt(value);
    }
    return result;
  }
  return obj;
};

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, service, ...meta }) => {
  let output = `${timestamp} [${service || 'validator'}] ${level}: ${message}`;
  
  if (Object.keys(meta).length > 0) {
    try {
      output += ` ${JSON.stringify(serializeBigInt(meta))}`;
    } catch (error) {
      output += ` [Error serializing metadata: ${error}]`;
    }
  }
  
  return output;
});

// Create logger instance
export const logger = winston.createLogger({
  level: config.logging.level,
  defaultMeta: { service: 'multisig-validator' },
  format: combine(
    timestamp(),
    errors({ stack: true }),
    json()
  ),
  transports: [
    // Console transport
    ...(config.logging.console ? [
      new winston.transports.Console({
        format: combine(
          colorize(),
          timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          consoleFormat
        ),
      })
    ] : []),
    
    // File transports
    ...(config.logging.file ? [
      // Error log file
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
        tailable: true,
      }),
      
      // Combined log file
      new winston.transports.File({
        filename: 'logs/validator-service.log',
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 10,
        tailable: true,
      }),
    ] : []),
  ],
  
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: 'logs/exceptions.log',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3,
    }),
    ...(config.logging.console ? [
      new winston.transports.Console({
        format: combine(
          colorize(),
          timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          consoleFormat
        ),
      })
    ] : []),
  ],
  
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: 'logs/rejections.log',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});

// Create logs directory if it doesn't exist
if (config.logging.file) {
  const fs = require('fs');
  const path = require('path');
  
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

// Add request logging helper
export const requestLogger = winston.createLogger({
  level: 'info',
  defaultMeta: { service: 'api' },
  format: combine(
    timestamp(),
    json()
  ),
  transports: [
    new winston.transports.File({
      filename: 'logs/requests.log',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
  ],
});

export default logger;