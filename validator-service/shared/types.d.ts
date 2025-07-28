export declare enum NetworkType {
    MAINNET = "mainnet",
    SEPOLIA = "sepolia",
    GOERLI = "goerli",
    POLYGON = "polygon",
    ARBITRUM = "arbitrum"
}
export declare enum WalletType {
    MULTISIG_WALLET = "MultiSigWallet",
    MULTISIG_WALLET_WITH_DAILY_LIMIT = "MultiSigWalletWithDailyLimit",
    GNOSIS_SAFE = "GnosisSafe"
}
export declare enum TransactionAction {
    TRANSFER = "transfer",
    ADD_OWNER = "addOwner",
    REMOVE_OWNER = "removeOwner",
    REPLACE_OWNER = "replaceOwner",
    CHANGE_REQUIREMENT = "changeRequirement",
    CHANGE_DAILY_LIMIT = "changeDailyLimit",
    CONTRACT_CALL = "contractCall"
}
export declare enum ValidationStatus {
    PENDING = "pending",
    APPROVED = "approved",
    FLAGGED = "flagged",
    REJECTED = "rejected"
}
export declare enum AlertPriority {
    P1 = "P1",// Critical
    P2 = "P2",// High
    P3 = "P3"
}
export declare enum AlertStatus {
    ACTIVE = "active",
    ACKNOWLEDGED = "acknowledged",
    RESOLVED = "resolved",
    FALSE_POSITIVE = "false_positive"
}
export declare enum RiskLevel {
    LOW = "low",
    MEDIUM = "medium",
    HIGH = "high",
    CRITICAL = "critical"
}
export declare enum OwnerStatus {
    ACTIVE = "active",
    INACTIVE = "inactive",
    FLAGGED = "flagged",
    REMOVED = "removed"
}
export declare enum NotificationChannel {
    EMAIL = "email",
    SLACK = "slack",
    DISCORD = "discord",
    WEBHOOK = "webhook",
    SMS = "sms"
}
export declare enum RecipientCategory {
    EXCHANGE = "exchange",
    DEFI = "defi",
    TREASURY = "treasury",
    PERSONAL = "personal",
    CONTRACT = "contract",
    TOKEN = "token",
    BURN = "burn"
}
export interface BaseEntity {
    id: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface TimestampedEntity {
    createdAt: Date;
    updatedAt?: Date;
}
export interface AlertThresholds {
    transferPercentage: number;
    rapidTransactionCount: number;
    rapidTransactionWindow: number;
    dailyLimitIncreasePercent: number;
    unknownRecipientAlert: boolean;
    ownerChangeAlert: boolean;
    requirementChangeAlert: boolean;
}
export interface WalletContact {
    email: string;
    name?: string;
    role?: string;
}
export interface Wallet extends BaseEntity {
    address: string;
    name: string;
    description?: string;
    network: NetworkType;
    type: WalletType;
    owners: string[];
    required: number;
    dailyLimit?: string;
    balance: string;
    monitored: boolean;
    alertThresholds: AlertThresholds;
    contactList: WalletContact[];
    slackWebhook?: string;
    notificationChannels: NotificationChannel[];
    registeredBy: string;
    registeredAt: Date;
    lastActivity?: Date;
    lastSync?: Date;
}
export interface WalletCreateRequest {
    address: string;
    name: string;
    description?: string;
    network: NetworkType;
    alertThresholds?: Partial<AlertThresholds>;
    contactList?: WalletContact[];
    slackWebhook?: string;
    notificationChannels?: NotificationChannel[];
}
export interface WalletSummary extends Wallet {
    latestActivity: Date;
    transactionCount: number;
    activeAlerts: number;
    criticalAlerts: number;
}
export interface OwnerContractData {
    firstSeen: Date;
    wallets: string[];
    transactionCount: number;
    lastActivity?: Date;
}
export interface OwnerManualData {
    name?: string;
    organization?: string;
    role?: string;
    email?: string;
    phone?: string;
    verified: boolean;
    approvedBy?: string;
    approvedAt?: Date;
    notes?: string;
}
export interface Owner extends BaseEntity {
    address: string;
    network: NetworkType;
    contractData: OwnerContractData;
    manualData: OwnerManualData;
    riskLevel: RiskLevel;
    confidenceScore: number;
    status: OwnerStatus;
}
export interface OwnerCreateRequest {
    address: string;
    network: NetworkType;
    name?: string;
    organization?: string;
    role?: string;
    email?: string;
    phone?: string;
    notes?: string;
}
export interface OwnerVerificationRequest {
    verified: boolean;
    notes?: string;
}
export interface Recipient extends BaseEntity {
    address: string;
    network: NetworkType;
    name?: string;
    category: RecipientCategory;
    description?: string;
    riskLevel: RiskLevel;
    verified: boolean;
    source: string;
    addedBy: string;
    verifiedBy?: string;
}
export interface RecipientCreateRequest {
    address: string;
    network: NetworkType;
    name?: string;
    category: RecipientCategory;
    description?: string;
    riskLevel?: RiskLevel;
    source?: string;
}
export interface TransactionConfirmation {
    owner: string;
    confirmedAt: Date;
}
export interface DecodedTransactionData {
    functionName: string;
    parameters: Record<string, any>;
}
export interface Transaction extends BaseEntity {
    walletId: string;
    transactionId: number;
    blockNumber?: number;
    transactionHash?: string;
    action: TransactionAction;
    submitter: string;
    destination?: string;
    value: string;
    data?: string;
    decodedData?: DecodedTransactionData;
    walletBalance: string;
    transferPercentage?: number;
    gasPrice?: string;
    gasLimit?: number;
    validationStatus: ValidationStatus;
    riskScore: number;
    riskFactors: string[];
    confirmations: TransactionConfirmation[];
    requiredConfirmations: number;
    executedAt?: Date;
    executionStatus: 'pending' | 'executed' | 'failed';
    submittedAt: Date;
    validatedAt?: Date;
}
export interface TransactionWithContext extends Transaction {
    walletName: string;
    walletAddress: string;
    submitterName?: string;
    submitterOrganization?: string;
    recipientName?: string;
    recipientRiskLevel?: RiskLevel;
    isUnknownRecipient: boolean;
}
export interface AlertContext {
    [key: string]: any;
}
export interface Alert extends BaseEntity {
    walletId: string;
    transactionId?: string;
    priority: AlertPriority;
    type: string;
    title: string;
    message: string;
    riskLevel: RiskLevel;
    severityScore: number;
    context: AlertContext;
    notificationChannels: NotificationChannel[];
    notifiedAt?: Date;
    status: AlertStatus;
    acknowledgedBy?: string;
    acknowledgedAt?: Date;
    resolvedBy?: string;
    resolvedAt?: Date;
    resolutionNotes?: string;
}
export interface AlertCreateRequest {
    walletId: string;
    transactionId?: string;
    priority: AlertPriority;
    type: string;
    title: string;
    message: string;
    riskLevel: RiskLevel;
    severityScore?: number;
    context?: AlertContext;
}
export interface AlertWithContext extends Alert {
    walletName: string;
    walletAddress: string;
    transactionAction?: TransactionAction;
    transactionDestination?: string;
    transactionValue?: string;
}
export interface AlertAcknowledgmentRequest {
    notes?: string;
}
export interface AlertResolutionRequest {
    status: AlertStatus.RESOLVED | AlertStatus.FALSE_POSITIVE;
    notes?: string;
}
export interface RiskScoreThresholds {
    low: number;
    medium: number;
    high: number;
}
export interface GlobalThresholds {
    defaultTransferPercentage: number;
    defaultRapidTransactionCount: number;
    defaultRapidTransactionWindow: number;
    defaultDailyLimitIncreasePercent: number;
    riskScoreThresholds: RiskScoreThresholds;
}
export interface NotificationChannelConfig {
    enabled: boolean;
    rateLimit: number;
}
export interface GlobalNotificationConfig {
    retryAttempts: number;
    retryDelay: number;
    maxNotificationsPerHour: number;
    channels: Record<NotificationChannel, NotificationChannelConfig>;
}
export interface ConfidenceThresholds {
    autoApprove: number;
    requireReview: number;
}
export interface GlobalValidationConfig {
    enableOwnerLearning: boolean;
    autoApproveKnownRecipients: boolean;
    requireManualApprovalForHighRisk: boolean;
    confidenceThresholds: ConfidenceThresholds;
}
export interface Configuration extends BaseEntity {
    walletId?: string;
    scope: 'global' | 'wallet' | 'network';
    category: 'thresholds' | 'notifications' | 'validation';
    settings: Record<string, any>;
    createdBy: string;
    updatedBy?: string;
}
export interface Notification extends BaseEntity {
    alertId: string;
    channel: NotificationChannel;
    recipient: string;
    subject?: string;
    content: string;
    sentAt: Date;
    deliveredAt?: Date;
    deliveryStatus: 'pending' | 'sent' | 'delivered' | 'failed';
    errorMessage?: string;
    openedAt?: Date;
    clickedAt?: Date;
    responseData?: Record<string, any>;
}
export interface PaginationParams {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}
export interface FilterParams {
    network?: NetworkType;
    status?: string;
    riskLevel?: RiskLevel;
    dateFrom?: string;
    dateTo?: string;
}
export interface PaginatedResponse<T> {
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}
export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}
export interface DashboardStats {
    totalWallets: number;
    activeWallets: number;
    totalTransactions: number;
    pendingTransactions: number;
    activeAlerts: number;
    criticalAlerts: number;
    totalOwners: number;
    verifiedOwners: number;
}
export interface AlertSummary {
    priority: AlertPriority;
    count: number;
    latestAt?: Date;
}
export interface WalletActivity {
    walletId: string;
    walletName: string;
    walletAddress: string;
    transactionCount: number;
    lastActivity: Date;
    riskScore: number;
}
export interface SlackWebhookPayload {
    text: string;
    attachments?: Array<{
        color: 'good' | 'warning' | 'danger';
        title: string;
        text: string;
        fields?: Array<{
            title: string;
            value: string;
            short: boolean;
        }>;
        actions?: Array<{
            type: string;
            text: string;
            url: string;
            style?: 'primary' | 'danger';
        }>;
    }>;
}
export interface MultiSigEvent {
    event: string;
    address: string;
    blockNumber: number;
    transactionHash: string;
    args: Record<string, any>;
}
export interface SubmissionEvent extends MultiSigEvent {
    event: 'Submission';
    args: {
        transactionId: number;
    };
}
export interface ConfirmationEvent extends MultiSigEvent {
    event: 'Confirmation';
    args: {
        sender: string;
        transactionId: number;
    };
}
export interface ExecutionEvent extends MultiSigEvent {
    event: 'Execution';
    args: {
        transactionId: number;
    };
}
export interface OwnerAdditionEvent extends MultiSigEvent {
    event: 'OwnerAddition';
    args: {
        owner: string;
    };
}
export interface OwnerRemovalEvent extends MultiSigEvent {
    event: 'OwnerRemoval';
    args: {
        owner: string;
    };
}
export interface ValidationResult {
    status: ValidationStatus;
    riskScore: number;
    riskFactors: string[];
    recommendations: string[];
    autoApprove: boolean;
    requiresManualReview: boolean;
}
export interface OwnerValidationResult {
    isRecognized: boolean;
    confidenceScore: number;
    source: 'contract' | 'manual' | 'learned';
    riskLevel: RiskLevel;
}
export interface RecipientValidationResult {
    isWhitelisted: boolean;
    riskLevel: RiskLevel;
    category?: RecipientCategory;
    isFirstTimeInteraction: boolean;
}
