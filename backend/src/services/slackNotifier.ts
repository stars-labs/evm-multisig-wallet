// Slack notification service for MultiSig wallet alerts
import axios from 'axios';
import winston from 'winston';
import { NetworkType, TransactionAction } from '../types';
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
  thread_ts?: string; // Timestamp of parent message for threading
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
  executor?: string; // For execution alerts
  comment?: string; // Human-readable description of what the transaction does
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
  transactionId?: number;
}

export class SlackNotifier {
  private logger: winston.Logger;
  private webhookUrl: string;
  private botToken: string;
  private defaultChannel: string;
  private channelId: string | null = null; // Cached channel ID
  private enabled: boolean;
  private useWebApi: boolean; // Whether to use Web API (bot token) or webhooks
  private lastNotificationTime: Map<string, number> = new Map();
  private readonly rateLimitMs = 60000; // 1 minute between similar notifications
  
  // Track submission message timestamps for threading (wallet:transactionId -> timestamp)
  private submissionMessageTimestamps: Map<string, string> = new Map();

  constructor(logger: winston.Logger) {
    this.logger = logger;
    this.webhookUrl = config.notifications.slack.webhookUrl || '';
    this.botToken = config.notifications.slack.botToken || '';
    this.defaultChannel = config.notifications.slack.defaultChannel || '#multisig-alerts';
    this.enabled = config.notifications.slack.enabled || false;
    
    // Prefer Web API (bot token) over webhooks for better threading support
    this.useWebApi = !!this.botToken;

    if (this.enabled && !this.webhookUrl && !this.botToken) {
      this.logger.warn('Slack notifications enabled but no webhook URL or bot token configured');
      this.enabled = false;
    }

    if (this.useWebApi) {
      this.logger.info('Using Slack Web API for notifications (threading supported)', {
        channel: this.defaultChannel
      });
    } else {
      this.logger.info('Using Slack webhooks for notifications (limited threading support)', {
        channel: this.defaultChannel
      });
    }
    
    this.logger.debug('SlackNotifier initialized', {
      enabled: this.enabled,
      useWebApi: this.useWebApi,
      defaultChannel: this.defaultChannel,
      hasWebhook: !!this.webhookUrl,
      hasBotToken: !!this.botToken
    });
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

    const fields = [
      { title: 'Wallet', value: `${alert.wallet.name}\n\`${alert.wallet.address}\``, short: false },
      { title: 'Network', value: alert.wallet.network, short: true },
      { title: 'Transaction ID', value: alert.transaction.id.toString(), short: true },
      { title: 'Action', value: this.formatAction(alert.transaction.action, alert.transaction), short: true },
      { title: 'Amount', value: this.formatEther(alert.transaction.value), short: true },
      { title: 'Destination', value: alert.transaction.destination ? `\`${alert.transaction.destination}\`` : 'N/A', short: false },
      { title: 'Status', value: `${alert.transaction.confirmations}/${alert.transaction.required} confirmations`, short: true },
      { title: 'Time', value: timeText, short: true },
      { title: 'Submitted by', value: `\`${alert.transaction.submitter}\``, short: false },
      { title: 'Transaction Hash', value: alert.transaction.hash ? `\`${alert.transaction.hash}\`` : 'N/A', short: false }
    ];

    // Add comment field as the last field if available
    if (alert.comment) {
      fields.push({ title: 'Comment', value: alert.comment, short: false });
    }

    const message: SlackMessage = {
      text: `📝 *New MultiSig Transaction Submitted*`,
      attachments: [{
        color: 'warning',
        fields,
        footer: 'MultiSig Validator',
        ts: Math.floor(alert.timestamp.getTime() / 1000)
      }]
    };

    const messageTimestamp = await this.sendMessage(message);
    
    // Store the submission message timestamp for threading follow-up messages
    if (messageTimestamp) {
      const threadKey = `${alert.wallet.address}:${alert.transaction.id}`;
      this.submissionMessageTimestamps.set(threadKey, messageTimestamp);
      
      this.logger.debug('Stored submission message timestamp for threading', {
        threadKey,
        timestamp: messageTimestamp
      });
    }
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

    const fields = [
      { title: 'Wallet', value: `${alert.wallet.name}\n\`${alert.wallet.address}\``, short: false },
      { title: 'Network', value: alert.wallet.network, short: true },
      { title: 'Transaction ID', value: alert.transaction.id.toString(), short: true },
      { title: 'Action', value: this.formatAction(alert.transaction.action, alert.transaction), short: true },
      { title: 'Amount', value: this.formatEther(alert.transaction.value), short: true },
      { title: 'Progress', value: `${alert.transaction.confirmations}/${alert.transaction.required} confirmations`, short: true },
      { title: 'Time', value: timeText, short: true },
      { title: 'Confirmed by', value: confirmerText, short: false },
      { title: 'Confirmation Hash', value: alert.transaction.hash ? `\`${alert.transaction.hash}\`` : 'N/A', short: false }
    ];

    // Look up the submission message timestamp for threading
    const threadKey = `${alert.wallet.address}:${alert.transaction.id}`;
    const parentTimestamp = this.submissionMessageTimestamps.get(threadKey);

    const message: SlackMessage = {
      text: `✅ *Transaction Confirmation*`,
      thread_ts: parentTimestamp, // Reply in thread if we have the parent timestamp
      attachments: [{
        color: 'good',
        fields,
        footer: 'MultiSig Validator',
        ts: Math.floor(alert.timestamp.getTime() / 1000)
      }]
    };

    await this.sendMessage(message);
    
    if (parentTimestamp) {
      this.logger.debug('Sent confirmation as threaded reply', {
        threadKey,
        parentTimestamp
      });
    } else {
      this.logger.debug('Sent confirmation as standalone message (no parent found)', {
        threadKey
      });
    }
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

    const executorText = alert.executor ? `\`${alert.executor}\`` : 'Unknown';

    const fields = [
      { title: 'Wallet', value: `${alert.wallet.name}\n\`${alert.wallet.address}\``, short: false },
      { title: 'Network', value: alert.wallet.network, short: true },
      { title: 'Transaction ID', value: alert.transaction.id.toString(), short: true },
      { title: 'Action', value: this.formatAction(alert.transaction.action, alert.transaction), short: true },
      { title: 'Amount', value: this.formatEther(alert.transaction.value), short: true },
      { title: 'Destination', value: alert.transaction.destination ? `\`${alert.transaction.destination}\`` : 'N/A', short: false },
      { title: 'Time', value: timeText, short: true },
      { title: 'Executed by', value: executorText, short: false },
      { title: 'Execution Hash', value: alert.transaction.hash ? `\`${alert.transaction.hash}\`` : 'N/A', short: false }
    ];

    // Look up the submission message timestamp for threading
    const threadKey = `${alert.wallet.address}:${alert.transaction.id}`;
    const parentTimestamp = this.submissionMessageTimestamps.get(threadKey);

    const message: SlackMessage = {
      text: `🚀 *Transaction Executed*`,
      thread_ts: parentTimestamp, // Reply in thread if we have the parent timestamp
      attachments: [{
        color: 'good',
        fields,
        footer: 'MultiSig Validator',
        ts: Math.floor(alert.timestamp.getTime() / 1000)
      }]
    };

    await this.sendMessage(message);
    
    if (parentTimestamp) {
      this.logger.debug('Sent execution as threaded reply', {
        threadKey,
        parentTimestamp
      });
      
      // Clean up the stored timestamp since transaction is complete
      this.submissionMessageTimestamps.delete(threadKey);
    } else {
      this.logger.debug('Sent execution as standalone message (no parent found)', {
        threadKey
      });
    }
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

    // Look up the submission message timestamp for threading
    const threadKey = `${alert.wallet.address}:${alert.transaction.id}`;
    const parentTimestamp = this.submissionMessageTimestamps.get(threadKey);

    const message: SlackMessage = {
      text: `🚨 *Large Transaction Alert*`,
      thread_ts: parentTimestamp, // Reply in thread if we have the parent timestamp
      attachments: [{
        color: 'danger',
        fields: [
          { title: 'Wallet', value: `${alert.wallet.name}\n\`${alert.wallet.address}\``, short: false },
          { title: 'Network', value: alert.wallet.network, short: true },
          { title: 'Amount', value: `💰 ${this.formatEther(alert.transaction.value)}`, short: true },
          { title: 'Transaction ID', value: alert.transaction.id.toString(), short: true },
          { title: 'Action', value: this.formatAction(alert.transaction.action, alert.transaction), short: true },
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

    // Look up the submission message timestamp for threading
    const threadKey = `${alert.wallet.address}:${alert.transaction.id}`;
    const parentTimestamp = this.submissionMessageTimestamps.get(threadKey);

    const message: SlackMessage = {
      text: `⚠️ *Unknown Recipient Alert*`,
      thread_ts: parentTimestamp, // Reply in thread if we have the parent timestamp
      attachments: [{
        color: 'warning',
        fields: [
          { title: 'Wallet', value: `${alert.wallet.name}\n\`${alert.wallet.address}\``, short: false },
          { title: 'Network', value: alert.wallet.network, short: true },
          { title: 'Transaction ID', value: alert.transaction.id.toString(), short: true },
          { title: 'Action', value: this.formatAction(alert.transaction.action, alert.transaction), short: true },
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
          { title: 'Transaction ID', value: alert.transactionId ? alert.transactionId.toString() : 'N/A', short: true },
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

  private async sendMessage(message: SlackMessage): Promise<string | null> {
    try {
      this.logger.debug('Sending Slack message', {
        text: message.text,
        hasThreadTs: !!message.thread_ts,
        threadTs: message.thread_ts,
        useWebApi: this.useWebApi
      });

      if (this.useWebApi) {
        return await this.sendViaWebApi(message);
      } else {
        return await this.sendViaWebhook(message);
      }

    } catch (error) {
      this.logger.error('Failed to send Slack notification:', {
        error: error instanceof Error ? error.message : String(error),
        message: message.text,
        hasThreadTs: !!message.thread_ts,
        threadTs: message.thread_ts,
        useWebApi: this.useWebApi
      });
      return null;
    }
  }

  private async sendViaWebApi(message: SlackMessage): Promise<string | null> {
    // Get channel ID (cached or lookup)
    if (!this.channelId) {
      if (this.defaultChannel.startsWith('#')) {
        this.channelId = await this.getChannelId(this.defaultChannel);
      } else {
        this.channelId = this.defaultChannel;
      }
    }

    const payload = {
      channel: this.channelId,
      text: message.text,
      attachments: message.attachments,
      ...(message.thread_ts && { thread_ts: message.thread_ts })
    };

    const response = await axios.post('https://slack.com/api/chat.postMessage', payload, {
      timeout: 5000,
      headers: {
        'Authorization': `Bearer ${this.botToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status !== 200) {
      throw new Error(`Slack API returned status ${response.status}`);
    }

    const responseData = response.data;
    if (!responseData.ok) {
      // If channel not found, clear cache and throw error
      if (responseData.error === 'channel_not_found') {
        this.channelId = null;
      }
      throw new Error(`Slack API error: ${responseData.error}`);
    }

    this.logger.debug('Slack Web API notification sent successfully', {
      channel: this.defaultChannel,
      channelId: this.channelId,
      text: message.text,
      threaded: !!message.thread_ts,
      messageTs: responseData.ts
    });

    return responseData.ts; // Return actual message timestamp from Slack
  }

  private async getChannelId(channelName: string): Promise<string> {
    try {
      // Remove # from channel name
      const cleanChannelName = channelName.replace('#', '');
      
      // First try conversations.list to find the channel
      const response = await axios.get('https://slack.com/api/conversations.list', {
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
        },
        params: {
          types: 'public_channel,private_channel',
          limit: 1000
        }
      });

      if (response.data.ok && response.data.channels) {
        const channel = response.data.channels.find((ch: any) => ch.name === cleanChannelName);
        if (channel) {
          this.logger.debug('Found channel ID', { 
            channelName: cleanChannelName, 
            channelId: channel.id 
          });
          return channel.id;
        }
      }

      // If not found, return original (might be a DM or already an ID)
      this.logger.warn('Channel not found, using original name', { 
        channelName: cleanChannelName 
      });
      return channelName;

    } catch (error) {
      this.logger.error('Failed to get channel ID, using original', { 
        channelName, 
        error: error instanceof Error ? error.message : error 
      });
      return channelName;
    }
  }

  private async sendViaWebhook(message: SlackMessage): Promise<string | null> {
    // Remove channel and thread_ts from webhook messages as they have limitations
    const { channel, thread_ts, ...messageWithoutUnsupported } = message;

    // Log if threading is attempted via webhook
    if (thread_ts) {
      this.logger.warn('Thread timestamp ignored - webhooks have limited threading support', {
        thread_ts,
        text: message.text
      });
    }

    const response = await axios.post(this.webhookUrl, messageWithoutUnsupported, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.status !== 200) {
      throw new Error(`Slack webhook returned status ${response.status}`);
    }

    this.logger.debug('Slack webhook notification sent successfully', {
      text: message.text,
      threadingAttempted: !!thread_ts
    });

    // Generate approximate timestamp for webhooks
    const messageTimestamp = (Date.now() / 1000).toString();
    return messageTimestamp;
  }

  private extractOwnerAddressFromTransaction(transaction: any): string | null {
    try {
      // Method 1: If the address is already decoded in transaction context
      if (transaction.targetOwner) {
        return transaction.targetOwner;
      }
      
      // Method 2: Extract from transaction data (encoded function call)
      if (transaction.data && transaction.data.length >= 74) {
        // addOwner: 0x7065cb48 + padded address
        // removeOwner: 0x173825d9 + padded address
        const functionSelector = transaction.data.slice(0, 10); // 0x + 8 chars
        
        if (functionSelector === '0x7065cb48' || functionSelector === '0x173825d9') {
          // Extract address from the last 40 characters (20 bytes)
          const addressHex = transaction.data.slice(-40);
          return `0x${addressHex}`;
        }
      }
      
      // Method 3: If available in decoded data
      if (transaction.decodedData && transaction.decodedData.args && transaction.decodedData.args[0]) {
        return transaction.decodedData.args[0];
      }
      
    } catch (error) {
      this.logger.debug('Could not extract owner address from transaction:', error);
    }
    
    return null;
  }

  private formatAction(action: TransactionAction, transaction?: any): string {
    const baseActionMap: Record<TransactionAction, string> = {
      [TransactionAction.TRANSFER]: '💸 Transfer',
      [TransactionAction.ADD_OWNER]: ':bust_in_silhouette::heavy_plus_sign: Add Owner',
      [TransactionAction.REMOVE_OWNER]: ':bust_in_silhouette::heavy_minus_sign: Remove Owner',
      [TransactionAction.REPLACE_OWNER]: ':bust_in_silhouette::arrows_counterclockwise: Replace Owner',
      [TransactionAction.CHANGE_REQUIREMENT]: '🔢 Change Requirement',
      [TransactionAction.CHANGE_DAILY_LIMIT]: '📅 Change Daily Limit',
      [TransactionAction.CONTRACT_CALL]: '📋 Contract Call',
      [TransactionAction.SUBMISSION]: '📝 Submission',
      [TransactionAction.CONFIRMATION]: '✅ Confirmation',
      [TransactionAction.REVOCATION]: '🔙 Revocation',
      [TransactionAction.EXECUTION]: '⚡ Execution',
      [TransactionAction.EXECUTION_FAILURE]: '💥 Execution Failure',
      [TransactionAction.DEPOSIT]: '💰 Deposit'
    };

    let baseAction = baseActionMap[action] || action;

    // Extract specific address for owner operations
    if (transaction && (action === TransactionAction.ADD_OWNER || action === TransactionAction.REMOVE_OWNER)) {
      const ownerAddress = this.extractOwnerAddressFromTransaction(transaction);
      if (ownerAddress) {
        baseAction += ` (${ownerAddress})`;
      }
    }

    return baseAction;
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