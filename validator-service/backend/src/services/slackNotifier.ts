// Slack notification service for MultiSig wallet alerts
import axios from 'axios';
import winston from 'winston';
import { NetworkType, TransactionAction } from '@multisig-validator/shared';
import config from '../config';

export interface SlackAttachment {
  color: 'good' | 'warning' | 'danger' | '#ff0000' | '#ff9900' | '#36a64f';
  fields: Array<{
    title: string;
    value: string;
    short: boolean;
  }>;
  footer?: string;
  ts?: number;
}

export interface SlackMessage {
  text: string;
  channel?: string;
  username?: string;
  icon_emoji?: string;
  attachments?: SlackAttachment[];
}

export interface TransactionAlert {
  wallet: {
    address: string;
    name: string;
    network: NetworkType;
  };
  transaction: {
    id: number;
    action: TransactionAction;
    submitter: string;
    destination?: string;
    value: string;
    required: number;
    confirmations: number;
    hash?: string;
  };
  alertType: 'submission' | 'confirmation' | 'execution' | 'large_amount' | 'unknown_recipient';
  timestamp: Date;
  confirmer?: string; // For confirmation alerts
}

export interface OwnerAlert {
  wallet: {
    address: string;
    name: string;
    network: NetworkType;
  };
  change: {
    type: 'addition' | 'removal' | 'replacement';
    owner: string;
    newOwner?: string;
  };
  timestamp: Date;
  transactionHash?: string;
}

export class SlackNotifier {
  private logger: winston.Logger;
  private webhookUrl: string;
  private defaultChannel: string;
  private enabled: boolean;
  private lastNotificationTime: Map<string, number> = new Map();
  private readonly rateLimitMs = 60000; // 1 minute between similar notifications

  constructor(logger: winston.Logger) {
    this.logger = logger;
    this.webhookUrl = config.notifications.slack.webhookUrl || '';
    this.defaultChannel = config.notifications.slack.defaultChannel || '#multisig-alerts';
    this.enabled = config.notifications.slack.enabled || false;

    if (this.enabled && !this.webhookUrl) {
      this.logger.warn('Slack notifications enabled but no webhook URL configured');
      this.enabled = false;
    }
  }

  // ============================================================================
  // TRANSACTION ALERTS
  // ============================================================================

  async notifyTransactionSubmission(alert: TransactionAlert): Promise<void> {
    if (!this.enabled) return;

    const rateKey = `submission-${alert.wallet.address}-${alert.transaction.id}`;
    if (this.isRateLimited(rateKey)) return;

    const timeText = alert.timestamp.toLocaleString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    });

    const message: SlackMessage = {
      text: `📝 *New MultiSig Transaction Submitted*`,
      attachments: [{
        color: 'warning',
        fields: [
          { title: 'Wallet', value: `${alert.wallet.name}\n\`${alert.wallet.address}\``, short: false },
          { title: 'Network', value: alert.wallet.network, short: true },
          { title: 'Transaction ID', value: alert.transaction.id.toString(), short: true },
          { title: 'Action', value: this.formatAction(alert.transaction.action), short: true },
          { title: 'Amount', value: this.formatEther(alert.transaction.value), short: true },
          { title: 'Destination', value: alert.transaction.destination ? `\`${alert.transaction.destination}\`` : 'N/A', short: false },
          { title: 'Status', value: `${alert.transaction.confirmations}/${alert.transaction.required} confirmations`, short: true },
          { title: 'Time', value: timeText, short: true },
          { title: 'Submitted by', value: `\`${alert.transaction.submitter}\``, short: false },
          { title: 'Transaction Hash', value: alert.transaction.hash ? `\`${alert.transaction.hash}\`` : 'N/A', short: false }
        ],
        footer: 'MultiSig Validator',
        ts: Math.floor(alert.timestamp.getTime() / 1000)
      }]
    };

    await this.sendMessage(message);
  }

  async notifyTransactionConfirmation(alert: TransactionAlert): Promise<void> {
    if (!this.enabled) return;

    const confirmerText = alert.confirmer ? `\`${alert.confirmer}\`` : 'Unknown';
    const timeText = alert.timestamp.toLocaleString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    });

    const message: SlackMessage = {
      text: `✅ *Transaction Confirmation*`,
      attachments: [{
        color: 'good',
        fields: [
          { title: 'Wallet', value: `${alert.wallet.name}\n\`${alert.wallet.address}\``, short: false },
          { title: 'Network', value: alert.wallet.network, short: true },
          { title: 'Transaction ID', value: alert.transaction.id.toString(), short: true },
          { title: 'Action', value: this.formatAction(alert.transaction.action), short: true },
          { title: 'Amount', value: this.formatEther(alert.transaction.value), short: true },
          { title: 'Progress', value: `${alert.transaction.confirmations}/${alert.transaction.required} confirmations`, short: true },
          { title: 'Time', value: timeText, short: true },
          { title: 'Confirmed by', value: confirmerText, short: false },
          { title: 'Confirmation Hash', value: alert.transaction.hash ? `\`${alert.transaction.hash}\`` : 'N/A', short: false }
        ],
        footer: 'MultiSig Validator',
        ts: Math.floor(alert.timestamp.getTime() / 1000)
      }]
    };

    await this.sendMessage(message);
  }

  async notifyTransactionExecution(alert: TransactionAlert): Promise<void> {
    if (!this.enabled) return;

    const timeText = alert.timestamp.toLocaleString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    });

    const message: SlackMessage = {
      text: `🚀 *Transaction Executed*`,
      attachments: [{
        color: 'good',
        fields: [
          { title: 'Wallet', value: `${alert.wallet.name}\n\`${alert.wallet.address}\``, short: false },
          { title: 'Network', value: alert.wallet.network, short: true },
          { title: 'Transaction ID', value: alert.transaction.id.toString(), short: true },
          { title: 'Action', value: this.formatAction(alert.transaction.action), short: true },
          { title: 'Amount', value: this.formatEther(alert.transaction.value), short: true },
          { title: 'Destination', value: alert.transaction.destination ? `\`${alert.transaction.destination}\`` : 'N/A', short: false },
          { title: 'Time', value: timeText, short: true },
          { title: 'Execution Hash', value: alert.transaction.hash ? `\`${alert.transaction.hash}\`` : 'N/A', short: false }
        ],
        footer: 'MultiSig Validator',
        ts: Math.floor(alert.timestamp.getTime() / 1000)
      }]
    };

    await this.sendMessage(message);
  }

  async notifyLargeTransaction(alert: TransactionAlert): Promise<void> {
    if (!this.enabled) return;

    const timeText = alert.timestamp.toLocaleString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    });

    const message: SlackMessage = {
      text: `🚨 *Large Transaction Alert*`,
      attachments: [{
        color: 'danger',
        fields: [
          { title: 'Wallet', value: `${alert.wallet.name}\n\`${alert.wallet.address}\``, short: false },
          { title: 'Network', value: alert.wallet.network, short: true },
          { title: 'Amount', value: `💰 ${this.formatEther(alert.transaction.value)}`, short: true },
          { title: 'Transaction ID', value: alert.transaction.id.toString(), short: true },
          { title: 'Action', value: this.formatAction(alert.transaction.action), short: true },
          { title: 'Submitter', value: `\`${alert.transaction.submitter}\``, short: false },
          { title: 'Status', value: `${alert.transaction.confirmations}/${alert.transaction.required} confirmations`, short: true },
          { title: 'Time', value: timeText, short: true },
          { title: 'Transaction Hash', value: alert.transaction.hash ? `\`${alert.transaction.hash}\`` : 'N/A', short: false }
        ],
        footer: 'MultiSig Validator - Large Amount Alert',
        ts: Math.floor(alert.timestamp.getTime() / 1000)
      }]
    };

    await this.sendMessage(message);
  }

  async notifyUnknownRecipient(alert: TransactionAlert): Promise<void> {
    if (!this.enabled) return;

    const timeText = alert.timestamp.toLocaleString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    });

    const message: SlackMessage = {
      text: `⚠️ *Unknown Recipient Alert*`,
      attachments: [{
        color: 'warning',
        fields: [
          { title: 'Wallet', value: `${alert.wallet.name}\n\`${alert.wallet.address}\``, short: false },
          { title: 'Network', value: alert.wallet.network, short: true },
          { title: 'Network', value: alert.wallet.network, short: true },
          { title: 'Transaction ID', value: alert.transaction.id.toString(), short: true },
          { title: 'Amount', value: this.formatEther(alert.transaction.value), short: true },
          { title: 'Status', value: `${alert.transaction.confirmations}/${alert.transaction.required} confirmations`, short: true },
          { title: 'Time', value: timeText, short: true },
          { title: 'Submitter', value: `\`${alert.transaction.submitter}\``, short: false },
          { title: 'Unknown Recipient', value: `\`${alert.transaction.destination}\``, short: false },
          { title: 'Transaction Hash', value: alert.transaction.hash ? `\`${alert.transaction.hash}\`` : 'N/A', short: false }
        ],
        footer: 'MultiSig Validator - Security Alert',
        ts: Math.floor(alert.timestamp.getTime() / 1000)
      }]
    };

    await this.sendMessage(message);
  }

  // ============================================================================
  // OWNER CHANGE ALERTS
  // ============================================================================

  async notifyOwnerChange(alert: OwnerAlert): Promise<void> {
    if (!this.enabled) return;

    const emoji = alert.change.type === 'addition' ? '👤➕' : 
                 alert.change.type === 'removal' ? '👤➖' : '👤🔄';
    
    const action = alert.change.type === 'addition' ? 'Added' :
                  alert.change.type === 'removal' ? 'Removed' : 'Replaced';

    const timeText = alert.timestamp.toLocaleString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    });

    const message: SlackMessage = {
      text: `${emoji} *Wallet Owner ${action}*`,
      attachments: [{
        color: alert.change.type === 'removal' ? 'danger' : 'warning',
        fields: [
          { title: 'Wallet', value: `${alert.wallet.name}\n\`${alert.wallet.address}\``, short: false },
          { title: 'Network', value: alert.wallet.network, short: true },
          { title: 'Change Type', value: action, short: true },
          { title: 'Time', value: timeText, short: true },
          { title: 'Owner', value: `\`${alert.change.owner}\``, short: false },
          { title: 'Transaction Hash', value: alert.transactionHash ? `\`${alert.transactionHash}\`` : 'N/A', short: false }
        ],
        footer: 'MultiSig Validator - Governance Alert',
        ts: Math.floor(alert.timestamp.getTime() / 1000)
      }]
    };

    if (alert.change.newOwner) {
      message.attachments![0].fields.push({
        title: 'New Owner',
        value: `\`${alert.change.newOwner}\``,
        short: false
      });
    }

    await this.sendMessage(message);
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  private async sendMessage(message: SlackMessage): Promise<void> {
    try {
      // Remove channel from message as Slack webhooks are pre-configured with a channel
      const { channel, ...messageWithoutChannel } = message;

      const response = await axios.post(this.webhookUrl, messageWithoutChannel, {
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.status !== 200) {
        throw new Error(`Slack API returned status ${response.status}`);
      }

      this.logger.debug('Slack notification sent successfully', {
        channel: this.defaultChannel,
        text: message.text
      });

    } catch (error) {
      this.logger.error('Failed to send Slack notification:', {
        error: error instanceof Error ? error.message : String(error),
        message: message.text
      });
    }
  }

  private formatAction(action: TransactionAction): string {
    const actionMap: Record<TransactionAction, string> = {
      [TransactionAction.TRANSFER]: '💸 Transfer',
      [TransactionAction.ADD_OWNER]: '👤➕ Add Owner',
      [TransactionAction.REMOVE_OWNER]: '👤➖ Remove Owner',
      [TransactionAction.REPLACE_OWNER]: '👤🔄 Replace Owner',
      [TransactionAction.CHANGE_REQUIREMENT]: '🔢 Change Requirement',
      [TransactionAction.CHANGE_DAILY_LIMIT]: '📅 Change Daily Limit',
      [TransactionAction.CONTRACT_CALL]: '📋 Contract Call'
    };

    return actionMap[action] || action;
  }

  private formatEther(wei: string): string {
    try {
      const ethValue = parseFloat(wei) / 1e18;
      if (ethValue >= 1) {
        return `${ethValue.toFixed(4)} ETH`;
      } else if (ethValue >= 0.001) {
        return `${ethValue.toFixed(6)} ETH`;
      } else {
        return `${wei} wei`;
      }
    } catch {
      return `${wei} wei`;
    }
  }

  private isRateLimited(key: string): boolean {
    const now = Date.now();
    const lastTime = this.lastNotificationTime.get(key);
    
    if (lastTime && (now - lastTime) < this.rateLimitMs) {
      return true;
    }
    
    this.lastNotificationTime.set(key, now);
    return false;
  }

  // ============================================================================
  // HEALTH CHECK
  // ============================================================================

  async testConnection(): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      const testMessage: SlackMessage = {
        text: '🧪 MultiSig Validator - Connection Test',
        attachments: [{
          color: 'good',
          fields: [
            { title: 'Status', value: '✅ Connected', short: true },
            { title: 'Time', value: new Date().toISOString(), short: true }
          ],
          footer: 'MultiSig Validator Test'
        }]
      };

      await this.sendMessage(testMessage);
      return true;
    } catch (error) {
      this.logger.error('Slack connection test failed:', error);
      return false;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}