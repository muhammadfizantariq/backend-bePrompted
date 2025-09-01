import { MongoClient } from 'mongodb';
import OpenAI from 'openai';
import { z } from 'zod';
import 'dotenv/config';

// CONFIG
const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = 'webdata';
const COLLECTION_NAME = 'extractions_3';

// RATE LIMITER - More conservative for OpenAI
class RateLimiter {
  constructor(maxCalls = 50, windowMs = 60000) { // OpenAI allows more requests
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
        console.log(`⏳ Rate limit: waiting ${Math.ceil(waitTime/1000)}s`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    this.calls.push(now);
  }
}

// COMPLETE SCHEMAS - These were missing in your second file!
const ClaimsSchema = z.object({
  url: z.string().url(),
  key_claims: z.array(z.object({
    claim: z.string(),
    type: z.enum(["fact", "statistic", "citation"]),
    evidence: z.string().nullable(),
    statistics: z.string().nullable(),
    citation: z.string().nullable()
  }))
});

const FAQSchema = z.object({
  url: z.string().url(),
  "@context": z.literal("https://schema.org"),
  "@type": z.literal("FAQPage"),
  mainEntity: z.array(z.object({
    "@type": z.literal("Question"),
    name: z.string(),
    acceptedAnswer: z.object({
      "@type": z.literal("Answer"),
      text: z.string()
    })
  }))
});

const EvaluationSchema = z.object({
  url: z.string().url(),
  claims_evaluation: z.array(
    z.object({
      claim: z.string(),
      is_quantified: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      is_valid: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      is_vague: z.number(),
      needs_verification: z.number(),
      claim_score: z.number(),
      improvement_suggestions: z.string(),
    })
  ),
  overall_analysis: z.object({
    summary: z.string(),
    average_page_score: z.number(),
    recommendations: z.string(),
  }),
});

// MAIN CLASS
class RISKCLAIMSAnalyzer {
  constructor(apiKey, config = {}) {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required');
    }
    
    this.openai = new OpenAI({ apiKey });
    this.rateLimiter = new RateLimiter(config.maxCalls || 50, config.windowMs || 60000);
    this.client = null;
    this.collection = null;
    this.mongoUri = config.mongoUri || MONGO_URI;
    this.mongoOptions = config.mongoOptions || {};
    this.dbName = config.dbName || DB_NAME;
    this.collectionName = config.collectionName || COLLECTION_NAME;
  }

  // UTILITIES
  normalizeUrl(url) {
    return (url || '').trim().replace(/\/+$|\/+(?=\?|#)/g, '').toLowerCase();
  }

  extractDomain(url) {
    return new URL(url).hostname.replace(/^www\./, '');
  }

  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // MONGO OPERATIONS
  async connect() {
    if (this.client) return;
    this.client = new MongoClient(this.mongoUri, this.mongoOptions);
    await this.client.connect();
    this.collection = this.client.db(this.dbName).collection(this.collectionName);
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.collection = null;
    }
  }

  async getPages(baseUrl) {
    await this.connect();
    
    const domain = this.extractDomain(baseUrl);
    let query = {
      url: { $regex: this.escapeRegex(domain), $options: 'i' },
      status: 'done',
      'ai.classification.faq_needed': true,
      $or: [
        { jinaContent: { $exists: true, $ne: null, $ne: '' } },
        { 'ai.page_summary': { $exists: true, $ne: null, $ne: '' } }
      ]
    };

    const docs = await this.collection.find(query).project({
      url: 1,
      jinaContent: 1,
      'ai.page_summary': 1,
      'ai.meta_tags.analysis.page_summary': 1,
      'ai.classification': 1,
      'ai.key_claims_analysis': 1,
      'ai.faq_schema': 1,
      'ai.claims_evaluation': 1,
      _id: 0
    }).toArray();

    return docs.map(d => ({
      url: d.url.trim(),
      summary: d.ai?.page_summary?.trim() || d.ai?.meta_tags?.analysis?.page_summary?.trim() || '',
      jinaContent: d.jinaContent?.trim() || '',
      claims: d.ai?.key_claims_analysis?.key_claims || [],
      processed: {
        claimsExtracted: !!d.ai?.key_claims_analysis,
        faqGenerated: !!d.ai?.faq_schema,
        evaluated: !!d.ai?.claims_evaluation
      },
      faqNeeded: d.ai?.classification?.faq_needed || false
    }));
  }

  // LLM CALLS with improved error handling
  async callLLM(prompt, schema, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.rateLimiter.waitIfNeeded();
        
        const fullPrompt = `${prompt}

IMPORTANT: Return your response as valid JSON only. Do not include any markdown formatting, code blocks, or explanations. Just return the raw JSON.`;

        const completion = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an assistant that only responds in valid JSON format. Always include all required fields.' },
            { role: 'user', content: fullPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.0,
          max_tokens: 4000,
          top_p: 0.1,
          seed: 42,
        });

        let content = completion.choices[0].message.content.trim();
        
        // Clean up response
        if (content.startsWith('```json')) {
          content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (content.startsWith('```')) {
          content = content.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        
        let parsed = JSON.parse(content);
        
        // Validate with schema
        const result = schema.parse(parsed);
        
        console.log(`✅ Successfully processed with ${result.key_claims?.length || result.claims_evaluation?.length || result.mainEntity?.length || 0} items`);
        
        return result;

      } catch (error) {
        console.error(`🐛 DEBUG - Attempt ${attempt} failed:`, error.message);
        
        if (error.name === 'ZodError') {
          console.error('Schema validation errors:', error.errors);
        }
        
        if (attempt === maxRetries) {
          throw new Error(`Failed after ${maxRetries} attempts: ${error.message}`);
        }
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  // PROMPT BUILDERS - Fixed to ensure all required fields
  buildClaimsExtractionPrompt(page) {
    const content = page.jinaContent || page.summary;
    const contentType = page.jinaContent ? 'full page content' : 'page summary';
    
    return `You are an expert in website content analysis for Generative Engine Optimization (GEO).

Your Task:
Analyze the text to identify and extract **up to 10** of the most important factual claims that would be helpful for a potential customer.

**CRITICAL INSTRUCTION: If you find no factual claims that meet the criteria, you MUST return an empty array [] for the "key_claims" field, but ALWAYS include the url field.**

Strict Extraction Rules:
- Prioritize Customer Value: Select only the most impactful claims for a potential customer.
- No Inference: Do NOT guess or infer — only use what's explicitly present in the text.
- Include Specifics: Extract direct statistics, numbers, and measurable facts.
- Always include the URL in your response

For each claim, classify as:
- "fact": general factual statement
- "statistic": contains measurable numbers/data  
- "citation": references external source

REQUIRED Output Format - MUST include url field:
{
  "url": "${page.url}",
  "key_claims": [
    {
      "claim": "string",
      "type": "fact",
      "evidence": null,
      "statistics": null,
      "citation": null
    }
  ]
}

URL: ${page.url}
CONTENT (${contentType.toUpperCase()}):
${content}`;
  }

  buildFAQGenerationPrompt(page) {
    const claimsText = page.claims.map(claim => {
      let claimEntry = `Claim: ${claim.claim}\nType: ${claim.type}`;
      
      if (claim.evidence) claimEntry += `\nEvidence: ${claim.evidence}`;
      if (claim.statistics) claimEntry += `\nStatistics: ${claim.statistics}`;
      if (claim.citation) claimEntry += `\nCitation: ${claim.citation}`;
      
      return claimEntry;
    }).join('\n\n---\n\n');

    return `You are an expert in SEO and Schema.org structured data.

Your task: Convert the provided claims into FAQ format with Schema.org structure.

REQUIRED Output Format - MUST include all fields:
{
  "url": "${page.url}",
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What does the company offer?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Factual answer based on the claims provided"
      }
    }
  ]
}

URL: ${page.url}
Claims to convert:
${claimsText}`;
  }

  buildClaimsEvaluationPrompt(page) {
    const claimsText = page.claims.map((claim, index) => {
      let claimEntry = `**Claim ${index + 1}:**\nStatement: ${claim.claim}\nType: ${claim.type}`;
      
      if (claim.evidence) claimEntry += `\nEvidence: ${claim.evidence}`;
      if (claim.statistics) claimEntry += `\nStatistics: ${claim.statistics}`;
      if (claim.citation) claimEntry += `\nCitation: ${claim.citation}`;
      
      return claimEntry;
    }).join('\n\n---\n\n');

    return `You are an expert in content quality assessment and Generative Engine Optimization (GEO).

Evaluate each claim using these scoring criteria:

1. is_quantified: 0, 1, or 2 (2=fully quantified, 1=partially, 0=not quantified)
2. is_valid: 0, 1, or 2 (2=well-supported, 1=plausible, 0=false/inconsistent)  
3. is_vague: -2, -1, or 0 (0=precise, -1=somewhat vague, -2=very vague)
4. needs_verification: -2, -1, or 0 (0=well-cited, -1=weak source, -2=no source)
5. claim_score: Sum of above scores (range: -4 to +4)

REQUIRED Output Format - MUST include all fields:
{
  "url": "${page.url}",
  "claims_evaluation": [
    {
      "claim": "exact_claim_text_from_input",
      "is_quantified": 0,
      "is_valid": 1,
      "is_vague": -1,
      "needs_verification": -1,
      "claim_score": -1,
      "improvement_suggestions": "Specific actionable advice"
    }
  ],
  "overall_analysis": {
    "summary": "Brief assessment of overall content quality",
    "average_page_score": 45.5,
    "recommendations": "Strategic advice for improving GEO performance"
  }
}

URL: ${page.url}
Claims to evaluate:
${claimsText}`;
  }

  // STORAGE with better error handling
  async store(result, task) {
    await this.connect();
    
    if (!result.url) {
      throw new Error(`Cannot store result: missing URL for task ${task}`);
    }
    
    const update = {
      updateOne: {
        filter: { url: { $regex: `^${this.escapeRegex(this.normalizeUrl(result.url))}$`, $options: 'i' } },
        update: { $set: this.getUpdateObject(result, task) }
      }
    };

    try {
      const bulkResult = await this.collection.bulkWrite([update]);
      console.log(`💾 Updated ${bulkResult.modifiedCount} documents for ${task} - URL: ${result.url}`);
      return bulkResult;
    } catch (error) {
      console.error(`❌ Storage failed for ${task}:`, error.message);
      throw error;
    }
  }

  getUpdateObject(result, task) {
    const now = new Date();
    switch (task) {
      case 'claims':
        return {
          'ai.key_claims_analysis': {
            key_claims: result.key_claims || [],
            analyzed_at: now
          }
        };
      case 'faq':
        return {
          'ai.faq_schema': {
            faq_jsonld: result,
            generated_at: now
          }
        };
      case 'evaluate':
        return {
          'ai.claims_evaluation': {
            claims_evaluation: result.claims_evaluation || [],
            overall_analysis: result.overall_analysis || {},
            evaluated_at: now,
            evaluation_version: '2.0'
          }
        };
      default:
        throw new Error(`Unknown task: ${task}`);
    }
  }

  // INDIVIDUAL TASK METHODS with better error handling
  async extractClaims(baseUrl) {
    const pages = await this.getPages(baseUrl);
    const claimsPages = pages.filter(p => !p.processed.claimsExtracted && (p.jinaContent || p.summary));
    
    console.log(`📝 Extracting claims for ${claimsPages.length} pages...`);
    const results = [];

    for (const page of claimsPages) {
      console.log(`📄 Extracting claims for: ${page.url}`);
      try {
        const result = await this.callLLM(this.buildClaimsExtractionPrompt(page), ClaimsSchema);
        
        // Ensure URL is present
        if (!result.url) {
          console.warn(`⚠️ Adding missing URL for ${page.url}`);
          result.url = page.url;
        }

        await this.store(result, 'claims');
        results.push(result);
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`❌ Claims extraction failed: ${page.url} - ${error.message}`);
        results.push({ url: page.url, error: error.message });
      }
    }
    return results;
  }

  async generateFAQs(baseUrl) {
    const pages = await this.getPages(baseUrl);
    const faqPages = pages.filter(p => !p.processed.faqGenerated && p.claims.length > 0);
    
    console.log(`❓ Generating FAQs for ${faqPages.length} pages...`);
    const results = [];

    for (const page of faqPages) {
      console.log(`📄 Generating FAQ for: ${page.url}`);
      try {
        const result = await this.callLLM(this.buildFAQGenerationPrompt(page), FAQSchema);
        
        if (!result.url) {
          result.url = page.url;
        }

        await this.store(result, 'faq');
        results.push(result);
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`❌ FAQ generation failed: ${page.url} - ${error.message}`);
        results.push({ url: page.url, error: error.message });
      }
    }
    return results;
  }

  async evaluateClaims(baseUrl) {
    const pages = await this.getPages(baseUrl);
    const evaluatePages = pages.filter(p => !p.processed.evaluated && p.claims.length > 0);
    
    console.log(`📊 Evaluating claims for ${evaluatePages.length} pages...`);
    const results = [];

    for (const page of evaluatePages) {
      console.log(`📄 Evaluating claims for: ${page.url} (${page.claims.length} claims)`);
      try {
        const result = await this.callLLM(this.buildClaimsEvaluationPrompt(page), EvaluationSchema);
        
        if (!result.url) {
          result.url = page.url;
        }

        await this.store(result, 'evaluate');
        results.push(result);
        
        console.log(`  ✅ Evaluated ${result.claims_evaluation.length} claims, avg score: ${result.overall_analysis.average_page_score}`);
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`❌ Claims evaluation failed: ${page.url} - ${error.message}`);
        results.push({ url: page.url, error: error.message });
      }
    }
    return results;
  }

  // COMPLETE ANALYSIS
  async analyzeComplete(baseUrl) {
    console.log(`🔄 Starting complete analysis for: ${baseUrl}`);
    
    try {
      console.log('\n📝 STEP 1: Extracting claims...');
      const claimsResults = await this.extractClaims(baseUrl);

      console.log('\n❓ STEP 2: Generating FAQs...');
      const faqResults = await this.generateFAQs(baseUrl);

      console.log('\n📊 STEP 3: Evaluating claims...');
      const evaluationResults = await this.evaluateClaims(baseUrl);

      console.log('\n🎉 Complete analysis finished!');

      const summary = {
        total_pages_processed: new Set([
          ...claimsResults.map(r => r.url).filter(Boolean),
          ...faqResults.map(r => r.url).filter(Boolean),
          ...evaluationResults.map(r => r.url).filter(Boolean)
        ]).size,
        claims_extracted: claimsResults.filter(r => !r.error).length,
        faqs_generated: faqResults.filter(r => !r.error).length,
        claims_evaluated: evaluationResults.filter(r => !r.error).length,
        errors: [
          ...claimsResults.filter(r => r.error),
          ...faqResults.filter(r => r.error),
          ...evaluationResults.filter(r => r.error)
        ]
      };

      console.log('\n📈 SUMMARY:');
      console.log(`  Pages processed: ${summary.total_pages_processed}`);
      console.log(`  Claims extracted: ${summary.claims_extracted}`);
      console.log(`  FAQs generated: ${summary.faqs_generated}`);
      console.log(`  Claims evaluated: ${summary.claims_evaluated}`);
      console.log(`  Errors: ${summary.errors.length}`);

      return {
        claims: claimsResults,
        faqs: faqResults,
        evaluations: evaluationResults,
        summary
      };

    } catch (error) {
      console.error('❌ Complete analysis failed:', error.message);
      throw new Error(`Complete analysis failed: ${error.message}`);
    }
  }

  // GET ANALYSIS RESULTS
  async getResults(baseUrl) {
    const pages = await this.getPages(baseUrl);
    return pages.map(page => ({
      url: page.url,
      claims: page.claims,
      processed: page.processed,
      has_content: !!(page.jinaContent || page.summary)
    }));
  }

  // DEBUG METHOD - Check what's actually in the database
  async debugDatabase(baseUrl) {
    await this.connect();
    
    const domain = this.extractDomain(baseUrl);
    const docs = await this.collection.find({
      url: { $regex: this.escapeRegex(domain), $options: 'i' }
    }).toArray();
    
    console.log(`\n🔍 DEBUG: Found ${docs.length} documents for domain: ${domain}`);
    
    docs.forEach((doc, index) => {
      console.log(`\n📄 Document ${index + 1}: ${doc.url}`);
      console.log(`  Status: ${doc.status}`);
      console.log(`  Has jinaContent: ${!!doc.jinaContent}`);
      console.log(`  Has page_summary: ${!!doc.ai?.page_summary}`);
      console.log(`  FAQ needed: ${doc.ai?.classification?.faq_needed}`);
      console.log(`  Claims extracted: ${!!doc.ai?.key_claims_analysis}`);
      console.log(`  Claims count: ${doc.ai?.key_claims_analysis?.key_claims?.length || 0}`);
      console.log(`  FAQ generated: ${!!doc.ai?.faq_schema}`);
      console.log(`  Claims evaluated: ${!!doc.ai?.claims_evaluation}`);
      
      if (doc.ai?.claims_evaluation) {
        console.log(`  Evaluation data structure:`, {
          claims_evaluation: !!doc.ai.claims_evaluation.claims_evaluation,
          claims_count: doc.ai.claims_evaluation.claims_evaluation?.length || 0,
          overall_analysis: !!doc.ai.claims_evaluation.overall_analysis
        });
      }
    });
    
    return docs;
  }
}

export default RISKCLAIMSAnalyzer;
export { RISKCLAIMSAnalyzer };