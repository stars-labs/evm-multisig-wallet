"use strict";
// Shared TypeScript types for MultiSig Validator Service
// Used by both backend and frontend
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecipientCategory = exports.NotificationChannel = exports.OwnerStatus = exports.RiskLevel = exports.AlertStatus = exports.AlertPriority = exports.ValidationStatus = exports.TransactionAction = exports.WalletType = exports.NetworkType = void 0;
// ============================================================================
// ENUMS
// ============================================================================
var NetworkType;
(function (NetworkType) {
    NetworkType["MAINNET"] = "mainnet";
    NetworkType["SEPOLIA"] = "sepolia";
    NetworkType["GOERLI"] = "goerli";
    NetworkType["POLYGON"] = "polygon";
    NetworkType["ARBITRUM"] = "arbitrum";
})(NetworkType || (exports.NetworkType = NetworkType = {}));
var WalletType;
(function (WalletType) {
    WalletType["MULTISIG_WALLET"] = "MultiSigWallet";
    WalletType["MULTISIG_WALLET_WITH_DAILY_LIMIT"] = "MultiSigWalletWithDailyLimit";
    WalletType["GNOSIS_SAFE"] = "GnosisSafe";
})(WalletType || (exports.WalletType = WalletType = {}));
var TransactionAction;
(function (TransactionAction) {
    TransactionAction["TRANSFER"] = "transfer";
    TransactionAction["ADD_OWNER"] = "addOwner";
    TransactionAction["REMOVE_OWNER"] = "removeOwner";
    TransactionAction["REPLACE_OWNER"] = "replaceOwner";
    TransactionAction["CHANGE_REQUIREMENT"] = "changeRequirement";
    TransactionAction["CHANGE_DAILY_LIMIT"] = "changeDailyLimit";
    TransactionAction["CONTRACT_CALL"] = "contractCall";
})(TransactionAction || (exports.TransactionAction = TransactionAction = {}));
var ValidationStatus;
(function (ValidationStatus) {
    ValidationStatus["PENDING"] = "pending";
    ValidationStatus["APPROVED"] = "approved";
    ValidationStatus["FLAGGED"] = "flagged";
    ValidationStatus["REJECTED"] = "rejected";
})(ValidationStatus || (exports.ValidationStatus = ValidationStatus = {}));
var AlertPriority;
(function (AlertPriority) {
    AlertPriority["P1"] = "P1";
    AlertPriority["P2"] = "P2";
    AlertPriority["P3"] = "P3"; // Medium
})(AlertPriority || (exports.AlertPriority = AlertPriority = {}));
var AlertStatus;
(function (AlertStatus) {
    AlertStatus["ACTIVE"] = "active";
    AlertStatus["ACKNOWLEDGED"] = "acknowledged";
    AlertStatus["RESOLVED"] = "resolved";
    AlertStatus["FALSE_POSITIVE"] = "false_positive";
})(AlertStatus || (exports.AlertStatus = AlertStatus = {}));
var RiskLevel;
(function (RiskLevel) {
    RiskLevel["LOW"] = "low";
    RiskLevel["MEDIUM"] = "medium";
    RiskLevel["HIGH"] = "high";
    RiskLevel["CRITICAL"] = "critical";
})(RiskLevel || (exports.RiskLevel = RiskLevel = {}));
var OwnerStatus;
(function (OwnerStatus) {
    OwnerStatus["ACTIVE"] = "active";
    OwnerStatus["INACTIVE"] = "inactive";
    OwnerStatus["FLAGGED"] = "flagged";
    OwnerStatus["REMOVED"] = "removed";
})(OwnerStatus || (exports.OwnerStatus = OwnerStatus = {}));
var NotificationChannel;
(function (NotificationChannel) {
    NotificationChannel["EMAIL"] = "email";
    NotificationChannel["SLACK"] = "slack";
    NotificationChannel["DISCORD"] = "discord";
    NotificationChannel["WEBHOOK"] = "webhook";
    NotificationChannel["SMS"] = "sms";
})(NotificationChannel || (exports.NotificationChannel = NotificationChannel = {}));
var RecipientCategory;
(function (RecipientCategory) {
    RecipientCategory["EXCHANGE"] = "exchange";
    RecipientCategory["DEFI"] = "defi";
    RecipientCategory["TREASURY"] = "treasury";
    RecipientCategory["PERSONAL"] = "personal";
    RecipientCategory["CONTRACT"] = "contract";
    RecipientCategory["TOKEN"] = "token";
    RecipientCategory["BURN"] = "burn";
})(RecipientCategory || (exports.RecipientCategory = RecipientCategory = {}));
// All types are already exported above with their interface declarations
//# sourceMappingURL=types.js.map