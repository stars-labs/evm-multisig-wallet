// Comprehensive test suite for SlackNotifier
import { SlackNotifier, TransactionAlert, OwnerAlert } from '../../services/slackNotifier';
import { NetworkType, TransactionAction } from '../../types';
import winston from 'winston';
import axios from 'axios';
import config from '../../config';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock config
jest.mock('../../config', () => ({
  default: {
    notifications: {
      slack: {
        webhookUrl: 'https://hooks.slack.com/test-webhook',
        defaultChannel: '#test-channel',
        enabled: true
      }
    }
  }
}));

describe('SlackNotifier', () => {
  let slackNotifier: SlackNotifier;
  let mockLogger: winston.Logger;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    } as any;

    // Reset axios mock
    mockedAxios.post.mockReset();
    mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' });

    slackNotifier = new SlackNotifier(mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with config values', () => {
      expect(slackNotifier.isEnabled()).toBe(true);
      expect(slackNotifier).toBeDefined();
    });

    it('should disable if webhook URL is missing', () => {
      const originalConfig = config.notifications.slack.webhookUrl;
      config.notifications.slack.webhookUrl = '';
      
      const notifierWithoutWebhook = new SlackNotifier(mockLogger);
      
      expect(notifierWithoutWebhook.isEnabled()).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Slack notifications enabled but no webhook URL configured'
      );
      
      // Restore original config
      config.notifications.slack.webhookUrl = originalConfig;
    });

    it('should disable if explicitly disabled in config', () => {
      const originalEnabled = config.notifications.slack.enabled;
      config.notifications.slack.enabled = false;
      
      const disabledNotifier = new SlackNotifier(mockLogger);
      
      expect(disabledNotifier.isEnabled()).toBe(false);
      
      // Restore original config
      config.notifications.slack.enabled = originalEnabled;
    });
  });

  describe('notifyTransactionSubmission', () => {
    const mockAlert: TransactionAlert = {
      wallet: {
        address: '0x1234567890123456789012345678901234567890',
        name: 'Test Wallet',
        network: NetworkType.LOCALHOST
      },
      transaction: {
        id: 123,
        action: TransactionAction.TRANSFER,
        submitter: '0xsubmitter123',
        destination: '0xdestination456',
        value: '1500000000000000000', // 1.5 ETH
        required: 2,
        confirmations: 0
      },
      alertType: 'submission',
      timestamp: new Date('2024-01-01T12:00:00Z')
    };

    it('should send transaction submission notification', async () => {
      await slackNotifier.notifyTransactionSubmission(mockAlert);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://hooks.slack.com/test-webhook',
        expect.objectContaining({
          text: '📝 *New MultiSig Transaction Submitted*',
          attachments: expect.arrayContaining([
            expect.objectContaining({
              color: 'warning',
              fields: expect.arrayContaining([
                expect.objectContaining({
                  title: 'Wallet',
                  value: expect.stringContaining('Test Wallet')
                }),
                expect.objectContaining({
                  title: 'Amount',
                  value: '1.5000 ETH'
                })
              ])
            })
          ])
        }),
        expect.any(Object)
      );
    });

    it('should not send if disabled', async () => {
      const originalEnabled = config.notifications.slack.enabled;
      config.notifications.slack.enabled = false;
      
      const disabledNotifier = new SlackNotifier(mockLogger);
      await disabledNotifier.notifyTransactionSubmission(mockAlert);
      
      expect(mockedAxios.post).not.toHaveBeenCalled();
      
      config.notifications.slack.enabled = originalEnabled;
    });

    it('should include destination field when present', async () => {
      await slackNotifier.notifyTransactionSubmission(mockAlert);

      const callArgs = mockedAxios.post.mock.calls[0][1];
      const destinationField = callArgs.attachments[0].fields.find(
        (f: any) => f.title === 'Destination'
      );
      
      expect(destinationField).toBeDefined();
      expect(destinationField.value).toContain('0xdestination456');
    });

    it('should apply rate limiting', async () => {
      // Send first notification
      await slackNotifier.notifyTransactionSubmission(mockAlert);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);

      // Try to send same notification immediately
      await slackNotifier.notifyTransactionSubmission(mockAlert);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1); // Should still be 1

      // Wait for rate limit to expire and send again
      jest.advanceTimersByTime(61000); // 61 seconds
      await slackNotifier.notifyTransactionSubmission(mockAlert);
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('notifyTransactionConfirmation', () => {
    const mockAlert: TransactionAlert = {
      wallet: {
        address: '0xwallet',
        name: 'Test Wallet',
        network: NetworkType.SEPOLIA
      },
      transaction: {
        id: 456,
        action: TransactionAction.TRANSFER,
        submitter: '0xsubmitter',
        destination: '0xdestination',
        value: '2000000000000000000', // 2 ETH
        required: 3,
        confirmations: 3
      },
      alertType: 'confirmation',
      timestamp: new Date()
    };

    it('should notify when fully confirmed', async () => {
      await slackNotifier.notifyTransactionConfirmation(mockAlert);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          text: '✅ *Transaction Confirmation*',
          attachments: expect.arrayContaining([
            expect.objectContaining({
              color: 'good',
              fields: expect.arrayContaining([
                expect.objectContaining({
                  title: 'Progress',
                  value: '3/3 confirmations'
                })
              ])
            })
          ])
        }),
        expect.any(Object)
      );
    });

    it('should notify for large amounts even if not fully confirmed', async () => {
      const largeAmountAlert = {
        ...mockAlert,
        transaction: {
          ...mockAlert.transaction,
          confirmations: 1,
          value: '2000000000000000000' // 2 ETH (> 1 ETH threshold)
        }
      };

      await slackNotifier.notifyTransactionConfirmation(largeAmountAlert);

      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it('should not notify for small amounts unless fully confirmed', async () => {
      const smallAmountAlert = {
        ...mockAlert,
        transaction: {
          ...mockAlert.transaction,
          confirmations: 1,
          required: 3,
          value: '500000000000000000' // 0.5 ETH
        }
      };

      await slackNotifier.notifyTransactionConfirmation(smallAmountAlert);

      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  describe('notifyTransactionExecution', () => {
    const mockAlert: TransactionAlert = {
      wallet: {
        address: '0xwallet',
        name: 'Production Wallet',
        network: NetworkType.MAINNET
      },
      transaction: {
        id: 789,
        action: TransactionAction.CONTRACT_CALL,
        submitter: '0xsubmitter',
        destination: '0xcontract',
        value: '0',
        required: 2,
        confirmations: 2
      },
      alertType: 'execution',
      timestamp: new Date()
    };

    it('should send execution notification', async () => {
      await slackNotifier.notifyTransactionExecution(mockAlert);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          text: '🚀 *Transaction Executed*',
          attachments: expect.arrayContaining([
            expect.objectContaining({
              color: 'good',
              fields: expect.arrayContaining([
                expect.objectContaining({
                  title: 'Status',
                  value: '✅ Executed'
                })
              ])
            })
          ])
        }),
        expect.any(Object)
      );
    });
  });

  describe('notifyLargeTransaction', () => {
    const mockAlert: TransactionAlert = {
      wallet: {
        address: '0xwallet',
        name: 'High Value Wallet',
        network: NetworkType.MAINNET
      },
      transaction: {
        id: 999,
        action: TransactionAction.TRANSFER,
        submitter: '0xsubmitter',
        destination: '0xdestination',
        value: '50000000000000000000', // 50 ETH
        required: 3,
        confirmations: 1
      },
      alertType: 'large_amount',
      timestamp: new Date()
    };

    it('should send large transaction alert with danger color', async () => {
      await slackNotifier.notifyLargeTransaction(mockAlert);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          text: '🚨 *Large Transaction Alert*',
          attachments: expect.arrayContaining([
            expect.objectContaining({
              color: 'danger',
              fields: expect.arrayContaining([
                expect.objectContaining({
                  title: 'Amount',
                  value: expect.stringContaining('50.0000 ETH')
                })
              ])
            })
          ])
        }),
        expect.any(Object)
      );
    });
  });

  describe('notifyUnknownRecipient', () => {
    const mockAlert: TransactionAlert = {
      wallet: {
        address: '0xwallet',
        name: 'Secure Wallet',
        network: NetworkType.MAINNET
      },
      transaction: {
        id: 111,
        action: TransactionAction.TRANSFER,
        submitter: '0xsubmitter',
        destination: '0xunknown',
        value: '1000000000000000000',
        required: 2,
        confirmations: 0
      },
      alertType: 'unknown_recipient',
      timestamp: new Date()
    };

    it('should send unknown recipient alert', async () => {
      await slackNotifier.notifyUnknownRecipient(mockAlert);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          text: '⚠️ *Unknown Recipient Alert*',
          attachments: expect.arrayContaining([
            expect.objectContaining({
              color: 'warning',
              fields: expect.arrayContaining([
                expect.objectContaining({
                  title: 'Unknown Recipient',
                  value: '`0xunknown`'
                })
              ])
            })
          ])
        }),
        expect.any(Object)
      );
    });
  });

  describe('notifyOwnerChange', () => {
    it('should notify owner addition', async () => {
      const mockAlert: OwnerAlert = {
        wallet: {
          address: '0xwallet',
          name: 'Managed Wallet',
          network: NetworkType.MAINNET
        },
        change: {
          type: 'addition',
          owner: '0xnewowner'
        },
        timestamp: new Date()
      };

      await slackNotifier.notifyOwnerChange(mockAlert);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          text: '👤➕ *Wallet Owner Added*',
          attachments: expect.arrayContaining([
            expect.objectContaining({
              color: 'warning',
              fields: expect.arrayContaining([
                expect.objectContaining({
                  title: 'Change Type',
                  value: 'Added'
                })
              ])
            })
          ])
        }),
        expect.any(Object)
      );
    });

    it('should notify owner removal with danger color', async () => {
      const mockAlert: OwnerAlert = {
        wallet: {
          address: '0xwallet',
          name: 'Managed Wallet',
          network: NetworkType.MAINNET
        },
        change: {
          type: 'removal',
          owner: '0xremovedowner'
        },
        timestamp: new Date()
      };

      await slackNotifier.notifyOwnerChange(mockAlert);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          text: '👤➖ *Wallet Owner Removed*',
          attachments: expect.arrayContaining([
            expect.objectContaining({
              color: 'danger'
            })
          ])
        }),
        expect.any(Object)
      );
    });

    it('should notify owner replacement', async () => {
      const mockAlert: OwnerAlert = {
        wallet: {
          address: '0xwallet',
          name: 'Managed Wallet',
          network: NetworkType.MAINNET
        },
        change: {
          type: 'replacement',
          owner: '0xoldowner',
          newOwner: '0xnewowner'
        },
        timestamp: new Date()
      };

      await slackNotifier.notifyOwnerChange(mockAlert);

      const callArgs = mockedAxios.post.mock.calls[0][1];
      const newOwnerField = callArgs.attachments[0].fields.find(
        (f: any) => f.title === 'New Owner'
      );
      
      expect(newOwnerField).toBeDefined();
      expect(newOwnerField.value).toContain('0xnewowner');
    });
  });

  describe('testConnection', () => {
    it('should send test message and return true on success', async () => {
      const result = await slackNotifier.testConnection();

      expect(result).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          text: '🧪 MultiSig Validator - Connection Test'
        }),
        expect.any(Object)
      );
    });

    it('should return false on failure', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

      const result = await slackNotifier.testConnection();

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Slack connection test failed:',
        expect.any(Error)
      );
    });

    it('should return false if disabled', async () => {
      const originalEnabled = config.notifications.slack.enabled;
      config.notifications.slack.enabled = false;
      
      const disabledNotifier = new SlackNotifier(mockLogger);
      const result = await disabledNotifier.testConnection();
      
      expect(result).toBe(false);
      expect(mockedAxios.post).not.toHaveBeenCalled();
      
      config.notifications.slack.enabled = originalEnabled;
    });
  });

  describe('formatAction', () => {
    it('should format all transaction actions correctly', async () => {
      const testCases = [
        { action: TransactionAction.TRANSFER, expected: '💸 Transfer' },
        { action: TransactionAction.ADD_OWNER, expected: '👤➕ Add Owner' },
        { action: TransactionAction.REMOVE_OWNER, expected: '👤➖ Remove Owner' },
        { action: TransactionAction.REPLACE_OWNER, expected: '👤🔄 Replace Owner' },
        { action: TransactionAction.CHANGE_REQUIREMENT, expected: '🔢 Change Requirement' },
        { action: TransactionAction.CHANGE_DAILY_LIMIT, expected: '📅 Change Daily Limit' },
        { action: TransactionAction.CONTRACT_CALL, expected: '📋 Contract Call' }
      ];

      for (const { action, expected } of testCases) {
        const alert: TransactionAlert = {
          wallet: { address: '0x', name: 'Test', network: NetworkType.LOCALHOST },
          transaction: {
            id: 1,
            action,
            submitter: '0x',
            value: '0',
            required: 1,
            confirmations: 0
          },
          alertType: 'submission',
          timestamp: new Date()
        };

        await slackNotifier.notifyTransactionSubmission(alert);

        const callArgs = mockedAxios.post.mock.calls[mockedAxios.post.mock.calls.length - 1][1];
        const actionField = callArgs.attachments[0].fields.find((f: any) => f.title === 'Action');
        expect(actionField.value).toBe(expected);
      }
    });
  });

  describe('formatEther', () => {
    it('should format wei values correctly', async () => {
      const testCases = [
        { wei: '1000000000000000000', expected: '1.0000 ETH' },
        { wei: '1500000000000000000', expected: '1.5000 ETH' },
        { wei: '100000000000000000', expected: '0.100000 ETH' },
        { wei: '1000000000000000', expected: '0.001000 ETH' },
        { wei: '100000000000000', expected: '100000000000000 wei' },
        { wei: '0', expected: '0 wei' },
        { wei: 'invalid', expected: 'invalid wei' }
      ];

      for (const { wei, expected } of testCases) {
        const alert: TransactionAlert = {
          wallet: { address: '0x', name: 'Test', network: NetworkType.LOCALHOST },
          transaction: {
            id: 1,
            action: TransactionAction.TRANSFER,
            submitter: '0x',
            value: wei,
            required: 1,
            confirmations: 0
          },
          alertType: 'submission',
          timestamp: new Date()
        };

        await slackNotifier.notifyTransactionSubmission(alert);

        const callArgs = mockedAxios.post.mock.calls[mockedAxios.post.mock.calls.length - 1][1];
        const amountField = callArgs.attachments[0].fields.find((f: any) => f.title === 'Amount');
        expect(amountField.value).toBe(expected);
      }
    });
  });

  describe('error handling', () => {
    it('should handle axios errors gracefully', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Network timeout'));

      const alert: TransactionAlert = {
        wallet: { address: '0x', name: 'Test', network: NetworkType.LOCALHOST },
        transaction: {
          id: 1,
          action: TransactionAction.TRANSFER,
          submitter: '0x',
          value: '0',
          required: 1,
          confirmations: 0
        },
        alertType: 'submission',
        timestamp: new Date()
      };

      // Should not throw
      await expect(slackNotifier.notifyTransactionSubmission(alert)).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to send Slack notification:',
        expect.objectContaining({
          error: 'Network timeout'
        })
      );
    });

    it('should handle non-200 status codes', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 404, data: 'Not found' });

      const alert: TransactionAlert = {
        wallet: { address: '0x', name: 'Test', network: NetworkType.LOCALHOST },
        transaction: {
          id: 1,
          action: TransactionAction.TRANSFER,
          submitter: '0x',
          value: '0',
          required: 1,
          confirmations: 0
        },
        alertType: 'submission',
        timestamp: new Date()
      };

      await slackNotifier.notifyTransactionSubmission(alert);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to send Slack notification:',
        expect.objectContaining({
          error: 'Slack API returned status 404'
        })
      );
    });

    it('should apply 5 second timeout', async () => {
      await slackNotifier.testConnection();

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          timeout: 5000
        })
      );
    });
  });

  describe('channel handling', () => {
    it('should not include channel in request body', async () => {
      const alert: TransactionAlert = {
        wallet: { address: '0x', name: 'Test', network: NetworkType.LOCALHOST },
        transaction: {
          id: 1,
          action: TransactionAction.TRANSFER,
          submitter: '0x',
          value: '0',
          required: 1,
          confirmations: 0
        },
        alertType: 'submission',
        timestamp: new Date()
      };

      await slackNotifier.notifyTransactionSubmission(alert);

      const callArgs = mockedAxios.post.mock.calls[0][1];
      expect(callArgs.channel).toBeUndefined();
    });
  });
});