// Global test teardown - runs once after all tests
export default async function globalTeardown() {
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  console.log('🧹 Global test teardown completed');
}