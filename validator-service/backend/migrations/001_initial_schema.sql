-- Migration: 001_initial_schema
-- Description: Create initial database schema for MultiSig Validator Service
-- Created: 2024-01-15

BEGIN;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- Create enum types
CREATE TYPE network_type AS ENUM ('mainnet', 'sepolia', 'goerli', 'polygon', 'arbitrum');
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

-- Create tables
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    address VARCHAR(42) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    network network_type NOT NULL,
    type wallet_type NOT NULL,
    owners JSONB NOT NULL DEFAULT '[]',
    required INTEGER NOT NULL,
    daily_limit DECIMAL(78,0) DEFAULT NULL,
    balance DECIMAL(78,0) NOT NULL DEFAULT 0,
    monitored BOOLEAN NOT NULL DEFAULT true,
    alert_thresholds JSONB NOT NULL DEFAULT '{}',
    contact_list JSONB NOT NULL DEFAULT '[]',
    slack_webhook VARCHAR(500),
    notification_channels JSONB NOT NULL DEFAULT '[]',
    registered_by VARCHAR(255) NOT NULL,
    registered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_activity TIMESTAMP WITH TIME ZONE,
    last_sync TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT wallets_address_network_unique UNIQUE (address, network)
);

CREATE TABLE owners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    address VARCHAR(42) NOT NULL,
    network network_type NOT NULL,
    first_seen TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    wallets JSONB NOT NULL DEFAULT '[]',
    transaction_count INTEGER NOT NULL DEFAULT 0,
    last_activity TIMESTAMP WITH TIME ZONE,
    name VARCHAR(255),
    organization VARCHAR(255),
    role VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    verified BOOLEAN NOT NULL DEFAULT false,
    approved_by VARCHAR(255),
    approved_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    risk_level risk_level NOT NULL DEFAULT 'medium',
    confidence_score INTEGER NOT NULL DEFAULT 50 CHECK (confidence_score >= 0 AND confidence_score <= 100),
    status owner_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT owners_address_network_unique UNIQUE (address, network)
);

CREATE TABLE recipients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    address VARCHAR(42) NOT NULL,
    network network_type NOT NULL,
    name VARCHAR(255),
    category VARCHAR(100),
    description TEXT,
    risk_level risk_level NOT NULL DEFAULT 'low',
    verified BOOLEAN NOT NULL DEFAULT false,
    source VARCHAR(100) NOT NULL,
    added_by VARCHAR(255) NOT NULL,
    verified_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT recipients_address_network_unique UNIQUE (address, network)
);

CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    transaction_id INTEGER NOT NULL,
    block_number BIGINT,
    transaction_hash VARCHAR(66),
    action transaction_action NOT NULL,
    submitter VARCHAR(42) NOT NULL,
    destination VARCHAR(42),
    value DECIMAL(78,0) NOT NULL DEFAULT 0,
    data TEXT,
    decoded_data JSONB,
    wallet_balance DECIMAL(78,0) NOT NULL,
    transfer_percentage DECIMAL(5,2),
    gas_price DECIMAL(78,0),
    gas_limit BIGINT,
    validation_status validation_status NOT NULL DEFAULT 'pending',
    risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 10),
    risk_factors JSONB NOT NULL DEFAULT '[]',
    confirmations JSONB NOT NULL DEFAULT '[]',
    required_confirmations INTEGER NOT NULL,
    executed_at TIMESTAMP WITH TIME ZONE,
    execution_status VARCHAR(20),
    submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    validated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT transactions_wallet_tx_unique UNIQUE (wallet_id, transaction_id)
);

CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
    priority alert_priority NOT NULL,
    type VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    risk_level risk_level NOT NULL,
    severity_score INTEGER NOT NULL DEFAULT 0 CHECK (severity_score >= 0 AND severity_score <= 100),
    context JSONB NOT NULL DEFAULT '{}',
    notification_channels JSONB NOT NULL DEFAULT '[]',
    notified_at TIMESTAMP WITH TIME ZONE,
    status alert_status NOT NULL DEFAULT 'active',
    acknowledged_by VARCHAR(255),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_by VARCHAR(255),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE configurations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID REFERENCES wallets(id) ON DELETE CASCADE,
    scope VARCHAR(50) NOT NULL,
    category VARCHAR(100) NOT NULL,
    settings JSONB NOT NULL DEFAULT '{}',
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(255),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT configurations_scope_unique UNIQUE (wallet_id, scope, category)
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    channel notification_channel NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    subject VARCHAR(255),
    content TEXT NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMP WITH TIME ZONE,
    delivery_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    error_message TEXT,
    opened_at TIMESTAMP WITH TIME ZONE,
    clicked_at TIMESTAMP WITH TIME ZONE,
    response_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    user_id VARCHAR(255),
    user_agent TEXT,
    ip_address INET,
    old_values JSONB,
    new_values JSONB,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT
);

-- Create hypertables for time-series data
SELECT create_hypertable('transactions', 'submitted_at');
SELECT create_hypertable('alerts', 'created_at');
SELECT create_hypertable('notifications', 'sent_at');
SELECT create_hypertable('audit_logs', 'timestamp');

-- Create indexes
CREATE INDEX idx_wallets_network ON wallets(network);
CREATE INDEX idx_wallets_monitored ON wallets(monitored) WHERE monitored = true;
CREATE INDEX idx_wallets_last_activity ON wallets(last_activity);

CREATE INDEX idx_owners_network ON owners(network);
CREATE INDEX idx_owners_status ON owners(status);
CREATE INDEX idx_owners_risk_level ON owners(risk_level);
CREATE INDEX idx_owners_verified ON owners(verified);
CREATE INDEX idx_owners_last_activity ON owners(last_activity);

CREATE INDEX idx_recipients_network ON recipients(network);
CREATE INDEX idx_recipients_risk_level ON recipients(risk_level);
CREATE INDEX idx_recipients_verified ON recipients(verified);
CREATE INDEX idx_recipients_category ON recipients(category);

CREATE INDEX idx_transactions_wallet_id ON transactions(wallet_id);
CREATE INDEX idx_transactions_action ON transactions(action);
CREATE INDEX idx_transactions_validation_status ON transactions(validation_status);
CREATE INDEX idx_transactions_risk_score ON transactions(risk_score);
CREATE INDEX idx_transactions_submitter ON transactions(submitter);
CREATE INDEX idx_transactions_destination ON transactions(destination);
CREATE INDEX idx_transactions_block_number ON transactions(block_number);

CREATE INDEX idx_alerts_wallet_id ON alerts(wallet_id);
CREATE INDEX idx_alerts_transaction_id ON alerts(transaction_id);
CREATE INDEX idx_alerts_priority ON alerts(priority);
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_type ON alerts(type);
CREATE INDEX idx_alerts_risk_level ON alerts(risk_level);

CREATE INDEX idx_notifications_alert_id ON notifications(alert_id);
CREATE INDEX idx_notifications_channel ON notifications(channel);
CREATE INDEX idx_notifications_delivery_status ON notifications(delivery_status);

CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);

-- Create functions and triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_wallets_updated_at BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_owners_updated_at BEFORE UPDATE ON owners FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_recipients_updated_at BEFORE UPDATE ON recipients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_transactions_updated_at BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_alerts_updated_at BEFORE UPDATE ON alerts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_configurations_updated_at BEFORE UPDATE ON configurations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_notifications_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Create views
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

COMMIT;