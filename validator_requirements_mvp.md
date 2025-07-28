# MultiSig Wallet Validator Service - Requirements & MVP

## Core Objective
A comprehensive real-time validation service for MultiSig wallet actions with dashboard monitoring, intelligent alert system, and automated owner recognition for security and governance oversight.

## Primary Users
- **Wallet Owners**: Verify transactions before confirmation, receive validation insights
- **Monitors/Auditors**: Monitor activities, receive prioritized alerts, investigate anomalies
- **Security Teams**: Threat detection and incident response

## MVP Scope

### 1. Action Validation (Core Feature)
**Supported Actions:**
- **ETH Transfers**: Amount, recipient validation
- **addOwner**: New owner verification, ownership changes
- **removeOwner**: Owner removal validation
- **replaceOwner**: Owner replacement verification  
- **changeRequirement**: Threshold modification validation
- **changeDailyLimit**: Daily limit updates (for DailyLimit wallets)

**Validation Checks:**
- **Transaction legitimacy**: Expected vs actual parameters, function call validation
- **Owner verification**: Multi-layer recognition (contract + manual + learning)
- **Threshold safety**: Ensure requirements remain secure, prevent lockout scenarios
- **Amount reasonableness**: Percentage-based transfer detection (configurable % of wallet balance)
- **Recipient validation**: Known vs unknown addresses, blacklist checking
- **Gas analysis**: Unusual gas prices or limits
- **Timing patterns**: Rapid succession detection, unusual timing

### 2. Real-time Dashboard
**Multi-Wallet Overview:**
- **Wallet list** with status indicators (active, pending, issues)
- **Transaction timeline** across all monitored wallets
- **Pending transactions** requiring confirmations
- **Recent activities** with action types and timestamps
- **Owner activity** summary per wallet

**Wallet Detail View:**
- **Current owners** and confirmation requirements
- **Pending transactions** with validation status
- **Transaction history** with validation results
- **Alert history** for this wallet

### 3. Alert System with Priorities

#### Priority 1 (Critical - Immediate Notification)
- **Unrecognized owner addition/replacement** (not in learning database)
- **Large ETH transfers** (>X% of wallet balance, configurable per wallet)
- **Requirement changes** that weaken security (reduce confirmations)
- **Multiple rapid transactions** within short timeframe
- **Emergency governance changes** (mass owner replacement)

#### Priority 2 (High - 15min notification)
- **New transaction submissions** for significant amounts
- **Unknown recipient addresses** (first-time interactions)
- **Daily limit modifications** (increases >50%)
- **Owner removals** (especially if reduces active owner count)
- **Contract interaction** with unverified contracts

#### Priority 3 (Medium - 1hr notification)
- **Transaction confirmations** reaching threshold
- **Successful executions** of routine transactions
- **Routine ownership updates** (recognized owners)
- **System health** and monitoring status

**Alert Channels (MVP):**
- **Email** for all priorities with detailed context
- **Slack webhook** for P1/P2 with quick action buttons
- **Dashboard notifications** with real-time updates
- **Future**: SMS for P1, Discord, custom webhooks

### 4. Owner Recognition System (Hybrid Approach)

**Automatic Learning:**
```javascript
// Contract-derived owners
{
  address: "0x123...",
  source: "contract",
  firstSeen: "2024-01-01",
  wallets: ["0xabc...", "0xdef..."],
  confidence: "high"
}
```

**Manual Enhancement:**
```javascript
// Enhanced owner info
{
  address: "0x123...",
  name: "Alice Treasury Manager",
  organization: "DeFi Protocol",
  role: "treasurer",
  verified: true,
  contactInfo: "alice@protocol.com",
  approvedBy: "admin",
  riskLevel: "low"
}
```

**Recognition Flow:**
1. **Auto-discover** owners from contract `getOwners()`
2. **Learn patterns** from historical transactions
3. **Manual verification** and enhancement by admins
4. **Risk scoring** based on behavior and verification status

### 5. Wallet Registration System (Manual MVP)

**Registration Process:**
```javascript
// Manual wallet registration
{
  address: "0x9f39A39631b2E49B59A614D37465431890612b5a",
  name: "Treasury MultiSig",
  description: "Main treasury operations",
  network: "sepolia",
  type: "MultiSigWallet", // or "MultiSigWalletWithDailyLimit"
  alertThresholds: {
    transferPercentage: 10, // Alert if >10% of balance
    rapidTransactionCount: 3, // Alert if >3 transactions in 1 hour
    dailyLimitIncreasePercent: 50
  },
  contactList: ["admin@org.com", "security@org.com"],
  slackWebhook: "https://hooks.slack.com/...",
  registeredBy: "admin_user",
  registeredAt: "2024-01-01T00:00:00Z"
}
```

**Registration Features:**
- **Manual form** in dashboard for wallet addition
- **Automatic owner discovery** after registration
- **Custom alert thresholds** per wallet
- **Bulk import** capability for multiple wallets
- **Wallet verification** (check if contract exists and is multisig)

### 6. Architecture (Monolithic, Real-time)

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Blockchain    │───▶│   Validator      │───▶│    Dashboard    │
│   Event Listener│    │   Service        │    │    & Alerts     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────┐
                       │   Database   │
                       │  (PostgreSQL)│
                       └──────────────┘
```

**Components:**
- **Event Listener**: Web3 event monitoring
- **Validator Engine**: Transaction analysis and validation
- **Alert Manager**: Priority-based notification system
- **Dashboard API**: RESTful API for frontend
- **Database**: Transaction history and configuration

### 5. Core Data Models

#### Wallet Configuration
```javascript
{
  id: "uuid",
  address: "0x9f39A39631b2E49B59A614D37465431890612b5a",
  name: "Treasury MultiSig",
  description: "Main treasury operations",
  network: "sepolia",
  type: "MultiSigWallet",
  
  // Contract state
  owners: ["0x...", "0x...", "0x..."],
  required: 2,
  dailyLimit: "1000000000000000000",
  balance: "5000000000000000000",
  
  // Monitoring config
  monitored: true,
  alertThresholds: {
    transferPercentage: 10,
    rapidTransactionCount: 3,
    rapidTransactionWindow: 3600, // 1 hour
    dailyLimitIncreasePercent: 50
  },
  
  // Communication
  contactList: ["admin@org.com"],
  slackWebhook: "https://hooks.slack.com/...",
  
  // Metadata
  registeredBy: "admin",
  registeredAt: "2024-01-01T00:00:00Z",
  lastActivity: "2024-01-15T10:30:00Z"
}
```

#### Owner Recognition
```javascript
{
  address: "0xF9B9d028818496894267eBD3B3eA3c537d24f9B5",
  
  // Automatic data
  contractSource: {
    firstSeen: "2024-01-01T00:00:00Z",
    wallets: ["0x9f39...", "0xbdb8..."],
    transactionCount: 15,
    lastActivity: "2024-01-15T10:30:00Z"
  },
  
  // Manual enhancement
  manual: {
    name: "Alice Treasury Manager",
    organization: "DeFi Protocol",
    role: "treasurer",
    email: "alice@protocol.com",
    verified: true,
    approvedBy: "security_admin",
    approvedAt: "2024-01-02T00:00:00Z"
  },
  
  // Computed fields
  riskLevel: "low", // low, medium, high
  confidence: "high", // confidence in owner legitimacy
  status: "active" // active, inactive, flagged
}
```

#### Transaction Validation
```javascript
{
  id: "uuid",
  walletAddress: "0x9f39...",
  transactionId: 0,
  blockNumber: 123456,
  transactionHash: "0xabc...",
  
  // Transaction details
  action: "transfer|addOwner|removeOwner|replaceOwner|changeRequirement",
  submitter: "0x123...",
  destination: "0x456...",
  value: "100000000000000000",
  data: "0x...",
  decodedData: {
    functionName: "addOwner",
    parameters: { owner: "0x789..." }
  },
  
  // Validation results
  validationStatus: "pending|approved|flagged|rejected",
  riskScore: 7, // 1-10 scale
  riskFactors: ["unknown_recipient", "large_amount"],
  
  // Context
  walletBalance: "5000000000000000000",
  transferPercentage: 2.0, // 2% of wallet balance
  confirmations: [
    { owner: "0x123...", confirmedAt: "2024-01-15T10:30:00Z" }
  ],
  
  // Alerts generated
  alerts: [
    {
      priority: "P2",
      type: "unknown_recipient",
      message: "Transfer to unknown address 0x456...",
      createdAt: "2024-01-15T10:30:00Z",
      notified: ["email", "slack"],
      acknowledged: false
    }
  ],
  
  // Timeline
  submittedAt: "2024-01-15T10:30:00Z",
  executedAt: null,
  status: "pending" // pending, executed, failed
}
```

## MVP Feature Set

### Phase 1 - Core Infrastructure (Weeks 1-2)
- [ ] Database schema design and implementation
- [ ] Web3 event listener for multisig events (Submission, Confirmation, Execution)
- [ ] Basic transaction parsing and action detection
- [ ] Manual wallet registration system
- [ ] Owner auto-discovery from contracts
- [ ] Simple email alert system
- [ ] Basic REST API structure

### Phase 2 - Validation Engine (Weeks 3-4)
- [ ] Transaction validation logic (percentage-based thresholds)
- [ ] Owner recognition system (automatic learning)
- [ ] Risk scoring algorithm
- [ ] Alert priority classification
- [ ] Slack webhook integration
- [ ] Real-time event processing pipeline

### Phase 3 - Dashboard & UI (Weeks 5-6)
- [ ] React dashboard with wallet overview
- [ ] Multi-wallet monitoring interface
- [ ] Transaction timeline and validation results
- [ ] Owner management and verification interface
- [ ] Real-time updates via WebSocket
- [ ] Alert management and acknowledgment
- [ ] Wallet registration form

### Phase 4 - Enhancement & Deployment (Weeks 7-8)
- [ ] Advanced validation rules and customization
- [ ] Performance optimization and caching
- [ ] Comprehensive logging and monitoring
- [ ] Security hardening
- [ ] Production deployment and testing
- [ ] Documentation and user guides
- [ ] Load testing with multiple wallets

## Technical Stack

**Backend:**
- **Node.js/Express** (monolithic API with modular architecture)
- **Ethers.js v6** for blockchain interaction (latest version)
- **PostgreSQL 15+** with TimescaleDB extension for time-series data
- **Socket.io** for real-time dashboard updates
- **Bull Queue** with Redis for background job processing
- **Winston** for structured logging
- **Joi** for input validation

**Frontend:**
- **React 18** with hooks and context
- **Material-UI (MUI) v5** for consistent design system
- **Chart.js/Recharts** for transaction visualizations
- **Socket.io-client** for real-time updates
- **React Query** for API state management
- **React Router v6** for navigation

**Infrastructure:**
- **Docker containers** for consistent deployment
- **Single VPS initially** (4GB RAM, 2 CPU cores, 100GB SSD)
- **PM2** for process management and clustering
- **Nginx** reverse proxy with rate limiting
- **Let's Encrypt** SSL with auto-renewal
- **Backup strategy** for PostgreSQL with point-in-time recovery

## Deployment Strategy

**Environment:**
- **Sepolia testnet** for development
- **Single VPS** (4GB RAM, 2 CPU cores)
- **Docker containers** for easy deployment

**Monitoring:**
- **Basic health checks**
- **Error logging** to file/console
- **Simple uptime monitoring**

## Success Criteria & Metrics

### Performance Targets
- **Monitor 50+ wallets** simultaneously without performance degradation
- **<3 second** alert delivery for P1 events (critical)
- **<30 second** alert delivery for P2 events
- **99.5% uptime** with automatic failover
- **<2 second** dashboard response time for wallet overview

### Accuracy Targets
- **Zero false negatives** for critical threats (P1 alerts)
- **<5% false positive** rate for P1 alerts
- **<15% false positive** rate for P2 alerts
- **95% accuracy** in owner recognition and validation

### User Experience
- **100% transaction coverage** for supported multisig types
- **Real-time updates** within 5 seconds of blockchain events
- **Mobile-responsive** dashboard for monitoring on-the-go
- **24/7 monitoring** with no missed events

## Extended Features (Post-MVP)

### Phase 5 - Advanced Security (Weeks 9-12)
- **Threat Intelligence Integration**: Known malicious address databases
- **ML-based Anomaly Detection**: Pattern recognition for unusual behavior
- **Smart Contract Analysis**: Deep inspection of contract interactions
- **Gas Price Analysis**: Detection of MEV attacks and front-running
- **Time-based Analysis**: Unusual timing pattern detection

### Phase 6 - Compliance & Reporting (Weeks 13-16)
- **Audit Trail Generation**: Comprehensive transaction and validation logs
- **Compliance Templates**: Pre-built reports for regulatory requirements
- **Custom Report Builder**: Flexible reporting for different stakeholders
- **Data Export**: CSV, JSON, PDF export capabilities
- **Historical Analysis**: Trend analysis and behavioral insights

### Phase 7 - Integration & Scaling (Weeks 17-20)
- **Multi-chain Support**: Ethereum mainnet, Polygon, Arbitrum, etc.
- **API for Third-parties**: RESTful API for external integrations
- **Mobile App**: Native iOS/Android app for alerts and monitoring
- **Advanced Notifications**: SMS, phone calls, custom webhooks
- **Load Balancing**: Support for hundreds of wallets

### Future Considerations
- **DeFi Protocol Integration**: Compound, Aave, Uniswap interaction analysis
- **NFT Transaction Support**: ERC-721 and ERC-1155 validation
- **Cross-chain Bridge Monitoring**: Multi-chain transaction tracking
- **AI-powered Risk Assessment**: Advanced machine learning models
- **Regulatory Compliance Automation**: Automatic compliance checking

## Technical Implementation Details

### Database Schema Priority
```sql
-- Core tables for MVP
CREATE TABLE wallets (...);           -- Registered wallets
CREATE TABLE owners (...);            -- Owner recognition data  
CREATE TABLE transactions (...);      -- Transaction validation results
CREATE TABLE alerts (...);            -- Generated alerts
CREATE TABLE validations (...);       -- Validation history
CREATE TABLE configurations (...);    -- Alert rules and thresholds
```

### API Endpoints Priority
```javascript
// MVP API endpoints
POST /api/wallets              // Register new wallet
GET  /api/wallets              // List all monitored wallets
GET  /api/wallets/:id          // Get wallet details
GET  /api/transactions         // Transaction history with validation
GET  /api/alerts               // Alert history and status
POST /api/alerts/:id/ack       // Acknowledge alert
GET  /api/owners               // Owner recognition database
POST /api/owners/:addr/verify  // Manual owner verification
```

### Configuration Management
```javascript
// Per-wallet alert thresholds
{
  transferPercentage: 10,        // Alert if >10% of balance
  rapidTransactionCount: 3,      // >3 transactions trigger alert
  rapidTransactionWindow: 3600,  // Within 1 hour
  dailyLimitIncreasePercent: 50, // >50% daily limit increase
  unknownRecipientAlert: true,   // Alert for new recipients
  ownerChangeAlert: true,        // Alert for ownership changes
  requirementChangeAlert: true   // Alert for threshold changes
}
```

## Development Roadmap

### Week 1-2: Foundation
- [ ] Project setup (Node.js, PostgreSQL, React)
- [ ] Database schema implementation
- [ ] Web3 event listener prototype
- [ ] Basic email notification system

### Week 3-4: Core Logic  
- [ ] Transaction parsing and validation
- [ ] Owner recognition system
- [ ] Alert priority classification
- [ ] Slack integration

### Week 5-6: Dashboard
- [ ] React dashboard with wallet list
- [ ] Real-time transaction timeline
- [ ] Alert management interface
- [ ] Owner verification interface

### Week 7-8: Production Ready
- [ ] Performance optimization
- [ ] Security hardening
- [ ] Comprehensive testing
- [ ] Production deployment

## Risk Mitigation

### Technical Risks
- **RPC Rate Limits**: Use multiple providers, implement caching
- **Event Processing Delays**: Queue system with retry logic
- **Database Performance**: Proper indexing and query optimization
- **Alert Fatigue**: Smart filtering and priority tuning

### Security Considerations
- **API Authentication**: JWT tokens with role-based access
- **Data Encryption**: Sensitive data encrypted at rest
- **Webhook Security**: Signature verification for Slack/external webhooks
- **Input Validation**: Sanitize all user inputs and blockchain data

---

## Ready to Begin Implementation

The requirements are now comprehensive with clear MVP priorities. Next immediate steps:

1. **Technical Architecture Decision**: Confirm tech stack preferences
2. **Development Environment**: Set up local development infrastructure  
3. **Database Design**: Finalize schema and create initial migration
4. **Web3 Integration**: Choose RPC provider and implement event listener
5. **Alert Integration**: Set up email and Slack webhook testing

Which component would you like to start with first?