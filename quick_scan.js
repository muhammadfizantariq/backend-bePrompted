import { generateReport } from './quick_scan_report.js';
import axios from 'axios';
import https from 'https';
import { createRequire } from 'node:module';
import OpenAI from 'openai';
import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import puppeteer from 'puppeteer';

const require = createRequire(import.meta.url);
const cheerio = require('cheerio');

dotenv.config();

// --- SCHEMAS (Unchanged) ---
const ClaimsSchema = z.object({
  url: z.string().url(),
  key_claims: z.array(z.object({
    claim: z.string(),
    type: z.enum(["fact", "statistic", "citation"]),
    evidence: z.string().nullable(),
    statistics: z.string().nullable(),
    citation: z.string().url().nullable(),
    priority_level: z.number().min(1).max(3)
  })).length(3)
});

const EvaluationSchema = z.object({
  url: z.string().url(),
  claims_evaluation: z.array(z.object({
    claim: z.string(),
    is_quantified: z.number().min(0).max(2),
    is_valid: z.number().min(0).max(2),
    is_vague: z.number().min(-2).max(0),
    needs_verification: z.number().min(-2).max(0),
    claim_score: z.number(),
    improvement_suggestions: z.string()
  })).length(3),
  overall_analysis: z.object({
    summary: z.string(),
    page_score: z.number(),
    recommendations: z.array(z.string()).length(3),
  }),
});

// --- HELPER FUNCTIONS (Unchanged) ---
const sanitizeFilename = (str) => {
  return str.replace(/[^a-z0-9]/gi, '_').toLowerCase();
};

const getDomainFromUrl = (url) => {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return 'unknown_domain';
  }
};

// --- SCORING LOGIC (Unchanged) ---
const calculateFinalScore = (data) => {
  const claimsScore = data.claimsAnalysis?.page_score || 0;
  const technicalScore = data.crawlabilityAnalysis?.score || 0;
  const finalScore = Math.round((claimsScore * 0.7) + (technicalScore * 0.3));
  const getRating = (score) => {
    if (score >= 85) return 'Excellent';
    if (score >= 70) return 'Good';
    if (score >= 55) return 'Fair';
    if (score >= 40) return 'Poor';
    return 'Critical';
  };
  const rating = getRating(finalScore);
  return { finalScore, rating, claimsScore, crawlabilityScore: technicalScore };
};

const calculateTechnicalScore = (metrics) => {
  let score = 0;
  score += (metrics.avgAltTextCoverage / 100) * 40;
  score += metrics.pageWithStructuredData * 20;
  score += (1 - metrics.pageMissingH1) * 20;
  score += (1 - metrics.pageWithJSScript) * 10;
  score += (1 - metrics.pageWithMetaRobots) * 10;
  const finalScore = Math.round(Math.min(score, 100));
  const getRating = (s) => {
    if (s >= 85) return 'Excellent';
    if (s >= 70) return 'Good';
    if (s >= 55) return 'Fair';
    if (s >= 40) return 'Poor';
    return 'Critical';
  };
  return { score: finalScore, rating: getRating(finalScore) };
};

// --- RATE LIMITER (Unchanged) ---
class RateLimiter {
  constructor(maxCalls = 30, windowMs = 60000) { // Changed to 60s window
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
    this.calls = [];
  }
  async waitIfNeeded() {
    const now = Date.now();
    this.calls = this.calls.filter(callTime => now - callTime < this.windowMs);
    if (this.calls.length >= this.maxCalls) {
      const waitTime = this.windowMs - (now - Math.min(...this.calls));
      if (waitTime > 0) {
        console.log(`⏳ Rate limit: waiting ${Math.ceil(waitTime / 1000)}s`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    this.calls.push(now);
  }
}

class StandaloneAnalyzer {
  constructor(options = {}) {
    this.config = {
      jinaApiKey: options.jinaApiKey || process.env.JINA_API_KEY,
      openaiApiKey: options.openaiApiKey || process.env.OPENAI_API_KEY,
      generatePDF: options.generatePDF !== false,
      outputDir: options.outputDir || './reports',
      email: options.email || null,
      customFilename: options.customFilename || null
    };
    if (!this.config.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is required for claims analysis');
    }
    this.openai = new OpenAI({ apiKey: this.config.openaiApiKey });
    this.rateLimiter = new RateLimiter();
  }

  generateReportFilename(url, email = null) {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const domain = getDomainFromUrl(url);
    const sanitizedEmail = email ? sanitizeFilename(email) : null;
    return sanitizedEmail ?
      `${sanitizedEmail}_${domain}_${timestamp}` :
      `${domain}_${timestamp}`;
  }

  async fetchViaJinaAI(url) {
    // ... (This function is unchanged)
    const encodedUrl = encodeURIComponent(url);
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'r.jina.ai',
        path: `/${encodedUrl}`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.jinaApiKey}`,
          Accept: 'text/plain',
        },
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log('✅ Fetched via Jina AI');
            resolve(data);
          } else {
            reject(new Error(`Jina AI non-200 response: ${res.statusCode}`));
          }
        });
      });
      req.on('error', (e) => reject(e));
      req.end();
    });
  }

  /**
   * ## NEW: Robust Content and Metadata Extraction
   * This function attempts to extract content using a robust Puppeteer setup first.
   * If Puppeteer fails, it falls back to Jina AI for content and Axios for metadata.
   */
 async fetchAndExtractContent(url) {
    let content = null;
    let metaTags = null;

    // --- STRATEGY 1: PUPPETEER (Primary & Improved) ---
    try {
      console.log('🚀 Attempting content extraction with improved Puppeteer...');
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
      
      // Navigate to the page with a generous timeout
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
      
      // Wait for a common content container to be available
      await page.waitForSelector('main, article, body', { timeout: 15000 });

      // Extract both meta tags and content in one operation
      const pageData = await page.evaluate(() => {
        const getMeta = (attr, val) => document.querySelector(`meta[${attr}="${val}"]`)?.content || null;
        
        const metas = {
          title: document.title?.trim() || null,
          description: getMeta('name', 'description'),
          keywords: getMeta('name', 'keywords'),
          ogTitle: getMeta('property', 'og:title'),
          ogDescription: getMeta('property', 'og:description'),
          ogImage: getMeta('property', 'og:image'),
        };

        // Clean the DOM for better text extraction
        document.querySelectorAll('script, style, nav, header, footer, aside, form').forEach(el => el.remove());
        const pageContent = document.body.innerText.replace(/\s\s+/g, ' ').trim();
        
        return { metaTags: metas, content: pageContent };
      });

      await browser.close();
      
      if (pageData.content && pageData.content.length > 100) {
        console.log('✅ Content and meta tags extracted successfully with Puppeteer.');
        return { metaTags: pageData.metaTags, content: pageData.content };
      } else {
        throw new Error('Puppeteer extracted minimal content.');
      }

    } catch (puppeteerError) {
      console.warn('⚠️ Puppeteer extraction failed:', puppeteerError.message);
      console.log('🔄 Falling back to Jina AI and Axios...');
    }

    // --- STRATEGY 2: JINA (Content) + AXIOS (Metas) Fallback ---
    try {
      // Fetch content via Jina AI (most reliable)
      content = await this.fetchViaJinaAI(url);

      // Attempt to fetch meta tags via Axios, but don't crash if it fails
      try {
        const metaResponse = await axios.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          timeout: 15000,
        });
        const $ = cheerio.load(metaResponse.data);
        const getMeta = (attrName, attrValue) => $(`meta[${attrName}="${attrValue}"]`).attr('content');
        metaTags = {
          title: $('title').text()?.trim() || null,
          description: getMeta('name', 'description'),
          keywords: getMeta('name', 'keywords'),
          ogTitle: getMeta('property', 'og:title'),
          ogDescription: getMeta('property', 'og:description'),
          ogImage: getMeta('property', 'og:image'),
        };
        console.log('✅ Meta tags extracted via Axios fallback.');
      } catch (axiosError) {
        console.warn(`⚠️ Axios meta tag extraction failed (${axiosError.code}). Proceeding without meta tags.`);
        // Meta tags will remain null, handled by the next function
      }
      
      console.log('✅ Content extracted via Jina AI fallback.');
      return { metaTags, content };

    } catch (finalError) {
      console.error('❌ All content extraction methods failed critically.');
      throw new Error(`Jina AI also failed: ${finalError.message}`);
    }
  }

createTechnicalAnalysisFromMetaTags(metaTags) {
    const issues = [],
      recommendations = [];
    const metrics = {
      avgAltTextCoverage: 0,
      pageWithStructuredData: 0,
      pageMissingH1: 0,
      pageWithJSScript: 0,
      pageWithMetaRobots: 0
    };

    // --- NEW: Handle case where metaTags could not be fetched at all ---
    if (!metaTags) {
      issues.push('Could not extract HTML meta tags (page may be blocking scrapers).');
      recommendations.push('Ensure the page is publicly accessible and not behind a WAF/firewall.');
      metrics.avgAltTextCoverage = 10; // Assign a minimal score
      metrics.pageMissingH1 = 1;
      return { metrics, issues, recommendations };
    }

    // --- Existing logic for when metaTags ARE available ---
    if (metaTags.title) {
      const titleLength = metaTags.title.length;
      if (titleLength >= 30 && titleLength <= 60) {
        metrics.avgAltTextCoverage += 25;
      } else {
        issues.push(titleLength > 60 ? 'Title tag is too long (> 60 characters)' : 'Title tag is too short (< 30 characters)');
        recommendations.push(titleLength > 60 ? 'Shorten title tag to under 60 characters' : 'Expand title tag to 30-60 characters');
        metrics.avgAltTextCoverage += 10;
      }
    } else {
      issues.push('Missing title tag');
      recommendations.push('Add a descriptive title tag (30-60 characters)');
      metrics.pageMissingH1 = 1;
    }
    if (metaTags.description) {
      const descLength = metaTags.description.length;
      if (descLength >= 120 && descLength <= 160) {
        metrics.avgAltTextCoverage += 25;
      } else {
        issues.push(descLength > 160 ? 'Meta description is too long (> 160 characters)' : 'Meta description is too short (< 120 characters)');
        recommendations.push(descLength > 160 ? 'Shorten meta description to under 160 characters' : 'Expand meta description to 120-160 characters');
        metrics.avgAltTextCoverage += 15;
      }
    } else {
      issues.push('Missing meta description');
      recommendations.push('Add a compelling meta description (120-160 characters)');
    }
    if (metaTags.ogTitle || metaTags.ogDescription || metaTags.ogImage) {
      let ogCompleteness = (metaTags.ogTitle ? 0.33 : 0) + (metaTags.ogDescription ? 0.33 : 0) + (metaTags.ogImage ? 0.34 : 0);
      metrics.pageWithStructuredData = ogCompleteness >= 1.0 ? 1 : 0;
      metrics.avgAltTextCoverage += Math.round(ogCompleteness * 25);
      if (ogCompleteness < 1.0) {
        issues.push('Incomplete Open Graph tags');
        recommendations.push('Complete Open Graph tags (og:title, og:description, og:image) for better social sharing');
      }
    } else {
      issues.push('Missing Open Graph tags');
      recommendations.push('Add Open Graph tags for social media sharing');
      metrics.pageWithStructuredData = 0;
    }
    if (metaTags.keywords) metrics.avgAltTextCoverage += 10;
    metrics.avgAltTextCoverage += 15;
    metrics.avgAltTextCoverage = Math.min(metrics.avgAltTextCoverage, 100);
    
    return { metrics, issues, recommendations: recommendations.slice(0, 3) };
  }

  /**
   * ## NEW: LLM Caller with Automatic JSON Repair
   * This function now catches JSON parsing errors and attempts a simple repair
   * by stripping any non-JSON text surrounding the main object.
   */
  async callLLM(prompt, schema, maxRetries = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.rateLimiter.waitIfNeeded();
        const completion = await this.openai.chat.completions.create({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [{
            role: "system",
            content: "You are an expert content analysis assistant designed to output a single, raw JSON object. Strictly adhere to the user's requested schema. Do not include any markdown, code blocks, or explanations outside of the JSON."
          }, {
            role: "user",
            content: prompt
          }],
          temperature: 0.0,
          seed: 42,
        });
        let content = completion.choices[0].message.content;

        try {
          const parsed = JSON.parse(content);
          return schema.parse(parsed);
        } catch (jsonError) {
          console.warn(`⚠️ Attempt ${attempt}: Invalid JSON received. Attempting repair...`);
          const startIndex = content.indexOf('{');
          const endIndex = content.lastIndexOf('}');
          if (startIndex > -1 && endIndex > -1 && endIndex > startIndex) {
            content = content.substring(startIndex, endIndex + 1);
            const repairedParsed = JSON.parse(content);
            console.log('✅ JSON repaired and parsed successfully.');
            return schema.parse(repairedParsed);
          }
          throw new Error(`JSON repair failed; no valid object found. Content: ${content}`);
        }
      } catch (error) {
        console.error(`🐛 LLM call or validation on attempt ${attempt} failed:`, error.message);
        lastError = error;
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    throw new Error(`Failed after ${maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * ## NEW: Refined Claims Extraction Prompt
   * This prompt is simplified and more direct, framing the task as a deterministic algorithm.
   */
  buildClaimsExtractionPrompt(url, content) {
    return `
# ROLE: Deterministic Data Extractor
# GOAL: Extract exactly 3 claims from the text by following a strict algorithm.
# OUTPUT: A single, raw JSON object. Do not add explanations or markdown.

---
### Algorithm for Claim Selection
You MUST extract exactly ONE claim for EACH priority level below, in order. Process the document from top to bottom for each level.




**1. Priority 1: Cited Statistic**
   - **Rule:** Find the FIRST sentence with BOTH a number (e.g., 1, 25, 1000) AND a citation keyword (e.g., "source", "study", "report", "according to").
   - **If None Found:** Use placeholder: "No cited statistics found."

**2. Priority 2: Quantified Claim**
   - **Rule:** Find the FIRST sentence with a number (e.g., 50%, $10M, 1,000) NOT already selected for Priority 1.
   - **If None Found:** Use placeholder: "No quantified claims found."

**3. Priority 3: Named Evidence**
   - **Rule:** Find the FIRST sentence with an evidence keyword (e.g., "featured in", "partnered with", "certified by", "award-winning") NOT already selected.
   - **If None Found:** Use placeholder: "No named evidence found."

"IMPORTANT/CRITICAL: To ensure the same claims are produced every time, try to choose the smallest 3 claims after considering the 3 priorities."
---
### Formatting Rules
- **claim:** The literal sentence extracted or the placeholder.
- **type:** "statistic" if it contains a number; "citation" if it names a source but has no number; "fact" otherwise.
- **evidence:** The specific supporting phrase (e.g., "according to a report") or null.
- **statistics:** The numeric part of the claim (e.g., "25%") or null.
// --- MODIFIED & IMPROVED RULE ---
- **citation:** Extract a string ONLY IF it starts with \`http://\` or \`https://\`. If no such string exists in the claim, this value MUST be \`null\`. Do NOT put source names like 'Forbes' or 'Gartner report' here.
- **priority_level:** Must be 1, 2, or 3.
- **AVOID:** Vague marketing terms like "world-class", "best", "easy", "seamless".

---
### Required JSON Output Structure
{
  "url": "${url}",
  "key_claims": [
    { "claim": "string", "type": "statistic", "evidence": "string|null", "statistics": "string|null", "citation": "string|null", "priority_level": 1 },
    { "claim": "string", "type": "statistic", "evidence": "string|null", "statistics": "string|null", "citation": "string|null", "priority_level": 2 },
    { "claim": "string", "type": "fact", "evidence": "string|null", "statistics": "string|null", "citation": "string|null", "priority_level": 3 }
  ]
}

---
### Input Data
**URL:** ${url}
**CONTENT TO ANALYZE (first 12000 chars):**
${content.substring(0, 12000)}
`;
  }

  /**
   * ## NEW: Refined Claims Evaluation Prompt
   * This prompt is structured as a clear, two-part calculation to guide the LLM precisely.
   */
 buildClaimsEvaluationPrompt(url, claims) {
    const claimsText = claims.map((c, i) => `
---
**Claim ${i + 1} (Priority ${c.priority_level})**
- **Statement:** "${c.claim}"
- **Type:** ${c.type}
- **Evidence:** ${c.evidence || 'N/A'}
- **Statistics:** ${c.statistics || 'N/A'}
- **Citation:** ${c.citation || 'N/A'}
`).join('');

    return `
# ROLE: Deterministic Content Quality Calculator
# GOAL: Evaluate 3 claims using a fixed scoring protocol and calculate an overall page score.
# OUTPUT: A single, raw JSON object. Use ONLY the provided data.

---
### Part 1: Per-Claim Scoring Protocol
For each of the 3 claims, populate the following fields precisely as defined:

- **claim**: You MUST copy the original claim's "Statement" verbatim into this field.
- **is_quantified**: +2 if "Statistics" is not N/A or "Statement" has a digit; +1 for number words (e.g., "hundreds"); 0 otherwise.
- **is_valid**: +2 if "Citation" is a URL; +1 if "Evidence" is not N/A but "Citation" is; 0 otherwise.
- **is_vague**: -2 for vague quantifiers (e.g., "many", "a lot"); -1 for vague frequencies (e.g., "often", "typically"); 0 otherwise.
- **needs_verification**: 0 if "Citation" is not N/A; -1 if "Evidence" is not N/A but "Citation" is; -2 otherwise.
- **claim_score**: The sum of the four scores above.
- **improvement_suggestions**: A concise sentence to fix the weakest part of the claim (e.g., "Add a specific data point to quantify the impact.").

---
### Part 2: Overall Analysis Protocol
1.  **Calculate Normalized Scores**: For each claim, calculate \`(claim_score + 4) * 12.5\`.
2.  **Calculate page_score**: Average the 3 Normalized Scores and round to the nearest integer.
3.  **Generate summary**: Write one sentence identifying the most common weakness (e.g., "The content's primary weakness is a lack of verifiable citations.").
4.  **Generate recommendations**: Provide 3 recommendations, one for each claim, using the template: "To strengthen '[original claim]', add a source, like '...as shown in the 2024 Gartner report.'"

---
### Required JSON Output Structure
{
  "url": "${url}",
  "claims_evaluation": [ 
    {
      "claim": "The original claim text goes here.",
      "is_quantified": 0,
      "is_valid": 0,
      "is_vague": 0,
      "needs_verification": 0,
      "claim_score": 0,
      "improvement_suggestions": "string"
    }
    /*... exactly 3 items total ...*/
   ],
  "overall_analysis": { "summary": "string", "page_score": 0, "recommendations": [ /* exactly 3 strings */ ] }
}

---
### Input Data
**URL:** ${url}
**CLAIMS TO EVALUATE:**
${claimsText}`;
  }

  
  async analyzeSingleUrl(url, email) {
    console.log(`🌐 Analyzing: ${url}`);
    if (email) console.log(`📧 Email: ${email}`);
    try {
      console.log('🔄 Step 1: Fetching and extracting content...');
      const { metaTags, content } = await this.fetchAndExtractContent(url);

      console.log('📝 Step 2: Extracting claims from content...');
      const claimsResult = await this.callLLM(
        this.buildClaimsExtractionPrompt(url, content),
        ClaimsSchema
      );

      console.log('📊 Step 3: Evaluating claims...');
      const evaluationResult = await this.callLLM(
        this.buildClaimsEvaluationPrompt(url, claimsResult.key_claims),
        EvaluationSchema
      );

      // --- NEW: Calculate claims page score deterministically in code ---
      // This is the missing piece. We calculate the score here instead of trusting the LLM.
      const claimsScores = evaluationResult.claims_evaluation.map(
          claim => (claim.claim_score + 4) * 12.5 // Normalize each score
      );
      const claimsPageScore = Math.round(
          claimsScores.reduce((acc, score) => acc + score, 0) / (claimsScores.length || 1)
      );
      console.log(`🧮 Calculated claims page score deterministically: ${claimsPageScore}`);

      console.log('🔧 Step 4: Performing technical analysis...');
      const technicalAnalysisData = this.createTechnicalAnalysisFromMetaTags(metaTags);
      const technicalScoreResult = calculateTechnicalScore(technicalAnalysisData.metrics);

const domain = getDomainFromUrl(url);
        const sanitizedEmail = email ? sanitizeFilename(email) : 'no_email';
        const reportDirectoryName = `quickScan_${domain}_${sanitizedEmail}`;
        const fullReportDirectory = path.join(this.config.outputDir, reportDirectoryName);
        const pdfFilename = 'quickScan_report.pdf';
        const jsonFilename = `${this.generateReportFilename(url, email)}.json`;
      const finalResult = {
        url,
        email: email || null,
        timestamp: new Date(),
        jinaContent: content,
        metaTags: metaTags,
        claimsAnalysis: {
          evaluated_claims: evaluationResult.claims_evaluation,
          summary: evaluationResult.overall_analysis.summary,
          // --- MODIFIED LINE: Use our reliably calculated score ---
          page_score: claimsPageScore,
          recommendations: evaluationResult.overall_analysis.recommendations
        },
        crawlabilityAnalysis: {
          score: technicalScoreResult.score,
          rating: technicalScoreResult.rating,
          metrics: technicalAnalysisData.metrics,
          issues: technicalAnalysisData.issues,
          recommendations: technicalAnalysisData.recommendations
        },
        reportDirectory: fullReportDirectory,
        jsonFilename: `${this.generateReportFilename(url, email)}.json`,
        pdfFilename: 'quickScan_report.pdf',
        status: 'success'
      };

      const scoreResult = calculateFinalScore(finalResult);
      finalResult.finalScore = scoreResult.finalScore;
      finalResult.finalRating = scoreResult.rating;

let pdfReportPath = null;
        if (this.config.generatePDF) {
          console.log('📄 Step 4: Generating PDF report...');
          try {
            const pdfResult = await generateReport(finalResult, {
              directory: fullReportDirectory,
              fileName: pdfFilename
            });
            console.log(`✅ PDF report generated: ${pdfResult.filePath}`);
            finalResult.pdfReport = pdfResult;
            pdfReportPath = pdfResult.filePath;
          } catch (pdfError) {
            console.warn('⚠️ PDF generation failed:', pdfError.message);
            finalResult.pdfError = pdfError.message;
          }
        }

        // --- Send email if address provided ---
        if (email) {
          try {
            const { sendScanResultsEmail } = await import('./email.js');
            await sendScanResultsEmail({
              to: email,
              score: finalResult.finalScore,
              recommendations: finalResult.claimsAnalysis.recommendations,
              pdfPath: pdfReportPath
            });
            console.log(`📧 Results email sent to ${email}`);
          } catch (mailErr) {
            console.error(`❌ Failed to send email to ${email}:`, mailErr.message);
          }
        }

        console.log('✅ Analysis complete!\n');
        console.log(finalResult)
        return finalResult;
    } catch (err) {
      console.error(`❌ A critical error occurred during analysis for ${url}:`, err.message);
      return { url, email: email || null, status: 'error', error: err.message, timestamp: new Date() };
    }
  }
}
// --- Standalone Execution (Unchanged) ---
async function main() {
  const args = process.argv.slice(2);
  let url = null, email = null, outputDir = './reports', generatePDF = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--no-pdf') generatePDF = false;
    else if (arg === '--output-dir' && args[i + 1]) outputDir = args[++i];
    else if (arg === '--email' && args[i + 1]) email = args[++i];
    else if (!url && !arg.startsWith('--')) url = arg;
  }

  if (!url) {
    console.error('❌ Please provide a URL. Usage: node quick_scan.js <URL> [--email <email>] [--no-pdf]');
    process.exit(1);
  }
  try {
    new URL(url);
  } catch {
    console.error('❌ Invalid URL format');
    process.exit(1);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('❌ Invalid email format');
    process.exit(1);
  }

  console.log('🚀 Starting Quick Scan analysis...\n');
  const analyzer = new StandaloneAnalyzer({ outputDir, email, generatePDF });
  const result = await analyzer.analyzeSingleUrl(url, email);

  if (result.status === 'success') {
    console.log('\n🎉 Analysis completed successfully!');
    try {
      const fs = await import('fs/promises');
      await fs.mkdir(result.reportDirectory, { recursive: true });
      const jsonFilePath = path.join(result.reportDirectory, result.jsonFilename);
      await fs.writeFile(jsonFilePath, JSON.stringify(result, null, 2));
      console.log(`💾 JSON results saved to: ${jsonFilePath}`);
    } catch (writeError) {
      console.error(`❌ Could not save JSON report: ${writeError.message}`);
    }
    console.log('\n📋 Key Insights:');
    console.log(`⭐️ Claims Score: ${result.claimsAnalysis.page_score}/100`);
    console.log(`🔧 Technical Score: ${result.crawlabilityAnalysis.score}/100 (${result.crawlabilityAnalysis.rating})`);
    console.log(`🏆 Final GEO Score: ${result.finalScore}/100 (${result.finalRating})`);
    console.log(`💡 Summary: ${result.claimsAnalysis.summary}`);
    console.log(`🔧 Recommendations:`);
    result.claimsAnalysis.recommendations.forEach((rec, i) => console.log(`   ${i + 1}. ${rec}`));
    if (result.crawlabilityAnalysis.issues.length > 0) {
      console.log(`\n⚠️ Technical Issues Found:`);
      result.crawlabilityAnalysis.issues.forEach((issue, i) => console.log(`   ${i + 1}. ${issue}`));
    }
    if (result.pdfReport) {
      console.log(`\n📄 PDF report available at: ${result.pdfReport.filePath}`);
    } else if (generatePDF && result.pdfError) {
      console.log(`\n⚠️ PDF generation failed: ${result.pdfError}`);
    }
  } else {
    console.log('\n❌ Analysis failed');
    console.error('Error:', result.error);
    process.exit(1);
  }
}

if (import.meta.url.startsWith('file:')) {
  const scriptPath = new URL(import.meta.url).pathname;
  const currentPath = process.argv[1];
  if (scriptPath.endsWith(currentPath.split(/[\\/]/).pop())) {
    main().catch((error) => {
      console.error('💥 A fatal, unhandled error occurred:', error.message);
      process.exit(1);
    });
  }
}

export { StandaloneAnalyzer };