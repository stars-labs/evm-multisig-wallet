#!/usr/bin/env ts-node
// Comprehensive test runner script
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

interface TestResults {
  passed: boolean;
  coverage: {
    lines: number;
    functions: number;
    branches: number;
    statements: number;
  };
  testResults: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  duration: number;
}

class TestRunner {
  private rootDir: string;
  private coverageDir: string;

  constructor() {
    this.rootDir = path.join(__dirname, '..', '..');
    this.coverageDir = path.join(this.rootDir, 'coverage');
  }

  async runAllTests(): Promise<TestResults> {
    console.log('🧪 Starting comprehensive test suite...\n');
    
    const startTime = Date.now();
    
    try {
      // Clean previous coverage
      await this.cleanCoverage();
      
      // Run tests with coverage
      const testResults = await this.runJestTests();
      
      // Generate coverage report
      const coverage = await this.getCoverageReport();
      
      const duration = Date.now() - startTime;
      
      const results: TestResults = {
        passed: testResults.exitCode === 0,
        coverage,
        testResults: testResults.summary,
        duration
      };
      
      await this.printSummary(results);
      
      return results;
      
    } catch (error) {
      console.error('❌ Test suite failed:', error);
      throw error;
    }
  }

  private async cleanCoverage(): Promise<void> {
    if (fs.existsSync(this.coverageDir)) {
      fs.rmSync(this.coverageDir, { recursive: true, force: true });
    }
  }

  private async runJestTests(): Promise<{
    exitCode: number;
    summary: {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
    };
  }> {
    return new Promise((resolve, reject) => {
      console.log('📋 Running Jest test suite...');
      
      const jest = spawn('npm', ['test', '--', '--coverage', '--verbose'], {
        cwd: this.rootDir,
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CI: 'true' // Enable CI mode for better output
        }
      });

      let stdout = '';
      let stderr = '';

      jest.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        // Print real-time output
        process.stdout.write(output);
      });

      jest.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        // Print errors in red
        process.stderr.write(`\x1b[31m${output}\x1b[0m`);
      });

      jest.on('close', (code) => {
        const summary = this.parseTestSummary(stdout);
        
        resolve({
          exitCode: code || 0,
          summary
        });
      });

      jest.on('error', (error) => {
        reject(error);
      });
    });
  }

  private parseTestSummary(output: string): {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  } {
    // Parse Jest output for test summary
    const testSuiteRegex = /Test Suites:.*?(\d+) passed.*?(\d+) total/;
    const testRegex = /Tests:.*?(\d+) passed.*?(\d+) total/;
    
    const suiteMatch = output.match(testSuiteRegex);
    const testMatch = output.match(testRegex);
    
    // Extract numbers from Jest output
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    
    if (testMatch) {
      // Try to parse full test summary
      const summaryLines = output.split('\n').filter(line => 
        line.includes('passed') || 
        line.includes('failed') || 
        line.includes('skipped')
      );
      
      for (const line of summaryLines) {
        const numbers = line.match(/\d+/g);
        if (numbers && line.includes('Tests:')) {
          passed = parseInt(numbers[0]) || 0;
          total = parseInt(numbers[numbers.length - 1]) || 0;
          break;
        }
      }
    }
    
    failed = total - passed - skipped;
    
    return { total, passed, failed, skipped };
  }

  private async getCoverageReport(): Promise<{
    lines: number;
    functions: number;
    branches: number;
    statements: number;
  }> {
    const coverageSummaryPath = path.join(this.coverageDir, 'coverage-summary.json');
    
    if (!fs.existsSync(coverageSummaryPath)) {
      console.warn('⚠️  Coverage summary not found, returning default values');
      return { lines: 0, functions: 0, branches: 0, statements: 0 };
    }
    
    try {
      const coverageData = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8'));
      const total = coverageData.total;
      
      return {
        lines: total.lines.pct,
        functions: total.functions.pct,
        branches: total.branches.pct,
        statements: total.statements.pct
      };
    } catch (error) {
      console.warn('⚠️  Failed to parse coverage report:', error);
      return { lines: 0, functions: 0, branches: 0, statements: 0 };
    }
  }

  private async printSummary(results: TestResults): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    
    // Test Results
    console.log('\n🧪 Test Results:');
    console.log(`   Total Tests: ${results.testResults.total}`);
    console.log(`   ✅ Passed: ${results.testResults.passed}`);
    console.log(`   ❌ Failed: ${results.testResults.failed}`);
    console.log(`   ⏭️  Skipped: ${results.testResults.skipped}`);
    
    // Coverage Results
    console.log('\n📈 Coverage Results:');
    console.log(`   Lines: ${results.coverage.lines.toFixed(2)}%`);
    console.log(`   Functions: ${results.coverage.functions.toFixed(2)}%`);
    console.log(`   Branches: ${results.coverage.branches.toFixed(2)}%`);
    console.log(`   Statements: ${results.coverage.statements.toFixed(2)}%`);
    
    // Overall Status
    console.log('\n🎯 Overall Status:');
    const overallPassed = results.passed && this.meetsThresholds(results.coverage);
    console.log(`   Status: ${overallPassed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`   Duration: ${(results.duration / 1000).toFixed(2)}s`);
    
    // Coverage Thresholds
    const thresholds = { lines: 100, functions: 100, branches: 100, statements: 100 };
    console.log('\n🎯 Coverage Thresholds (Target: 100%):');
    Object.entries(thresholds).forEach(([key, threshold]) => {
      const actual = results.coverage[key as keyof typeof results.coverage];
      const status = actual >= threshold ? '✅' : '❌';
      console.log(`   ${status} ${key}: ${actual.toFixed(2)}% (${threshold}%)`);
    });
    
    // Coverage Report Links
    console.log('\n📋 Coverage Reports:');
    console.log(`   HTML Report: file://${path.join(this.coverageDir, 'lcov-report', 'index.html')}`);
    console.log(`   LCOV File: ${path.join(this.coverageDir, 'lcov.info')}`);
    
    console.log('\n' + '='.repeat(60));
    
    if (!overallPassed) {
      console.log('❌ Some tests failed or coverage thresholds not met');
      process.exit(1);
    } else {
      console.log('🎉 All tests passed and coverage thresholds met!');
    }
  }

  private meetsThresholds(coverage: TestResults['coverage']): boolean {
    return coverage.lines >= 100 &&
           coverage.functions >= 100 &&
           coverage.branches >= 100 &&
           coverage.statements >= 100;
  }

  async runSpecificTest(testPattern: string): Promise<void> {
    console.log(`🧪 Running specific test: ${testPattern}\n`);
    
    return new Promise((resolve, reject) => {
      const jest = spawn('npm', ['test', '--', testPattern, '--verbose'], {
        cwd: this.rootDir,
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: 'test'
        }
      });

      jest.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ Test ${testPattern} completed successfully`);
          resolve();
        } else {
          console.log(`❌ Test ${testPattern} failed`);
          reject(new Error(`Test failed with exit code ${code}`));
        }
      });

      jest.on('error', (error) => {
        reject(error);
      });
    });
  }

  async runWatchMode(): Promise<void> {
    console.log('👀 Starting Jest in watch mode...\n');
    
    const jest = spawn('npm', ['test', '--', '--watch'], {
      cwd: this.rootDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test'
      }
    });

    jest.on('error', (error) => {
      console.error('❌ Failed to start watch mode:', error);
    });
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const runner = new TestRunner();
  
  try {
    if (args.includes('--watch')) {
      await runner.runWatchMode();
    } else if (args.includes('--pattern')) {
      const patternIndex = args.indexOf('--pattern');
      const pattern = args[patternIndex + 1];
      if (!pattern) {
        console.error('❌ Please provide a test pattern after --pattern');
        process.exit(1);
      }
      await runner.runSpecificTest(pattern);
    } else {
      await runner.runAllTests();
    }
  } catch (error) {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  }
}

// Export for programmatic use
export { TestRunner, TestResults };

// Run if called directly
if (require.main === module) {
  main();
}