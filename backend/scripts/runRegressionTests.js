#!/usr/bin/env node

/**
 * Regression Test Runner for MultiSig Wallet
 * 
 * This script orchestrates the full regression test suite:
 * 1. Starts Hardhat node (if needed)
 * 2. Deploys contracts
 * 3. Cleans up database from previous runs
 * 4. Registers wallets with validator service
 * 5. Verifies validator service is running
 * 6. Runs all regression tests
 * 7. Generates test report
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const VALIDATOR_SERVICE_URL = 'http://localhost:3001';
const HARDHAT_RPC_URL = 'http://127.0.0.1:8545';
const PROJECT_ROOT = path.join(__dirname, '../..');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logStep(step, message) {
  log(`\n[${step}] ${message}`, colors.cyan);
}

async function checkService(url, serviceName) {
  try {
    const response = await axios.get(url, { timeout: 5000 });
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

async function waitForService(url, serviceName, maxAttempts = 30) {
  logStep('CHECK', `Waiting for ${serviceName} to be ready...`);
  
  for (let i = 0; i < maxAttempts; i++) {
    if (await checkService(url, serviceName)) {
      log(`✅ ${serviceName} is ready!`, colors.green);
      return true;
    }
    process.stdout.write('.');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  log(`\n❌ ${serviceName} failed to start after ${maxAttempts} seconds`, colors.red);
  return false;
}

async function cleanupDatabase() {
  logStep('3/7', 'Cleaning up database...');
  
  try {
    // Change to validator service backend directory
    const originalDir = process.cwd();
    process.chdir(path.join(__dirname, '..'));
    
    // Run cleanup script
    execSync('npx ts-node src/scripts/cleanupTestData.ts', { 
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });
    
    // Change back to original directory
    process.chdir(originalDir);
    
    log('✅ Database cleaned successfully', colors.green);
    return true;
  } catch (error) {
    log('⚠️  Database cleanup failed (non-critical)', colors.yellow);
    console.error(error.message);
    return false;
  }
}

async function registerWallets() {
  logStep('4/7', 'Registering wallets with validator service...');
  
  try {
    // Read deployment info
    const deploymentPath = path.join(PROJECT_ROOT, 'deployment-local.json');
    const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    
    // Prepare wallet registrations
    const wallets = [
      {
        address: deploymentInfo.contracts.MultiSigWallet,
        network: 'localhost',
        type: 'MultiSigWallet',
        name: 'Test MultiSig Wallet',
        monitored: true
      },
      {
        address: deploymentInfo.contracts.MultiSigWalletWithDailyLimit,
        network: 'localhost',
        type: 'MultiSigWalletWithDailyLimit',
        name: 'Test MultiSig With Daily Limit',
        monitored: true
      }
    ];
    
    // Register each wallet
    for (const wallet of wallets) {
      try {
        // First, try to check if wallet exists
        const checkResponse = await axios.get(`${VALIDATOR_SERVICE_URL}/api/wallets`, {
          params: { network: 'localhost' }
        });
        
        const existingWallet = checkResponse.data.find(w => 
          w.address.toLowerCase() === wallet.address.toLowerCase()
        );
        
        if (existingWallet) {
          log(`   Wallet ${wallet.name} already registered`, colors.yellow);
          
          // Update monitoring status if needed
          if (!existingWallet.monitored) {
            await axios.put(`${VALIDATOR_SERVICE_URL}/api/wallets/${existingWallet.id}`, {
              monitored: true
            });
            log(`   Enabled monitoring for ${wallet.name}`, colors.green);
          }
        } else {
          // Register new wallet
          const response = await axios.post(`${VALIDATOR_SERVICE_URL}/api/wallets`, wallet);
          
          if (response.status === 201) {
            log(`   ✅ Registered ${wallet.name}`, colors.green);
          }
        }
      } catch (error) {
        if (error.response && error.response.status === 409) {
          log(`   Wallet ${wallet.name} already exists (OK)`, colors.yellow);
        } else {
          throw error;
        }
      }
    }
    
    log('✅ All wallets registered successfully', colors.green);
    return true;
  } catch (error) {
    log(`❌ Failed to register wallets: ${error.message}`, colors.red);
    return false;
  }
}

async function runRegressionTestSuite() {
  log('\n🧪 MULTISIG WALLET REGRESSION TEST SUITE', colors.bright);
  log('=' .repeat(50));
  
  let hardhatProcess = null;
  let testsPassed = false;
  
  try {
    // Step 1: Check if Hardhat node is already running
    logStep('1/7', 'Checking Hardhat node...');
    const hardhatRunning = await checkService(HARDHAT_RPC_URL, 'Hardhat node');
    
    if (!hardhatRunning) {
      log('Starting Hardhat node...', colors.yellow);
      
      // Change to project root to run hardhat
      const originalDir = process.cwd();
      process.chdir(PROJECT_ROOT);
      
      hardhatProcess = spawn('npx', ['hardhat', 'node'], {
        detached: false,
        stdio: 'pipe'
      });
      
      // Change back to original directory
      process.chdir(originalDir);
      
      // Wait for Hardhat to be ready
      if (!await waitForService(HARDHAT_RPC_URL, 'Hardhat node')) {
        throw new Error('Failed to start Hardhat node');
      }
    } else {
      log('✅ Hardhat node already running', colors.green);
    }
    
    // Step 2: Deploy contracts
    logStep('2/7', 'Deploying contracts...');
    try {
      // Change to project root to run deployment
      const originalDir = process.cwd();
      process.chdir(PROJECT_ROOT);
      
      execSync('node scripts/deployLocal.js', { stdio: 'inherit' });
      
      // Change back to original directory
      process.chdir(originalDir);
      
      log('✅ Contracts deployed successfully', colors.green);
    } catch (error) {
      throw new Error('Failed to deploy contracts');
    }
    
    // Step 3: Clean database
    await cleanupDatabase();
    
    // Step 4: Register wallets
    if (!await registerWallets()) {
      throw new Error('Failed to register wallets with validator service');
    }
    
    // Step 5: Check validator service
    logStep('5/7', 'Checking validator service...');
    const validatorRunning = await checkService(`${VALIDATOR_SERVICE_URL}/health`, 'Validator service');
    
    if (!validatorRunning) {
      log('\n⚠️  Validator service is not running!', colors.yellow);
      log('Please start it manually in another terminal:', colors.yellow);
      log('  cd validator-service/backend && npm run dev\n', colors.bright);
      
      // Wait for user to start validator service
      if (!await waitForService(`${VALIDATOR_SERVICE_URL}/health`, 'Validator service', 60)) {
        throw new Error('Validator service is required for regression tests');
      }
    } else {
      log('✅ Validator service is running', colors.green);
    }
    
    // Step 6: Run regression tests
    logStep('6/7', 'Running regression tests...');
    log('This will test all multisig wallet scenarios...\n', colors.yellow);
    
    await new Promise((resolve, reject) => {
      // Change to project root to run tests with hardhat
      const originalDir = process.cwd();
      process.chdir(PROJECT_ROOT);
      
      const testProcess = spawn('node', ['validator-service/backend/test/regression/multisig-regression-tests.js'], {
        stdio: 'inherit',
        env: { ...process.env, FORCE_COLOR: '1' }
      });
      
      testProcess.on('close', (code) => {
        // Change back to original directory
        process.chdir(originalDir);
        
        if (code === 0) {
          testsPassed = true;
          resolve();
        } else {
          reject(new Error(`Tests failed with exit code ${code}`));
        }
      });
      
      testProcess.on('error', (error) => {
        process.chdir(originalDir);
        reject(error);
      });
    });
    
    // Step 7: Generate summary report
    logStep('7/7', 'Generating test report...');
    
    // Find the latest test results file
    const testDir = path.join(__dirname, '../test/regression');
    const resultFiles = fs.readdirSync(testDir)
      .filter(f => f.startsWith('regression-results-'))
      .sort()
      .reverse();
    
    if (resultFiles.length > 0) {
      const latestResults = JSON.parse(
        fs.readFileSync(path.join(testDir, resultFiles[0]), 'utf8')
      );
      
      log('\n📊 TEST SUMMARY', colors.bright);
      log('=' .repeat(50));
      log(`Total Tests: ${latestResults.passed + latestResults.failed}`);
      log(`✅ Passed: ${latestResults.passed}`, colors.green);
      log(`❌ Failed: ${latestResults.failed}`, colors.red);
      log(`Success Rate: ${((latestResults.passed / (latestResults.passed + latestResults.failed)) * 100).toFixed(2)}%`);
      
      // Generate HTML report
      const htmlReport = generateHTMLReport(latestResults);
      const reportPath = path.join(testDir, 'regression-report.html');
      fs.writeFileSync(reportPath, htmlReport);
      log(`\n📄 HTML report generated: ${reportPath}`, colors.cyan);
    }
    
    if (testsPassed) {
      log('\n🎉 All regression tests passed!', colors.green);
      log('The multisig wallet and validator service are working correctly.', colors.green);
    }
    
  } catch (error) {
    log(`\n💥 Error: ${error.message}`, colors.red);
    process.exit(1);
  } finally {
    // Cleanup: Kill Hardhat node if we started it
    if (hardhatProcess) {
      log('\nStopping Hardhat node...', colors.yellow);
      hardhatProcess.kill();
    }
  }
}

function generateHTMLReport(results) {
  const timestamp = new Date(results.tests[0]?.timestamp || Date.now()).toLocaleString();
  
  return `
<!DOCTYPE html>
<html>
<head>
    <title>MultiSig Wallet Regression Test Report</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .header {
            background-color: #2c3e50;
            color: white;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .summary {
            display: flex;
            gap: 20px;
            margin-bottom: 30px;
        }
        .summary-card {
            flex: 1;
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
        }
        .summary-card h3 {
            margin: 0 0 10px 0;
            color: #2c3e50;
        }
        .summary-card .number {
            font-size: 36px;
            font-weight: bold;
        }
        .passed { color: #27ae60; }
        .failed { color: #e74c3c; }
        .total { color: #3498db; }
        .test-results {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background-color: #f8f9fa;
            font-weight: bold;
            color: #2c3e50;
        }
        .status-passed {
            color: #27ae60;
            font-weight: bold;
        }
        .status-failed {
            color: #e74c3c;
            font-weight: bold;
        }
        .details {
            font-size: 0.9em;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🧪 MultiSig Wallet Regression Test Report</h1>
        <p>Generated: ${timestamp}</p>
    </div>
    
    <div class="summary">
        <div class="summary-card">
            <h3>Total Tests</h3>
            <div class="number total">${results.passed + results.failed}</div>
        </div>
        <div class="summary-card">
            <h3>Passed</h3>
            <div class="number passed">${results.passed}</div>
        </div>
        <div class="summary-card">
            <h3>Failed</h3>
            <div class="number failed">${results.failed}</div>
        </div>
        <div class="summary-card">
            <h3>Success Rate</h3>
            <div class="number ${results.failed === 0 ? 'passed' : 'failed'}">
                ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%
            </div>
        </div>
    </div>
    
    <div class="test-results">
        <h2>Test Results</h2>
        <table>
            <thead>
                <tr>
                    <th>Test Name</th>
                    <th>Status</th>
                    <th>Details</th>
                    <th>Timestamp</th>
                </tr>
            </thead>
            <tbody>
                ${results.tests.map(test => `
                    <tr>
                        <td>${test.name}</td>
                        <td class="status-${test.status.toLowerCase()}">${test.status}</td>
                        <td class="details">
                            ${test.error || JSON.stringify(
                                Object.entries(test)
                                    .filter(([k]) => !['name', 'status', 'timestamp', 'error'].includes(k))
                                    .reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {})
                            )}
                        </td>
                        <td>${new Date(test.timestamp).toLocaleTimeString()}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
</body>
</html>
  `;
}

// Run the test suite
runRegressionTestSuite().catch(error => {
  log(`\n💥 Fatal error: ${error.message}`, colors.red);
  process.exit(1);
});