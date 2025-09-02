import { generateCrawlabilityPdfFromMock } from '../Crawlability_report.js';
import path from 'path';
import fs from 'fs';

function sampleCrawlData() {
  const now = new Date();
  const baseUrl = 'https://example.com/';
  return {
    targetUrl: baseUrl,
    pages: [
      {
        fullUrl: baseUrl,
        totalImages: 10,
        withAlt: 8,
        jsonLd: 2,
        robotsDirectives: ['index,follow'],
        h1Count: 1,
        h2Count: 3,
        h3Count: 5,
        noJsContent: 0,
      },
      {
        fullUrl: baseUrl + 'pricing',
        totalImages: 4,
        withAlt: 2,
        jsonLd: 0,
        robotsDirectives: ['noindex,nofollow'],
        h1Count: 0,
        h2Count: 2,
        h3Count: 2,
        noJsContent: 1,
      },
      {
        fullUrl: baseUrl + 'blog/how-to-seo',
        totalImages: 6,
        withAlt: 6,
        jsonLd: 1,
        robotsDirectives: [],
        h1Count: 1,
        h2Count: 4,
        h3Count: 6,
        noJsContent: 0,
      }
    ],
    crawlDate: now,
    userAgent: 'LLM-Crawlability-Checker/1.0',
    maxDepth: 2,
    maxPages: 20,
    robotsFound: true,
    diagnostics: {
      urlValid: true,
      dnsResolvable: true,
      serverResponsive: true,
      httpAccessible: true,
      httpsAccessible: true,
      robotsAccessible: true,
      redirectChain: [],
      finalUrl: baseUrl,
      statusCode: 200,
      responseTime: 420,
      contentType: 'text/html',
      serverHeaders: {},
      errors: []
    },
    crawlErrors: ['Blocked by robots.txt: https://example.com/admin'],
    crawlSuccess: true,
    crawlFailureReason: null
  };
}

async function run() {
  const outDir = path.resolve('./reports/mock');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'llm_Crawlability_Report_mock.pdf');

  const mockData = sampleCrawlData();
  const pdfPath = await generateCrawlabilityPdfFromMock(mockData, outPath);
  if (pdfPath) {
    console.log('✅ Mock Crawlability PDF created at:', pdfPath);
  } else {
    console.error('❌ Failed to create mock Crawlability PDF');
    process.exit(1);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
