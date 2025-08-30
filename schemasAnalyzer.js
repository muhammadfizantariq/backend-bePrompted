// geo-analyzer.js - Modular GEO Analysis

import OpenAI from "openai"; // Change 1: Import OpenAI
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { jsonrepair } from "jsonrepair";

dotenv.config();

export class GeoAnalyzer {
  constructor(options = {}) {
    this.config = {
      mongoUri: options.mongoUri || process.env.MONGODB_URI,
      mongoOptions: options.mongoOptions || {},
      // Change 2: Use OpenAI API key
      openaiApiKey: options.openaiApiKey || process.env.OPENAI_API_KEY,
      dbName: options.dbName || 'webdata',
      collectionName: options.collectionName || 'extractions_3',
      baseSleepMs: options.baseSleepMs || 1000,
      maxRetries: options.maxRetries || 3,
      // Renamed for generic use
      apiRateLimit: options.apiRateLimit || 40, // OpenAI free tier is higher, but this is a safe default
      apiWindowMs: options.apiWindowMs || 1 * 1000
    };

    // Change 3: Check for OpenAI key
    if (!this.config.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is required');
    }

    // Change 4: Initialize OpenAI client
    this.openai = new OpenAI({
      apiKey: this.config.openaiApiKey,
    });

    this.client = new MongoClient(this.config.mongoUri, this.config.mongoOptions);
    this.collection = null;
    this.isConnected = false;

    // Rate limiting
    this.apiCallTimestamps = [];
  }

  // --- MongoDB Connection Management ---
  async connectToMongo() {
    if (this.isConnected) return;

    try {
      await this.client.connect();
      const db = this.client.db(this.config.dbName);
      this.collection = db.collection(this.config.collectionName);
      this.isConnected = true;
      console.log('✅ Connected to MongoDB for GEO analysis\n');
    } catch (err) {
      console.error('❌ MongoDB connection error:', err.message);
      throw err;
    }
  }

  async closeMongo() {
    if (!this.isConnected) return;

    await this.client.close();
    this.isConnected = false;
    console.log('✅ MongoDB connection closed');
  }

  // --- Rate Limiting (Renamed for generic use) ---
  async enforceApiRateLimit() {
    const now = Date.now();
    this.apiCallTimestamps = this.apiCallTimestamps.filter(
      ts => now - ts < this.config.apiWindowMs
    );

    if (this.apiCallTimestamps.length >= this.config.apiRateLimit) {
      const waitMs = this.config.apiWindowMs - (now - this.apiCallTimestamps[0]) + 100;
      console.log(`⏳ API rate limit hit. Waiting ${Math.ceil(waitMs / 1000)}s...`);
      await new Promise(res => setTimeout(res, waitMs));
      return this.enforceApiRateLimit();
    }
    this.apiCallTimestamps.push(now);
  }

  // --- Prompt Builders (No changes needed here) ---
  buildMetaTagsPrompt(pageContent, existingMetaTags, pageUrl) {
    return ` 
  You are a Generative Engine Optimization (GEO) expert. Your job is to analyze web content and advise whether meta tags are needed to improve the page's visibility in generative AI search tools like ChatGPT or Perplexity.

You are given:

1. The textual content of a webpage.
2. Any existing meta tags (if available).

---

🔍 TASK 1: Determine if this page needs meta tags (title, description, open graph tags) for improved LLM visibility.

Use these guidelines:

- Pages like blogs, product listings, landing pages, or service descriptions should have meta tags.
- Pages that are utility-focused (dashboards, login forms) do not require extensive meta tags.
- Meta tags help LLMs quickly summarize and index content accurately.

---

✍️ TASK 2: If meta tags are needed, check if the existing ones are:

- Present or missing
- Clear and descriptive vs. vague or generic
- Semantically aligned with the actual page content
- Short enough for snippet display (description: ~150 chars)

---

🛠️ TASK 3: If the existing meta tags are needed or inadequate, generate new, optimized meta tags using this structure:

<title>...</title>
<meta name="description" content="...">
<meta property="og:title" content="...">
<meta property="og:description" content="...">

- Keep it short (title ≤ 60 chars, description ≤ 150 chars)
- Be informative, use keywords naturally, no stuffing
- Use a tone appropriate to the domain (professional, friendly, etc.)

---

📄 TASK 4: Provide a concise 2-3 sentence summary of what this page is about (for AI indexing) and to give an idea to the LLM later on how important is the page.

---

Text content:
"""
${pageContent}
"""

Existing meta tags:
"""
${existingMetaTags || "<none>"}
"""

---

✅ OUTPUT FORMAT (JSON only — no markdown, no comments):

{
  "needs_optimization": true,
  "page_summary": "A short summary of the page's purpose and main message.",
  "existing_issues": ["missing og:description"],
  "optimized_tags": {
    "title": "Your Optimized Page Title",
    "description": "A short, compelling summary for AI visibility.",
    "og_title": "Your Optimized Page Title",
    "og_description": "A strong description aligned with page content."
  }
}`;
  }

  buildStructuredDataPrompt(pageContent, existingJsonLd, pageUrl) {
    return `
You are a Generative Engine Optimization (GEO) expert. Your task is to review and optimize structured data (JSON-LD) on a webpage to improve its visibility and semantic understanding by AI search tools like ChatGPT, Perplexity, and Google's Knowledge Graph.

You are given:

1. The **textual content** of a webpage.
2. The page's **existing JSON-LD structured data** (if any).
3. The **URL** of the page.

---

🔍 TASK 1: Assess if the page needs structured data at all.

Use these rules:
- Pages like blog posts, products, services, events, organizations, recipes, FAQs, job listings etc. **should** have schema.org structured data.
- Utility pages (dashboards, login, profile settings) **do not** need it.
- Structured data helps LLMs and AI crawlers interpret the page semantically.

---

✍️ TASK 2: If structured data is needed, analyze the existing one for:

- **Presence or absence**
- **Correct schema type** (e.g. Article, Product, Organization)
- **Required fields present** (name, description, etc.)
- **Accuracy and alignment** with page content
- **Avoiding spammy or promotional fields**

---

🛠️ TASK 3: If structured data is needed and current one is missing or incorrect, generate an **optimized structured data object** using schema.org standards.

- Use the appropriate \`@type\` (e.g. \`Article\`, \`Organization\`, \`Service\`, etc.)
- Include key fields: \`name\`, \`description\`, \`url\`, etc.
- Align tone and data with the actual page content
- Do **not** hallucinate company names, phone numbers, or prices — only use what can be inferred from content

---

Text content:
"""
${pageContent}
"""

Existing JSON-LD (if any):
"""
${existingJsonLd || "<none>"}
"""

URL:
${pageUrl}

---

✅ OUTPUT FORMAT (JSON only — no markdown, no comments):

{
  "needs_optimization": true,
  "existing_issues": ["missing required 'description' field", "wrong type: used WebPage instead of Service"],
  "optimized_schema": {
    "@context": "https://schema.org",
    "@type": "Service",
    "name": "Example Service Title",
    "description": "A short description aligned with page content.",
    "url": "${pageUrl}"
  }
}
`;
  }

  // --- Change 5: Rewrote API Call for OpenAI ---
  async callApiWithRetries(promptText, retries = null) {
    const maxRetries = retries || this.config.maxRetries;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.enforceApiRateLimit();

        const completion = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant designed to output JSON. You will analyze the user\'s text and provide structured data based on their request. Do not include any markdown formatting like ```json in your response.',
            },
            {
              role: 'user',
              content: promptText,
            },
          ],
          temperature: 0.0,
          top_p: 0.1,
          seed: 42,
        });

        const text = completion.choices[0].message.content;

        // JSON parsing/repair logic remains the same
        let parsedResult;
        try {
          parsedResult = JSON.parse(text);
        } catch (err) {
          try {
            const repairedJson = jsonrepair(text);
            parsedResult = JSON.parse(repairedJson);
            console.warn("⚠️ JSON was repaired before parsing.");
          } catch (repairErr) {
            throw new Error("❌ JSON parsing and repair both failed.");
          }
        }
        console.debug(`✅ Parsed result on attempt ${attempt}`);
        return parsedResult;
      } catch (err) {
        console.warn(`⚠️ Attempt ${attempt} failed:`, err.message);
        if (attempt < maxRetries) {
          await new Promise((res) => setTimeout(res, this.config.baseSleepMs));
        } else {
          throw new Error("❌ All retry attempts failed.");
        }
      }
    }
  }

  // --- Data Retrieval Methods (No changes needed) ---
  async getEligiblePages(baseUrl) {
    const urlPrefix = baseUrl.replace(/\/$/, "");
    const urlRegex = new RegExp(`^${urlPrefix}(/.*)?$`, "i");

    return await this.collection.find({
      url: { $regex: urlRegex },
      status: "done",
      jinaContent: { $not: /Title: Page Not Found/ }
    }).toArray();
  }

  async updatePageAnalysis(url, analysisType, data) {
    const updateData = {
      [`ai.${analysisType}`]: data,
      "ai.last_analyzed": new Date()
    };

    return await this.collection.updateOne(
      { url, status: "done" },
      { $set: updateData }
    );
  }

  // --- Core Analysis Methods ---
  async analyzeMetaTags(baseUrl, options = {}) {
    console.debug(`🔍 Starting meta tags analysis for: ${baseUrl}`);

    const eligiblePages = await this.getEligiblePages(baseUrl);
    console.debug(`📄 Found ${eligiblePages.length} pages with status "done"`);

    const results = [];

    for (let i = 0; i < eligiblePages.length; i++) {
      const { url, jinaContent, metaTags } = eligiblePages[i];
      console.debug(`\n--- [${i + 1}/${eligiblePages.length}] Analyzing meta tags: ${url}`);

      const promptText = this.buildMetaTagsPrompt(
        jinaContent || "",
        JSON.stringify(metaTags || {}),
        url
      );

      try {
        // Change 6: Use the new API call method
        const analysisResult = await this.callApiWithRetries(promptText);

        if (options.verbose) {
          console.log(JSON.stringify({ url, meta_analysis: analysisResult }, null, 2));
        }

        const { page_summary, ...analysisWithoutSummary } = analysisResult;

        await this.updatePageAnalysis(url, "meta_tags", {
          analysis: analysisWithoutSummary,
          generated_tags: analysisResult.optimized_tags,
          analyzed_at: new Date()
        });

        await this.collection.updateOne(
          { url, status: "done" },
          { $set: { "ai.page_summary": page_summary } }
        );

        results.push({
          url,
          success: true,
          analysis: analysisResult
        });

      } catch (err) {
        console.error(`❌ Failed to process meta tags for ${url}: ${err.message}`);
        results.push({
          url,
          success: false,
          error: err.message
        });
      }

      if (i < eligiblePages.length - 1) {
        await new Promise((res) => setTimeout(res, this.config.baseSleepMs));
      }
    }

    return {
      total: eligiblePages.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
  }

  async analyzeStructuredData(baseUrl, options = {}) {
    console.debug(`🔍 Starting structured data analysis for: ${baseUrl}`);

    const eligiblePages = await this.getEligiblePages(baseUrl);
    console.debug(`📄 Found ${eligiblePages.length} pages with status "done"`);

    const results = [];

    for (let i = 0; i < eligiblePages.length; i++) {
      const { url, jinaContent, jsonLd } = eligiblePages[i];
      console.debug(`\n--- [${i + 1}/${eligiblePages.length}] Analyzing structured data: ${url}`);

      const promptText = this.buildStructuredDataPrompt(
        jinaContent || "",
        JSON.stringify(jsonLd || {}),
        url
      );

      try {
        // Change 7: Use the new API call method
        const analysisResult = await this.callApiWithRetries(promptText);

        if (options.verbose) {
          console.log(JSON.stringify({ url, structured_data_analysis: analysisResult }, null, 2));
        }

        await this.updatePageAnalysis(url, "structured_data", {
          analysis: analysisResult,
          generated_schema: analysisResult.optimized_schema,
          analyzed_at: new Date()
        });

        results.push({
          url,
          success: true,
          analysis: analysisResult
        });

      } catch (err) {
        console.error(`❌ Failed to process structured data for ${url}: ${err.message}`);
        results.push({
          url,
          success: false,
          error: err.message
        });
      }

      if (i < eligiblePages.length - 1) {
        await new Promise((res) => setTimeout(res, this.config.baseSleepMs));
      }
    }

    return {
      total: eligiblePages.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
  }

  // --- No changes needed below this line ---
  async runFullGeoAnalysis(baseUrl, options = {}) {
    console.log(`🚀 Starting complete GEO analysis for: ${baseUrl}`);

    try {
      await this.connectToMongo();

      console.log("📋 Analyzing meta tags...");
      const metaResults = await this.analyzeMetaTags(baseUrl, options);

      console.log(`✅ Meta tags analysis completed: ${metaResults.successful}/${metaResults.total} successful`);

      console.log("📊 Analyzing structured data...");
      const structuredResults = await this.analyzeStructuredData(baseUrl, options);

      console.log(`✅ Structured data analysis completed: ${structuredResults.successful}/${structuredResults.total} successful`);

      const summary = {
        baseUrl,
        completedAt: new Date(),
        metaTags: {
          total: metaResults.total,
          successful: metaResults.successful,
          failed: metaResults.failed
        },
        structuredData: {
          total: structuredResults.total,
          successful: structuredResults.successful,
          failed: structuredResults.failed
        },
        overallSuccess: (metaResults.successful + structuredResults.successful) > 0
      };

      console.log("✅ Complete GEO analysis finished!");
      console.log(`📊 Summary: ${summary.metaTags.successful + summary.structuredData.successful} total successful analyses`);

      return summary;

    } catch (error) {
      console.error('❌ GEO analysis failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async getAnalysisResults(baseUrl, analysisType = null) {
    const urlPrefix = baseUrl.replace(/\/$/, "");
    const urlRegex = new RegExp(`^${urlPrefix}(/.*)?$`, "i");

    const filter = {
      url: { $regex: urlRegex },
      status: "done"
    };

    if (analysisType) {
      filter[`ai.${analysisType}`] = { $exists: true };
    } else {
      filter["ai"] = { $exists: true };
    }

    return await this.collection.find(filter).toArray();
  }

  async getPageSummaries(baseUrl) {
    const urlPrefix = baseUrl.replace(/\/$/, "");
    const urlRegex = new RegExp(`^${urlPrefix}(/.*)?$`, "i");

    return await this.collection.find(
      {
        url: { $regex: urlRegex },
        status: "done",
        "ai.page_summary": { $exists: true }
      },
      {
        projection: { url: 1, "ai.page_summary": 1 }
      }
    ).toArray();
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default GeoAnalyzer;

export async function analyzeWebsiteGeo(baseUrl, options = {}) {
  const analyzer = new GeoAnalyzer(options);
  try {
    const result = await analyzer.runFullGeoAnalysis(baseUrl, options);
    return result;
  } finally {
    await analyzer.closeMongo();
  }
}