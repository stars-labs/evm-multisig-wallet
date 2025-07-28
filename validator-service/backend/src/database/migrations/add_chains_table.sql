-- Migration: Add chains table for multi-chain configuration and sync state
-- This replaces in-memory sync state with persistent database storage

-- Create chains table
CREATE TABLE IF NOT EXISTS chains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Chain identification
    network network_type NOT NULL UNIQUE,
    chain_id INTEGER NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    
    -- Chain configuration
    rpc_url VARCHAR(500) NOT NULL,
    rpc_backup_urls JSONB DEFAULT '[]', -- Array of backup RPC URLs
    
    -- Block and sync configuration  
    block_confirmations INTEGER NOT NULL DEFAULT 3,
    start_block BIGINT NOT NULL DEFAULT 0,
    last_processed_block BIGINT NOT NULL DEFAULT 0,
    
    -- Rate limiting configuration
    rate_limit_rps INTEGER NOT NULL DEFAULT 5, -- Requests per second
    rate_limit_rpm INTEGER NOT NULL DEFAULT 100, -- Requests per minute  
    rate_limit_backoff_multiplier DECIMAL(3,1) NOT NULL DEFAULT 1.5,
    rate_limit_max_backoff_ms INTEGER NOT NULL DEFAULT 60000,
    
    -- Sync configuration
    sync_interval_ms INTEGER NOT NULL DEFAULT 30000, -- 30 seconds
    max_blocks_per_batch INTEGER NOT NULL DEFAULT 1000,
    batch_size INTEGER NOT NULL DEFAULT 100,
    
    -- Chain status
    enabled BOOLEAN NOT NULL DEFAULT true,
    sync_status VARCHAR(20) NOT NULL DEFAULT 'stopped', -- stopped, running, error, paused
    last_sync_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    last_error_at TIMESTAMP WITH TIME ZONE,
    
    -- Health metrics
    consecutive_errors INTEGER NOT NULL DEFAULT 0,
    total_requests INTEGER NOT NULL DEFAULT 0,
    total_errors INTEGER NOT NULL DEFAULT 0,
    avg_response_time_ms INTEGER,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_chains_network ON chains(network);
CREATE INDEX idx_chains_enabled ON chains(enabled) WHERE enabled = true;
CREATE INDEX idx_chains_sync_status ON chains(sync_status);
CREATE INDEX idx_chains_last_sync ON chains(last_sync_at);

-- Create updated_at trigger
CREATE TRIGGER tr_chains_updated_at 
    BEFORE UPDATE ON chains 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at();

-- Insert default chain configurations
INSERT INTO chains (
    network, chain_id, name, rpc_url, 
    block_confirmations, start_block, 
    rate_limit_rps, rate_limit_rpm,
    sync_interval_ms, max_blocks_per_batch
) VALUES
-- Mainnet
('mainnet', 1, 'Ethereum Mainnet', 
 COALESCE(NULLIF(current_setting('app.mainnet_rpc_url', true), ''), 'https://mainnet.infura.io/v3/YOUR_PROJECT_ID'),
 12, 0, 3, 50, 60000, 500),

-- Sepolia Testnet  
('sepolia', 11155111, 'Ethereum Sepolia Testnet',
 COALESCE(NULLIF(current_setting('app.sepolia_rpc_url', true), ''), 'https://sepolia.infura.io/v3/76b6da167a1a45ecb381010150ee9d31'),
 3, 0, 2, 30, 45000, 100),

-- Goerli Testnet
('goerli', 5, 'Ethereum Goerli Testnet',
 COALESCE(NULLIF(current_setting('app.goerli_rpc_url', true), ''), 'https://goerli.infura.io/v3/YOUR_PROJECT_ID'),
 3, 0, 3, 50, 30000, 200),

-- Polygon
('polygon', 137, 'Polygon Mainnet',
 COALESCE(NULLIF(current_setting('app.polygon_rpc_url', true), ''), 'https://polygon-mainnet.infura.io/v3/YOUR_PROJECT_ID'),
 20, 0, 5, 100, 15000, 1000),

-- Arbitrum
('arbitrum', 42161, 'Arbitrum One',
 COALESCE(NULLIF(current_setting('app.arbitrum_rpc_url', true), ''), 'https://arbitrum-mainnet.infura.io/v3/YOUR_PROJECT_ID'),
 1, 0, 10, 200, 15000, 2000),

-- Localhost for development
('localhost', 31337, 'Local Hardhat Network',
 COALESCE(NULLIF(current_setting('app.localhost_rpc_url', true), ''), 'http://127.0.0.1:8545'),
 1, 1, 50, 1000, 5000, 10000)

ON CONFLICT (network) DO UPDATE SET
    rpc_url = EXCLUDED.rpc_url,
    updated_at = NOW();

COMMENT ON TABLE chains IS 'Multi-chain configuration and sync state management';
COMMENT ON COLUMN chains.last_processed_block IS 'Last block number that was successfully processed for event sync';
COMMENT ON COLUMN chains.sync_status IS 'Current sync status: stopped, running, error, paused';
COMMENT ON COLUMN chains.rate_limit_rps IS 'Rate limit: requests per second for this chains RPC';
COMMENT ON COLUMN chains.consecutive_errors IS 'Number of consecutive errors, used for backoff calculation';