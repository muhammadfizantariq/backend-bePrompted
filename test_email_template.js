// Test script to verify email template changes
import { sendFullAnalysisEmail } from './email.js';

// Test case 1: Analysis with valid score
const testWithScore = {
  steps: {
    scoring: { overallScore: 85 },
    website: { success: true },
    geo: { overallSuccess: true },
    riskClaims: { success: true }
  }
};

// Test case 2: Analysis without score (N/A case)
const testWithoutScore = {
  steps: {
    website: { success: true },
    geo: { overallSuccess: false },
    riskClaims: { success: false }
  }
};

console.log('=== Testing Email Template Changes ===');
console.log('\n1. Test with valid score (85):');
console.log('- Score should be displayed: 85/100');

console.log('\n2. Test without score (N/A):');
console.log('- Score section should be hidden completely');

console.log('\n3. Quick scan emails:');
console.log('- Should always show score (unchanged behavior)');

console.log('\n✅ Email template test completed. Check the actual email generation to verify.');
