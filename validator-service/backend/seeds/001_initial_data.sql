-- Seed Data: 001_initial_data
-- Description: Insert initial configuration and sample data
-- Created: 2024-01-15

BEGIN;

-- ============================================================================
-- GLOBAL CONFIGURATIONS
-- ============================================================================

-- Default global thresholds
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
}', 'system');

-- Global notification settings
INSERT INTO configurations (scope, category, settings, created_by) VALUES
('global', 'notifications', '{
    "retryAttempts": 3,
    "retryDelay": 300,
    "maxNotificationsPerHour": 50,
    "channels": {
        "email": {"enabled": true, "rateLimit": 10},
        "slack": {"enabled": true, "rateLimit": 20},
        "discord": {"enabled": false, "rateLimit": 15},
        "webhook": {"enabled": true, "rateLimit": 30},
        "sms": {"enabled": false, "rateLimit": 5}
    }
}', 'system');

-- Global validation settings
INSERT INTO configurations (scope, category, settings, created_by) VALUES
('global', 'validation', '{
    "enableOwnerLearning": true,
    "autoApproveKnownRecipients": false,
    "requireManualApprovalForHighRisk": true,
    "confidenceThresholds": {
        "autoApprove": 90,
        "requireReview": 70
    },
    "validationRules": {
        "unknownRecipientThreshold": 5,
        "highValueTransferThreshold": 15,
        "rapidTransactionThreshold": 3,
        "governanceChangeRequiresReview": true
    }
}', 'system');

-- ============================================================================
-- KNOWN RECIPIENTS (WHITELIST)
-- ============================================================================

-- Common Ethereum addresses
INSERT INTO recipients (address, network, name, category, risk_level, verified, source, added_by) VALUES
-- Burn addresses
('0x0000000000000000000000000000000000000000', 'mainnet', 'Null Address', 'burn', 'medium', true, 'manual', 'system'),
('0x0000000000000000000000000000000000000000', 'sepolia', 'Null Address', 'burn', 'medium', true, 'manual', 'system'),
('0x000000000000000000000000000000000000dead', 'mainnet', 'Dead Address', 'burn', 'medium', true, 'manual', 'system'),
('0x000000000000000000000000000000000000dead', 'sepolia', 'Dead Address', 'burn', 'medium', true, 'manual', 'system'),

-- Major tokens (Mainnet)
('0xdAC17F958D2ee523a2206206994597C13D831ec7', 'mainnet', 'Tether USD (USDT)', 'token', 'low', true, 'manual', 'system'),
('0xA0b86a33E6411a3344c45b6D3b7eB0B99d3e3d7a', 'mainnet', 'USD Coin (USDC)', 'token', 'low', true, 'manual', 'system'),
('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', 'mainnet', 'Wrapped Bitcoin (WBTC)', 'token', 'low', true, 'manual', 'system'),
('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'mainnet', 'Wrapped Ether (WETH)', 'token', 'low', true, 'manual', 'system'),

-- Major DeFi protocols (Mainnet)
('0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9', 'mainnet', 'Aave: Lending Pool', 'defi', 'low', true, 'manual', 'system'),
('0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B', 'mainnet', 'Compound: cETH', 'defi', 'low', true, 'manual', 'system'),
('0xE592427A0AEce92De3Edee1F18E0157C05861564', 'mainnet', 'Uniswap V3: SwapRouter', 'defi', 'low', true, 'manual', 'system'),
('0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', 'mainnet', 'Uniswap V3: SwapRouter02', 'defi', 'low', true, 'manual', 'system'),

-- Major exchanges (Mainnet)
('0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE', 'mainnet', 'Binance: Hot Wallet', 'exchange', 'low', true, 'manual', 'system'),
('0x28C6c06298d514Db089934071355E5743bf21d60', 'mainnet', 'Binance: Hot Wallet 2', 'exchange', 'low', true, 'manual', 'system'),
('0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549', 'mainnet', 'Binance: Hot Wallet 3', 'exchange', 'low', true, 'manual', 'system'),
('0x56Eddb7aa87536c09CCc2793473599fD21A8b17F', 'mainnet', 'Coinbase: Hot Wallet', 'exchange', 'low', true, 'manual', 'system'),
('0xA090e606E30bD747d4E6245a1517EbE430F0057e', 'mainnet', 'Coinbase: Hot Wallet 2', 'exchange', 'low', true, 'manual', 'system'),

-- Test addresses for Sepolia
('0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 'sepolia', 'Test Account 1', 'personal', 'low', true, 'manual', 'system'),
('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', 'sepolia', 'Test Account 2', 'personal', 'low', true, 'manual', 'system'),
('0x90F79bf6EB2c4f870365E785982E1f101E93b906', 'sepolia', 'Test Account 3', 'personal', 'low', true, 'manual', 'system');

-- ============================================================================
-- SAMPLE WALLET REGISTRATION
-- ============================================================================

-- Register the deployed MultiSig wallets from our previous deployment
INSERT INTO wallets (
    address, 
    name, 
    description, 
    network, 
    type,
    owners,
    required,
    daily_limit,
    balance,
    alert_thresholds,
    contact_list,
    notification_channels,
    registered_by
) VALUES 
-- MultiSigWallet
(
    '0x9f39A39631b2E49B59A614D37465431890612b5a',
    'Test MultiSig Wallet',
    'Basic MultiSig wallet for testing validator service',
    'sepolia',
    'MultiSigWallet',
    '["0xF9B9d028818496894267eBD3B3eA3c537d24f9B5", "0x855c9E5aC7431df8524F964ab3A0F4805469049f", "0x4eA8869eF1a9Bf454172BBAec3586AdcAFCE86d9"]',
    2,
    NULL,
    '0',
    '{
        "transferPercentage": 15,
        "rapidTransactionCount": 3,
        "rapidTransactionWindow": 3600,
        "dailyLimitIncreasePercent": 50,
        "unknownRecipientAlert": true,
        "ownerChangeAlert": true,
        "requirementChangeAlert": true
    }',
    '[
        {"email": "admin@example.com", "name": "Admin", "role": "administrator"},
        {"email": "security@example.com", "name": "Security Team", "role": "security"}
    ]',
    '["email", "slack"]',
    'system'
),
-- MultiSigWalletWithDailyLimit  
(
    '0xbdb8ed781577405f3FaEa59b33bA2fb05179ee61',
    'Test MultiSig Wallet with Daily Limit',
    'MultiSig wallet with daily limit for testing validator service',
    'sepolia',
    'MultiSigWalletWithDailyLimit',
    '["0xF9B9d028818496894267eBD3B3eA3c537d24f9B5", "0x855c9E5aC7431df8524F964ab3A0F4805469049f", "0x4eA8869eF1a9Bf454172BBAec3586AdcAFCE86d9"]',
    2,
    '1000000000000000000',
    '0',
    '{
        "transferPercentage": 10,
        "rapidTransactionCount": 5,
        "rapidTransactionWindow": 1800,
        "dailyLimitIncreasePercent": 25,
        "unknownRecipientAlert": true,
        "ownerChangeAlert": true,
        "requirementChangeAlert": true
    }',
    '[
        {"email": "treasury@example.com", "name": "Treasury Manager", "role": "treasurer"},
        {"email": "compliance@example.com", "name": "Compliance Officer", "role": "compliance"}
    ]',
    '["email", "slack"]',
    'system'
);

-- ============================================================================
-- SAMPLE OWNERS (from deployed wallets)
-- ============================================================================

INSERT INTO owners (
    address,
    network,
    wallets,
    transaction_count,
    name,
    organization,
    role,
    email,
    verified,
    approved_by,
    approved_at,
    risk_level,
    confidence_score,
    status
) VALUES
(
    '0xF9B9d028818496894267eBD3B3eA3c537d24f9B5',
    'sepolia',
    '["0x9f39A39631b2E49B59A614D37465431890612b5a", "0xbdb8ed781577405f3FaEa59b33bA2fb05179ee61"]',
    0,
    'Primary Admin',
    'Test Organization',
    'administrator',
    'admin@example.com',
    true,
    'system',
    NOW(),
    'low',
    95,
    'active'
),
(
    '0x855c9E5aC7431df8524F964ab3A0F4805469049f',
    'sepolia',
    '["0x9f39A39631b2E49B59A614D37465431890612b5a", "0xbdb8ed781577405f3FaEa59b33bA2fb05179ee61"]',
    0,
    'Treasury Manager',
    'Test Organization',
    'treasurer',
    'treasury@example.com',
    true,
    'system',
    NOW(),
    'low',
    90,
    'active'
),
(
    '0x4eA8869eF1a9Bf454172BBAec3586AdcAFCE86d9',
    'sepolia',
    '["0x9f39A39631b2E49B59A614D37465431890612b5a", "0xbdb8ed781577405f3FaEa59b33bA2fb05179ee61"]',
    0,
    'Security Officer',
    'Test Organization',
    'security',
    'security@example.com',
    true,
    'system',
    NOW(),
    'low',
    85,
    'active'
);

-- ============================================================================
-- SAMPLE CONFIGURATIONS FOR SPECIFIC WALLETS
-- ============================================================================

-- Custom thresholds for the daily limit wallet (more restrictive)
INSERT INTO configurations (wallet_id, scope, category, settings, created_by) VALUES
(
    (SELECT id FROM wallets WHERE address = '0xbdb8ed781577405f3FaEa59b33bA2fb05179ee61'),
    'wallet',
    'thresholds',
    '{
        "transferPercentage": 5,
        "rapidTransactionCount": 2,
        "rapidTransactionWindow": 1800,
        "dailyLimitIncreasePercent": 25,
        "highValueAmountWei": "500000000000000000"
    }',
    'system'
);

-- ============================================================================
-- AUDIT LOG ENTRY
-- ============================================================================

INSERT INTO audit_logs (
    action,
    entity_type,
    user_id,
    success,
    old_values,
    new_values
) VALUES (
    'seed_initial_data',
    'configuration',
    'system',
    true,
    '{}',
    '{
        "walletsCreated": 2,
        "ownersCreated": 3,
        "recipientsCreated": 18,
        "configurationsCreated": 4
    }'
);

COMMIT;

-- Add comments for documentation
COMMENT ON TABLE wallets IS 'Registered MultiSig wallets being monitored by the validator service';
COMMENT ON TABLE owners IS 'Owner database with automatic learning and manual verification';
COMMENT ON TABLE recipients IS 'Whitelist of known safe recipients with risk classification';
COMMENT ON TABLE transactions IS 'Transaction history with validation results and risk analysis';
COMMENT ON TABLE alerts IS 'Generated alerts with priority-based notification system';
COMMENT ON TABLE configurations IS 'Global and wallet-specific configuration settings';
COMMENT ON TABLE notifications IS 'Notification delivery tracking and analytics';
COMMENT ON TABLE audit_logs IS 'Comprehensive audit trail for all system actions';