-- MultiSig Wallet Validator Service Database Schema
-- PostgreSQL with TimescaleDB extension for time-series data

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- Enum types for better type safety
CREATE TYPE network_type AS ENUM ('mainnet', 'sepolia', 'goerli', 'polygon', 'arbitrum', 'localhost');
CREATE TYPE wallet_type AS ENUM ('MultiSigWallet', 'MultiSigWalletWithDailyLimit', 'GnosisSafe');
CREATE TYPE transaction_action AS ENUM (
    'transfer', 'addOwner', 'removeOwner', 'replaceOwner', 
    'changeRequirement', 'changeDailyLimit', 'contractCall'
);
CREATE TYPE validation_status AS ENUM ('pending', 'approved', 'flagged', 'rejected');
CREATE TYPE alert_priority AS ENUM ('P1', 'P2', 'P3');
CREATE TYPE alert_status AS ENUM ('active', 'acknowledged', 'resolved', 'false_positive');
CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE owner_status AS ENUM ('active', 'inactive', 'flagged', 'removed');
CREATE TYPE notification_channel AS ENUM ('email', 'slack', 'discord', 'webhook', 'sms');

-- ============================================================================
-- CORE ENTITIES
-- ============================================================================

-- Multi-chain configuration and sync state management
CREATE TABLE chains (
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

-- Registered wallets for monitoring
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    address VARCHAR(42) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    network network_type NOT NULL,
    type wallet_type NOT NULL,
    
    -- Contract state (updated from blockchain)
    owners JSONB NOT NULL DEFAULT '[]', -- Array of owner addresses
    required INTEGER NOT NULL,
    daily_limit DECIMAL(78,0) DEFAULT NULL, -- Wei amount, NULL if no limit
    balance DECIMAL(78,0) NOT NULL DEFAULT 0,
    
    -- Monitoring configuration
    monitored BOOLEAN NOT NULL DEFAULT true,
    alert_thresholds JSONB NOT NULL DEFAULT '{}',
    
    -- Communication settings
    contact_list JSONB NOT NULL DEFAULT '[]', -- Array of email addresses
    slack_webhook VARCHAR(500),
    notification_channels JSONB NOT NULL DEFAULT '[]', -- Array of enabled channels
    
    -- Metadata
    registered_by VARCHAR(255) NOT NULL,
    registered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_activity TIMESTAMP WITH TIME ZONE,
    last_sync TIMESTAMP WITH TIME ZONE,
    
    -- Indexes
    CONSTRAINT wallets_address_network_unique UNIQUE (address, network)
);

-- Owner recognition and verification database
CREATE TABLE owners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    address VARCHAR(42) NOT NULL,
    network network_type NOT NULL,
    
    -- Automatic discovery data
    first_seen TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    wallets JSONB NOT NULL DEFAULT '[]', -- Array of wallet addresses this owner belongs to
    transaction_count INTEGER NOT NULL DEFAULT 0,
    last_activity TIMESTAMP WITH TIME ZONE,
    
    -- Manual enhancement data
    name VARCHAR(255),
    organization VARCHAR(255),
    role VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    verified BOOLEAN NOT NULL DEFAULT false,
    approved_by VARCHAR(255),
    approved_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    
    -- Computed fields
    risk_level risk_level NOT NULL DEFAULT 'medium',
    confidence_score INTEGER NOT NULL DEFAULT 50 CHECK (confidence_score >= 0 AND confidence_score <= 100),
    status owner_status NOT NULL DEFAULT 'active',
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Indexes
    CONSTRAINT owners_address_network_unique UNIQUE (address, network)
);

-- Recipient whitelist for known safe addresses
CREATE TABLE recipients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    address VARCHAR(42) NOT NULL,
    network network_type NOT NULL,
    
    -- Classification
    name VARCHAR(255),
    category VARCHAR(100), -- 'exchange', 'defi', 'treasury', 'personal', 'contract'
    description TEXT,
    
    -- Risk assessment
    risk_level risk_level NOT NULL DEFAULT 'low',
    verified BOOLEAN NOT NULL DEFAULT false,
    
    -- Source of information
    source VARCHAR(100) NOT NULL, -- 'manual', 'etherscan', 'defipulse', 'coinbase'
    added_by VARCHAR(255) NOT NULL,
    verified_by VARCHAR(255),
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Indexes
    CONSTRAINT recipients_address_network_unique UNIQUE (address, network)
);

-- ============================================================================
-- TRANSACTION MONITORING
-- ============================================================================

-- Transaction submissions and validations
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    
    -- Blockchain data
    transaction_id INTEGER NOT NULL, -- MultiSig transaction ID
    block_number BIGINT,
    transaction_hash VARCHAR(66),
    
    -- Transaction details
    action transaction_action NOT NULL,
    submitter VARCHAR(42) NOT NULL,
    destination VARCHAR(42),
    value DECIMAL(78,0) NOT NULL DEFAULT 0,
    data TEXT, -- Raw transaction data
    decoded_data JSONB, -- Parsed function call data
    
    -- Context at time of submission
    wallet_balance DECIMAL(78,0) NOT NULL,
    transfer_percentage DECIMAL(5,2), -- Percentage of wallet balance
    gas_price DECIMAL(78,0),
    gas_limit BIGINT,
    
    -- Validation results
    validation_status validation_status NOT NULL DEFAULT 'pending',
    risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 10),
    risk_factors JSONB NOT NULL DEFAULT '[]', -- Array of risk factor strings
    
    -- Execution tracking
    confirmations JSONB NOT NULL DEFAULT '[]', -- Array of {owner, confirmedAt}
    required_confirmations INTEGER NOT NULL,
    executed_at TIMESTAMP WITH TIME ZONE,
    execution_status VARCHAR(20), -- 'pending', 'executed', 'failed'
    executor VARCHAR(42), -- Address that executed the transaction (final confirmer who triggered execution)
    
    -- Timeline
    submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    validated_at TIMESTAMP WITH TIME ZONE,
    
    -- Indexes
    CONSTRAINT transactions_wallet_tx_unique UNIQUE (wallet_id, transaction_id)
);

-- Convert transactions table to hypertable for time-series optimization
SELECT create_hypertable('transactions', 'submitted_at');

-- ============================================================================
-- ALERTING SYSTEM
-- ============================================================================

-- Generated alerts with priority and status tracking
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
    
    -- Alert classification
    priority alert_priority NOT NULL,
    type VARCHAR(100) NOT NULL, -- 'unknown_recipient', 'large_transfer', 'owner_change', etc.
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    
    -- Risk assessment
    risk_level risk_level NOT NULL,
    severity_score INTEGER NOT NULL DEFAULT 0 CHECK (severity_score >= 0 AND severity_score <= 100),
    
    -- Context data
    context JSONB NOT NULL DEFAULT '{}', -- Additional alert-specific data
    
    -- Notification tracking
    notification_channels JSONB NOT NULL DEFAULT '[]', -- Channels where alert was sent
    notified_at TIMESTAMP WITH TIME ZONE,
    
    -- Alert lifecycle
    status alert_status NOT NULL DEFAULT 'active',
    acknowledged_by VARCHAR(255),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_by VARCHAR(255),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Convert alerts table to hypertable
SELECT create_hypertable('alerts', 'created_at');

-- ============================================================================
-- CONFIGURATION AND SETTINGS
-- ============================================================================

-- Global and per-wallet configuration
CREATE TABLE configurations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID REFERENCES wallets(id) ON DELETE CASCADE, -- NULL for global config
    
    -- Configuration scope
    scope VARCHAR(50) NOT NULL, -- 'global', 'wallet', 'network'
    category VARCHAR(100) NOT NULL, -- 'thresholds', 'notifications', 'validation'
    
    -- Configuration data
    settings JSONB NOT NULL DEFAULT '{}',
    
    -- Metadata
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(255),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Ensure one config per scope/category combination
    CONSTRAINT configurations_scope_unique UNIQUE (wallet_id, scope, category)
);

-- Notification history for tracking and analytics
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    
    -- Notification details
    channel notification_channel NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    subject VARCHAR(255),
    content TEXT NOT NULL,
    
    -- Delivery tracking
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMP WITH TIME ZONE,
    delivery_status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'failed'
    error_message TEXT,
    
    -- Response tracking
    opened_at TIMESTAMP WITH TIME ZONE,
    clicked_at TIMESTAMP WITH TIME ZONE,
    response_data JSONB
);

-- Convert notifications table to hypertable
SELECT create_hypertable('notifications', 'sent_at');

-- ============================================================================
-- AUDIT AND LOGGING
-- ============================================================================

-- System audit log for all important actions
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Action details
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL, -- 'wallet', 'owner', 'transaction', 'alert'
    entity_id UUID,
    
    -- User context
    user_id VARCHAR(255),
    user_agent TEXT,
    ip_address INET,
    
    -- Change tracking
    old_values JSONB,
    new_values JSONB,
    
    -- Metadata
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT
);

-- Convert audit_logs table to hypertable
SELECT create_hypertable('audit_logs', 'timestamp');

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Chains
CREATE INDEX idx_chains_network ON chains(network);
CREATE INDEX idx_chains_enabled ON chains(enabled) WHERE enabled = true;
CREATE INDEX idx_chains_sync_status ON chains(sync_status);
CREATE INDEX idx_chains_last_sync ON chains(last_sync_at);

-- Wallets
CREATE INDEX idx_wallets_network ON wallets(network);
CREATE INDEX idx_wallets_monitored ON wallets(monitored) WHERE monitored = true;
CREATE INDEX idx_wallets_last_activity ON wallets(last_activity);

-- Owners
CREATE INDEX idx_owners_network ON owners(network);
CREATE INDEX idx_owners_status ON owners(status);
CREATE INDEX idx_owners_risk_level ON owners(risk_level);
CREATE INDEX idx_owners_verified ON owners(verified);
CREATE INDEX idx_owners_last_activity ON owners(last_activity);

-- Recipients
CREATE INDEX idx_recipients_network ON recipients(network);
CREATE INDEX idx_recipients_risk_level ON recipients(risk_level);
CREATE INDEX idx_recipients_verified ON recipients(verified);
CREATE INDEX idx_recipients_category ON recipients(category);

-- Transactions
CREATE INDEX idx_transactions_wallet_id ON transactions(wallet_id);
CREATE INDEX idx_transactions_action ON transactions(action);
CREATE INDEX idx_transactions_validation_status ON transactions(validation_status);
CREATE INDEX idx_transactions_risk_score ON transactions(risk_score);
CREATE INDEX idx_transactions_submitter ON transactions(submitter);
CREATE INDEX idx_transactions_destination ON transactions(destination);
CREATE INDEX idx_transactions_block_number ON transactions(block_number);

-- Alerts
CREATE INDEX idx_alerts_wallet_id ON alerts(wallet_id);
CREATE INDEX idx_alerts_transaction_id ON alerts(transaction_id);
CREATE INDEX idx_alerts_priority ON alerts(priority);
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_type ON alerts(type);
CREATE INDEX idx_alerts_risk_level ON alerts(risk_level);

-- Notifications
CREATE INDEX idx_notifications_alert_id ON notifications(alert_id);
CREATE INDEX idx_notifications_channel ON notifications(channel);
CREATE INDEX idx_notifications_delivery_status ON notifications(delivery_status);

-- Audit logs
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);

-- ============================================================================
-- FUNCTIONS AND TRIGGERS
-- ============================================================================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER tr_chains_updated_at BEFORE UPDATE ON chains FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_owners_updated_at BEFORE UPDATE ON owners FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_recipients_updated_at BEFORE UPDATE ON recipients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_alerts_updated_at BEFORE UPDATE ON alerts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_configurations_updated_at BEFORE UPDATE ON configurations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Function to automatically update owner activity
CREATE OR REPLACE FUNCTION update_owner_activity()
RETURNS TRIGGER AS $$
BEGIN
    -- Update last_activity for the submitter
    UPDATE owners 
    SET last_activity = NEW.submitted_at,
        transaction_count = transaction_count + 1
    WHERE address = NEW.submitter 
    AND network = (SELECT network FROM wallets WHERE id = NEW.wallet_id);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update owner activity when transaction is submitted
CREATE TRIGGER tr_update_owner_activity 
    AFTER INSERT ON transactions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_owner_activity();

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- View for wallet summary with latest activity
CREATE VIEW wallet_summary AS
SELECT 
    w.*,
    COALESCE(t.latest_transaction, w.registered_at) as latest_activity,
    COALESCE(t.transaction_count, 0) as transaction_count,
    COALESCE(a.active_alerts, 0) as active_alerts,
    COALESCE(a.critical_alerts, 0) as critical_alerts
FROM wallets w
LEFT JOIN (
    SELECT 
        wallet_id,
        COUNT(*) as transaction_count,
        MAX(submitted_at) as latest_transaction
    FROM transactions 
    GROUP BY wallet_id
) t ON w.id = t.wallet_id
LEFT JOIN (
    SELECT 
        wallet_id,
        COUNT(*) as active_alerts,
        COUNT(*) FILTER (WHERE priority = 'P1') as critical_alerts
    FROM alerts 
    WHERE status = 'active'
    GROUP BY wallet_id
) a ON w.id = a.wallet_id;

-- View for transaction validation summary
CREATE VIEW transaction_validation_summary AS
SELECT 
    t.*,
    w.name as wallet_name,
    w.address as wallet_address,
    o.name as submitter_name,
    o.organization as submitter_organization,
    r.name as recipient_name,
    r.risk_level as recipient_risk_level,
    CASE 
        WHEN t.destination IS NOT NULL AND r.id IS NULL THEN true 
        ELSE false 
    END as is_unknown_recipient
FROM transactions t
JOIN wallets w ON t.wallet_id = w.id
LEFT JOIN owners o ON t.submitter = o.address AND o.network = w.network
LEFT JOIN recipients r ON t.destination = r.address AND r.network = w.network;

-- View for alert dashboard
CREATE VIEW alert_dashboard AS
SELECT 
    a.*,
    w.name as wallet_name,
    w.address as wallet_address,
    t.action as transaction_action,
    t.destination as transaction_destination,
    t.value as transaction_value
FROM alerts a
JOIN wallets w ON a.wallet_id = w.id
LEFT JOIN transactions t ON a.transaction_id = t.id
ORDER BY a.created_at DESC;

-- ============================================================================
-- INITIAL CONFIGURATION DATA
-- ============================================================================

-- Default global configuration
INSERT INTO configurations (scope, category, settings, created_by) VALUES
('global', 'thresholds', '{
    "defaultTransferPercentage": 10,
    "defaultRapidTransactionCount": 3,
    "defaultRapidTransactionWindow": 3600,
    "defaultDailyLimitIncreasePercent": 50,
    "riskScoreThresholds": {
        "low": 3,
        "medium": 6,
        "high": 8
    }
}', 'system'),
('global', 'notifications', '{
    "retryAttempts": 3,
    "retryDelay": 300,
    "maxNotificationsPerHour": 50,
    "channels": {
        "email": {"enabled": true, "rateLimit": 10},
        "slack": {"enabled": true, "rateLimit": 20}
    }
}', 'system'),
('global', 'validation', '{
    "enableOwnerLearning": true,
    "autoApproveKnownRecipients": false,
    "requireManualApprovalForHighRisk": true,
    "confidenceThresholds": {
        "autoApprove": 90,
        "requireReview": 70
    }
}', 'system');

-- Initial chain configurations
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

-- Common recipient categories for initial classification
INSERT INTO recipients (address, network, name, category, risk_level, verified, source, added_by) VALUES
('0x0000000000000000000000000000000000000000', 'sepolia', 'Burn Address', 'burn', 'medium', true, 'manual', 'system'),
('0xdAC17F958D2ee523a2206206994597C13D831ec7', 'mainnet', 'Tether USD (USDT)', 'token', 'low', true, 'manual', 'system'),
('0xA0b86a33E6411a3344c45b6D3b7eB0B99d3e3d7a', 'mainnet', 'Uniswap V3: Router', 'defi', 'low', true, 'manual', 'system');

COMMENT ON TABLE chains IS 'Multi-chain configuration and sync state management';
COMMENT ON TABLE wallets IS 'Registered MultiSig wallets for monitoring and validation';
COMMENT ON TABLE owners IS 'Owner recognition database with automatic learning and manual verification';
COMMENT ON TABLE recipients IS 'Whitelist of known recipients with risk assessment';
COMMENT ON TABLE transactions IS 'Transaction submissions with validation results and risk scoring';
COMMENT ON TABLE alerts IS 'Generated alerts with priority-based notification system';
COMMENT ON TABLE configurations IS 'System and wallet-specific configuration settings';
COMMENT ON TABLE notifications IS 'Notification delivery history and tracking';
COMMENT ON TABLE audit_logs IS 'System audit trail for all important actions';