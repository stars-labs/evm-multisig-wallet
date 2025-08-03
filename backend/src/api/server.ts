// Express server setup and configuration
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import winston from 'winston';
import { ValidatorService } from '../services/validatorService';
import { NetworkType } from '../types';
import { createApiRoutes } from './routes';
import { errorHandler } from './middleware/errorHandler';

export interface ApiServerConfig {
  port: number;
  enableCors: boolean;
  enableLogging: boolean;
  corsOrigins?: string[];
}

export class ApiServer {
  private app: express.Application;
  private server: any;
  private logger: winston.Logger;
  private validatorService: ValidatorService;
  private monitoredNetworks: NetworkType[];
  private config: ApiServerConfig;
  
  constructor(
    validatorService: ValidatorService,
    logger: winston.Logger,
    monitoredNetworks: NetworkType[],
    config: ApiServerConfig
  ) {
    this.validatorService = validatorService;
    this.logger = logger;
    this.monitoredNetworks = monitoredNetworks;
    this.config = config;
    this.app = express();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }
  
  private setupMiddleware(): void {
    // Request parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // CORS
    if (this.config.enableCors) {
      const corsOptions = {
        origin: this.config.corsOrigins || ['http://localhost:3000', 'http://localhost:3001'],
        credentials: true,
        optionsSuccessStatus: 200
      };
      this.app.use(cors(corsOptions));
    }
    
    // Logging
    if (this.config.enableLogging) {
      const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
      this.app.use(morgan(morganFormat, {
        stream: {
          write: (message: string) => {
            this.logger.info(message.trim());
          }
        }
      }));
    }
    
    // Request ID and timing
    this.app.use((req: any, res, next) => {
      req.startTime = Date.now();
      req.requestId = Math.random().toString(36).substring(7);
      res.setHeader('X-Request-ID', req.requestId);
      next();
    });
  }
  
  private setupRoutes(): void {
    // API routes
    this.app.use('/api', createApiRoutes(this.validatorService, this.monitoredNetworks));
    
    // Root health check (legacy)
    this.app.get('/health', (req, res) => {
      res.redirect('/api/health');
    });
    
    this.app.get('/metrics', (req, res) => {
      res.redirect('/api/metrics');
    });
    
    // 404 handler for unknown routes
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: 'Route not found',
        message: `${req.method} ${req.originalUrl} not found`,
        availableEndpoints: '/api'
      });
    });
  }
  
  private setupErrorHandling(): void {
    // Global error handler
    this.app.use(errorHandler(this.logger));
  }
  
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, () => {
          this.logger.info(`API server running on port ${this.config.port}`, {
            port: this.config.port,
            cors: this.config.enableCors,
            logging: this.config.enableLogging,
            monitoredNetworks: this.monitoredNetworks
          });
          resolve();
        });
        
        this.server.on('error', (error: any) => {
          if (error.code === 'EADDRINUSE') {
            this.logger.error(`Port ${this.config.port} is already in use`);
          } else {
            this.logger.error('Server error:', error);
          }
          reject(error);
        });
        
      } catch (error) {
        this.logger.error('Failed to start API server:', error);
        reject(error);
      }
    });
  }
  
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.logger.info('API server stopped');
          resolve();
        });
      });
    }
  }
  
  getApp(): express.Application {
    return this.app;
  }
}