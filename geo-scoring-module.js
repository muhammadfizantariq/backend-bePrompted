import { MongoClient } from 'mongodb';
import OpenAI from 'openai'; // Change 1: Import OpenAI
import { z } from 'zod';

// ===== ZOD SCHEMAS (No changes) =====
const ComponentScoreSchema = z.object({
  score: z.number().min(0).max(1).default(0.5),
  reasoning: z.string().default("No reasoning provided")
});

const ComponentScoresSchema = z.object({
  semantic_clarity: ComponentScoreSchema.optional().default({ score: 0.5, reasoning: "Not analyzed" }),
  contextual_relevance: ComponentScoreSchema.optional().default({ score: 0.5, reasoning: "Not analyzed" }),
  structural_optimization: ComponentScoreSchema.optional().default({ score: 0.5, reasoning: "Not analyzed" }),
  ai_query_alignment: ComponentScoreSchema.optional().default({ score: 0.5, reasoning: "Not analyzed" }),
  citation_potential: ComponentScoreSchema.optional().default({ score: 0.5, reasoning: "Not analyzed" })
});

const ScoreResponseSchema = z.object({
  ai_score: z.number().min(0).max(1).default(0.5),
  component_scores: ComponentScoresSchema.default({}),
  reasoning: z.string().default("No reasoning provided")
});

const ImportanceItemSchema = z.object({
  importance_score: z.number().int().min(1).max(5),
  reasoning: z.string()
});

const ImportanceRankingsSchema = z.object({
  rankings: z.array(ImportanceItemSchema)
});

const ClassificationItemSchema = z.object({
  url: z.string(),
  page_type: z.enum(['blog', 'service', 'product', 'legal', 'about', 'contact', 'faq', 'core', 'other']),
  faq_needed: z.boolean(),
  reason: z.string()
});

const ClassificationResponseSchema = z.array(ClassificationItemSchema);

// ===== UTILS (No changes) =====
function normalizeUrl(url) {
  return url.trim().replace(/\/+$|\/+(?=\?|#)/g, '').toLowerCase();
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return url;
  }
}

// ===== PROMPT GENERATION (No changes as per your request) =====
function buildAIScorePrompt(type, url, originalContent, generatedContent, pageSummary) {
  // If no original content exists, return very low score
  if (!originalContent || 
      (Array.isArray(originalContent) && originalContent.length === 0) ||
      (typeof originalContent === 'object' && Object.keys(originalContent).length === 0)) {
    
    return `You are a Generative Engine Optimization (GEO) expert evaluating ${type} for AI search engines.

🔗 URL: ${url}

❌ CRITICAL ISSUE: No ${type} content exists on this webpage.

This severely hurts discoverability in AI search results like ChatGPT, Claude, Perplexity, and other LLM-powered search engines.

Missing ${type} means:
- Poor semantic understanding by AI systems
- Reduced chances of being cited in AI responses  
- Lower visibility in generative search results
- Missed opportunities for AI discovery

Score: 0.1 - Missing essential ${type} content for GEO optimization.

Respond with JSON:
{
  "ai_score": 0.1,
  "reasoning": "No ${type} content found on the webpage. This is critical for GEO optimization as AI search engines rely on structured ${type} data to understand and index content properly."
}`;
  }
  
  return `
You are a Generative Engine Optimization (GEO) expert specializing in optimizing content for Large Language Models like ChatGPT, Claude, Perplexity, and other AI search engines.

🎯 TASK: Evaluate the ORIGINAL ${type} content for GEO effectiveness using precise scoring criteria.

🔗 URL: ${url}

📋 ORIGINAL ${type} content (what you're scoring):
"""
${JSON.stringify(originalContent, null, 2)}
"""

${generatedContent ? `
🤖 AI-optimized ${type} reference (benchmark for comparison):
"""
${JSON.stringify(generatedContent, null, 2)}
"""
` : ''}

💡 Page Context & Summary:
"""
${pageSummary}
"""

🔍 DETAILED GEO SCORING MATRIX:

**SEMANTIC CLARITY (0.0-1.0)**
- 0.9-1.0: Natural language, specific terminology, clear intent, no jargon
- 0.7-0.8: Mostly clear with minor ambiguities
- 0.5-0.6: Some unclear phrases, moderate jargon usage
- 0.3-0.4: Vague language, heavy jargon, unclear intent
- 0.0-0.2: Confusing, overly complex, or meaningless content

**CONTEXTUAL RELEVANCE (0.0-1.0)**
- 0.9-1.0: Perfect alignment with page content and user intent
- 0.7-0.8: Good match with minor disconnects
- 0.5-0.6: Partially relevant, some misalignment
- 0.3-0.4: Weak connection to actual content
- 0.0-0.2: Irrelevant or misleading representation

**STRUCTURAL OPTIMIZATION (0.0-1.0)**
- 0.9-1.0: Optimal length (${type === 'title' ? '50-60 chars' : type === 'description' ? '150-160 chars' : 'appropriate length'}), proper formatting, keyword placement
- 0.7-0.8: Good structure with minor issues
- 0.5-0.6: Acceptable structure, some optimization missed
- 0.3-0.4: Poor structure, length issues, bad formatting
- 0.0-0.2: Terrible structure, wrong length, no optimization

**AI QUERY ALIGNMENT (0.0-1.0)**
- 0.9-1.0: Answers multiple user questions, includes natural question patterns
- 0.7-0.8: Addresses main user queries well
- 0.5-0.6: Partially answers common questions
- 0.3-0.4: Limited query coverage
- 0.0-0.2: Doesn't address user questions

**CITATION POTENTIAL (0.0-1.0)**
- 0.9-1.0: Factual, authoritative tone, includes specific details/numbers
- 0.7-0.8: Good citation potential with minor issues
- 0.5-0.6: Some citable elements present
- 0.3-0.4: Limited citation value
- 0.0-0.2: Not suitable for AI citation


**SEMANTIC CLARITY PENALTIES:**
- Generic/template language: -0.1 to -0.3
- Excessive jargon or technical terms: -0.1 to -0.2
- Unclear messaging: -0.2 to -0.4
- Confusing wording: -0.1 to -0.3

**CONTEXTUAL RELEVANCE PENALTIES:**
- Misaligned with page content: -0.2 to -0.5
- Misleading information: -0.3 to -0.6
- Off-topic content: -0.1 to -0.3

**STRUCTURAL OPTIMIZATION PENALTIES:**
- Wrong length (too short/long): -0.1 to -0.4
- Poor formatting: -0.1 to -0.2
- Missing required elements: -0.2 to -0.3
- Bad keyword placement: -0.1 to -0.2

**AI QUERY ALIGNMENT PENALTIES:**
- Doesn't answer user questions: -0.2 to -0.4
- Missing question patterns: -0.1 to -0.3
- Poor query coverage: -0.1 to -0.2

**CITATION POTENTIAL PENALTIES:**
- Lacks authority signals: -0.1 to -0.2
- No specific details/numbers: -0.1 to -0.3
- Poor factual presentation: -0.2 to -0.4
- Keyword stuffing: -0.2 to -0.4

**CONTENT TYPE SPECIFIC REQUIREMENTS:**

For TITLES:
- Must include primary keyword naturally
- Should indicate clear value proposition
- Avoid clickbait or vague language
- Length optimization critical

For DESCRIPTIONS:
- Must summarize page value clearly
- Should include secondary keywords
- Must have clear call-to-action intent
- Should answer "what will I find here?"

For OTHER CONTENT:
- Must match content type best practices
- Should be contextually appropriate
- Must serve user and AI understanding

🎯 SCORING METHODOLOGY:
1. Score each criterion individually (0.0-1.0)
2. Calculate weighted average: 
   - Semantic Clarity: 25%
   - Contextual Relevance: 25%
   - Structural Optimization: 20%
   - AI Query Alignment: 20%
   - Citation Potential: 10%
3. Final score = weighted average of the component scores

📊 INTERPRETATION GUIDE:
- 0.85-1.0: Exceptional GEO - Industry-leading optimization
- 0.70-0.84: Strong GEO - Well-optimized with minor gaps
- 0.55-0.69: Moderate GEO - Decent foundation, needs improvement
- 0.40-0.54: Weak GEO - Significant issues, major optimization needed
- 0.25-0.39: Poor GEO - Fundamental problems, complete rework required
- 0.0-0.24: Critical GEO - Completely inadequate, harmful to discoverability

🎯 ANALYSIS REQUIREMENTS:
- Identify specific strengths and weaknesses
- Provide concrete examples from the content
- Compare against type-specific best practices
- Suggest 2-3 priority improvements
- Justify the numerical score with evidence

🎯 RESPONSE REQUIREMENTS:
- You MUST include all fields in the JSON response
- component_scores must be an object with 5 components, each having score and reasoning
- All scores must be numbers between 0.0 and 1.0

Respond with this EXACT JSON structure:
{
  "ai_score": 0.75,
  "component_scores": {
    "semantic_clarity": {
      "score": 0.80,
      "reasoning": "Your detailed analysis of semantic clarity here"
    },
    "contextual_relevance": {
      "score": 0.85,
      "reasoning": "Your detailed analysis of contextual relevance here"
    },
    "structural_optimization": {
      "score": 0.70,
      "reasoning": "Your detailed analysis of structural optimization here"
    },
    "ai_query_alignment": {
      "score": 0.65,
      "reasoning": "Your detailed analysis of AI query alignment here"
    },
    "citation_potential": {
      "score": 0.75,
      "reasoning": "Your detailed analysis of citation potential here"
    }
  }
 
}

CRITICAL: Do not deviate from this JSON structure. All fields are required.`

}

function buildImportancePrompt(baseUrl, pageData) {
  const domain = extractDomain(baseUrl);
  
  return `You are a Generative Engine Optimization (GEO) expert helping to rank webpages based on their semantic importance for large language models like ChatGPT, Claude, or Perplexity.

🌐 WEBSITE CONTEXT:
Base URL: ${baseUrl}
Domain: ${domain}

📋 YOUR TASK:
Analyze each page's URL structure and content summary to determine how important it is for LLMs to understand and potentially cite.

Rate each page from 1–5 based on:

**IMPORTANCE SCALE:**
1 = **Irrelevant** (login pages, dashboards, utility pages, error pages, admin interfaces)
2 = **Support/Secondary** (contact forms, basic info pages, terms of service, privacy policies)
3 = **Supplementary** (blog posts, FAQs, secondary services, case studies, news articles)
4 = **Important** (key services, main product pages, valuable resources, important category pages)
5 = **Core/High-Visibility** (homepage, primary services, cornerstone content, main value propositions)

**EVALUATION CRITERIA:**
- URL structure and path hierarchy (homepage vs deep pages)
- Content semantic value for understanding the business/organization
- Likelihood an AI would reference this page in responses
- Strategic importance based on URL patterns (e.g., /about, /services vs /admin, /login)
- Content richness and comprehensiveness from the summary

🔍 **PAGE ANALYSIS:**
${pageData}

⚠️ **RESPONSE FORMAT:** Respond ONLY with valid JSON:

{
  "rankings": [
    {
      "importance_score": 1-5,
      "reasoning": "Brief explanation considering both URL structure and content summary for AI discoverability"
    },
    ...
  ]
}

**IMPORTANT:** 
- Consider URL paths as strong indicators (e.g., homepage = high importance, /contact = medium, /admin = low)
- Balance URL structure with content summary richness
- Focus on value for AI systems trying to understand and reference this website
- Order must match the input page sequence exactly`;
}


function buildClassificationPrompt(pageList) {
  return `You are an expert content strategist specializing in page classification and FAQ optimization for AI search engines (ChatGPT, Claude, Perplexity).

🎯 TASK: Classify each page and determine if FAQ generation would improve AI discoverability.

📋 PAGES TO CLASSIFY:
${pageList}

🏷️ PAGE TYPE CLASSIFICATIONS:

**core** - 
  The main homepage, primary 'solutions' or 'platform' overview pages, or top-level pages that introduce the entire scope of the organization's offerings.
**blog** - Articles, posts, news, updates, thought leadership content.
**service** - Pages detailing specific, tangible services or actions the company performs for clients (e.g., 'Revenue Cycle Management Services', 'Implementation & Training', 'Consulting').
**product** - Pages focused on a specific, named software application, feature, or module (e.g., 'CureMD EHR', 'Avalon for iPad', 'Patient Portal'). Also includes pricing pages.
**legal** - Terms of service, privacy policies, legal documents, compliance pages.
**about** - Company info, team pages, history, mission, values, careers.
**contact** - Contact forms, location info, support pages, get-in-touch pages.
**faq** - Existing FAQ pages, help sections, knowledge bases.
**other** - Everything else (utility pages, dashboards, admin, error pages).


🤔 FAQ GENERATION RULES:

**FAQ NEEDED = TRUE when:**
- Service pages that could benefit from "How does X work?" questions
- Product pages where users typically ask comparison/feature questions
- Complex topics that need clarification for AI understanding
- Pages with technical content that users might not understand
- High-value pages that could drive more AI citations with structured Q&A

**FAQ NEEDED = FALSE when:**
- Simple contact/location pages
- Legal documents (already structured)
- Existing FAQ pages
- Blog posts (already in Q&A-friendly format)
- Utility pages with no user questions
- About pages with straightforward information

🎯 ANALYSIS STRATEGY:
1. Examine URL structure for type hints (/services/, /products/, /about/, etc.)
2. Read summary for content indicators
3. Consider user intent - what questions would they ask about this page?
4. Evaluate AI citation potential - would FAQs help LLMs reference this better?

⚠️ CRITICAL REQUIREMENTS:
- MUST respond with a JSON ARRAY only
- NO text before or after the JSON array
- NO markdown formatting or code blocks
- Each array item MUST have exactly these 4 fields: url, page_type, faq_needed, reason
- faq_needed must be boolean true or false (not string)
- page_type must be one of the 8 exact values listed above

RESPOND WITH THIS EXACT FORMAT (replace with actual data):
[
  {
    "url": "https://example.com/page1",
    "page_type": "service",
    "faq_needed": true,
    "reason": "Service page with complex offerings that would benefit from FAQ structure"
  },
  {
    "url": "https://example.com/page2", 
    "page_type": "blog",
    "faq_needed": false,
    "reason": "Blog article already in readable format for AI consumption"
  }
]`;
}

// ===== LLM CALLS (Updated for OpenAI) =====
async function rateContentWithOpenAI(openai, prompt) { // Changed function name and signature
  let retries = 3;
  let lastError;

  while (retries--) {
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful assistant designed to output JSON.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.0,
        top_p: 0.1,
        seed: 42,
      });

      const content = completion.choices[0].message.content;
      const parsed = JSON.parse(content);
      const validated = ScoreResponseSchema.parse(parsed);
      return validated;
    } catch (e) {
      lastError = e;
      console.log(`🔁 Retry ${4 - retries}/3 due to error: ${e.message}`);
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  console.error(`❌ All retries failed for scoring. Last error: ${lastError.message}`);
  return { ai_score: 0.1, component_scores: {}, reasoning: "Scoring failed - API unavailable" };
}

async function getImportanceRankings(openai, prompt) { // Changed signature
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant designed to output JSON.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.0,
      top_p: 0.1,
      seed: 42,
    });

    const content = completion.choices[0].message.content;
    const raw = JSON.parse(content);

    const cleaned = {
      rankings: (raw.rankings || []).map((r, i) => ({
        importance_score: r.importance_score ?? 3,
        reasoning: r.reasoning ?? `No reasoning provided for item #${i + 1}`
      }))
    };

    const validated = ImportanceRankingsSchema.parse(cleaned);
    return validated.rankings;
  } catch (e) {
    throw new Error(`❌ Failed parsing importance rankings: ${JSON.stringify(e.errors || e, null, 2)}`);
  }
}

async function getPageClassifications(openai, prompt) { // Changed signature
  let retries = 3;
  let content; 

  while (retries--) {
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful assistant designed to output a JSON object containing a key with a JSON array.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.0,
        top_p: 0.1,
        seed: 42,
      });

      content = completion.choices[0].message.content;
      console.log(`🔍 Raw classification response: ${content.substring(0, 200)}...`);

      const raw = JSON.parse(content);
      let classifications = [];

      // This part is correct - it finds the array in the response
      if (Array.isArray(raw)) {
        classifications = raw;
      } else if (raw.classifications && Array.isArray(raw.classifications)) {
        classifications = raw.classifications;
      } else if (raw.pages && Array.isArray(raw.pages)) {
        classifications = raw.pages;
      } else if (Array.isArray(Object.values(raw)[0])) {
        classifications = Object.values(raw)[0];
      }

      if (!Array.isArray(classifications) || classifications.length === 0) {
        throw new Error('No valid classifications array found in response');
      }

      // --- START: THIS IS THE CORRECTED LOGIC ---
      // It was previously using the wrong cleaning logic for "rankings"
      const cleanedClassifications = classifications.map((item, i) => {
        const cleanedItem = {
          url: (item.url || '').toString().trim(),
          page_type: item.page_type || 'other',
          faq_needed: Boolean(item.faq_needed),
          reason: (item.reason || `Default classification for item #${i + 1}`).toString().trim()
        };
        
        // Ensure page_type is a valid enum value
        const validTypes = ['blog', 'service', 'product', 'legal', 'about', 'contact', 'faq', 'core', 'other'];
        if (!validTypes.includes(cleanedItem.page_type)) {
          cleanedItem.page_type = 'other';
          cleanedItem.reason = `Invalid page type corrected to 'other'. ${cleanedItem.reason}`;
        }
        
        return cleanedItem;
      });
      // --- END: THIS IS THE CORRECTED LOGIC ---

      // Now we parse the CORRECT variable
      const validated = ClassificationResponseSchema.parse(cleanedClassifications);
      return validated;

    } catch (e) {
      console.log(`🔁 Classification retry ${4 - retries}/3 due to error: ${e.message}`);
      if (retries === 0) {
        console.error('❌ Full classification error:', e);
        console.error('❌ Raw response that caused error:', content || 'No content received');
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Fallback logic remains the same
  console.log('⚠️ All retries failed, using fallback...');
  // ... your fallback logic
  throw new Error("Failed to get valid page classifications after retries and fallbacks.");
}


// ===== MAIN SCORING FUNCTION (Updated for OpenAI) =====
export async function scoreAllDocsWithAI(config) {
  const {
    mongoUri,
    mongoOptions = {},
    dbName,
    collectionName,
    openaiApiKey // Change 2: Expect openaiApiKey
  } = config;

  // Change 3: Initialize OpenAI client
  const openai = new OpenAI({ apiKey: openaiApiKey });

  let client;
  let collection;

  try {
    client = new MongoClient(mongoUri, mongoOptions);
    await client.connect();
    collection = client.db(dbName).collection(collectionName);
    console.log('✅ Connected to MongoDB');

    // Document fetching and processing logic remains the same
    const docs = await collection
      .find({
        'metaTags': { $exists: true },
        $or: [
          { 'ai.page_summary': { $exists: true, $ne: null, $not: /Title: Page Not Found/ } },
          { 'ai.meta_tags.analysis.page_summary': { $exists: true, $ne: null, $not: /Title: Page Not Found/ } }
        ],
        'jsonLd': { $exists: true },
        status: 'done'
      })
      .project({ 
        url: 1, 
        metaTags: 1, 
        jsonLd: 1, 
        'ai.page_summary': 1,
        'ai.meta_tags.analysis.page_summary': 1,
        'ai.meta_tags.generated_tags': 1,
        'ai.structured_data.generated_schema': 1,
        _id: 0 
      })
      .toArray();

    const validDocs = docs.map(d => ({
      url: d.url.trim(),
      metaTags: d.metaTags,
      jsonLd: d.jsonLd,
      pageSummary: (d.ai?.page_summary?.trim() || d.ai?.meta_tags?.analysis?.page_summary?.trim() || ''),
      generatedMetaTags: d.ai?.meta_tags?.generated_tags || null,
      generatedSchema: d.ai?.structured_data?.generated_schema || null
    }));

    console.log(`🔍 Evaluating ${validDocs.length} pages for GEO scoring...`);

    if (validDocs.length === 0) {
      console.log('❌ No valid documents found.');
      return { success: false, message: 'No valid documents found' };
    }

    const baseUrl = validDocs.length > 0 ? validDocs[0].url : 'https://example.com';
    const pageDataBlocks = validDocs.map((d, i) => {
      return `**Page ${i + 1}:**
🔗 URL: ${d.url}
📝 Summary: ${d.pageSummary}`;
    }).join('\n\n');

    console.log('🎯 Getting importance rankings...');
    const importancePrompt = buildImportancePrompt(baseUrl, pageDataBlocks);
    // Change 4: Pass the openai client
    const importanceRankings = await getImportanceRankings(openai, importancePrompt);
    console.log(`✅ Importance rankings obtained: ${importanceRankings.length} rankings for ${validDocs.length} pages`);

    // FIX: Ensure importanceRankings has same length as validDocs
    while (importanceRankings.length < validDocs.length) {
      importanceRankings.push({
        importance_score: 3,
        reasoning: `Default importance score for missing ranking (item #${importanceRankings.length + 1})`
      });
      console.log(`⚠️ Added default ranking for missing item #${importanceRankings.length}`);
    }

    console.log('🏷️ Getting page classifications...');
    const classificationPrompt = buildClassificationPrompt(pageDataBlocks);
    let pageClassifications;
    try {
      // Change 5: Pass the openai client
      pageClassifications = await getPageClassifications(openai, classificationPrompt);
      console.log(`✅ Page classifications obtained: ${pageClassifications.length} classifications`);
      
      // FIX: Ensure pageClassifications has same length as validDocs
      while (pageClassifications.length < validDocs.length) {
        const missingIndex = pageClassifications.length;
        pageClassifications.push({
          url: validDocs[missingIndex]?.url || 'unknown',
          page_type: 'other',
          faq_needed: false,
          reason: `Default classification for missing item #${missingIndex + 1}`
        });
        console.log(`⚠️ Added default classification for missing item #${pageClassifications.length}`);
      }
    } catch (e) {
      console.error('❌ Failed to get classifications, using defaults:', e.message);
      pageClassifications = validDocs.map((doc, i) => ({
        url: doc.url,
        page_type: 'other',
        faq_needed: false,
        reason: `Default classification due to API failure for item #${i + 1}`
      }));
    }

    await new Promise(r => setTimeout(r, 6000));

    const callTimes = [];
    for (let i = 0; i < validDocs.length; i++) {
      const { url, metaTags, jsonLd, pageSummary, generatedMetaTags, generatedSchema } = validDocs[i];
      const normalizedUrl = normalizeUrl(url);
      
      // FIX: Safe destructuring with fallback values
      const { importance_score, reasoning } = importanceRankings[i] || { 
        importance_score: 3, 
        reasoning: `Default importance score for page #${i + 1}` 
      };
      
      const classification = pageClassifications[i] || {
        url: url,
        page_type: 'other',
        faq_needed: false,
        reason: `Default classification for page #${i + 1}`
      };
      
      console.log(`\n🔎 Processing [${i + 1}/${validDocs.length}]: ${url}`);
      console.log(`📊 Importance: ${importance_score}/5 | Type: ${classification.page_type} | FAQ: ${classification.faq_needed}`);

      try {
        // Rate limiting logic remains the same
        const metaPrompt = buildAIScorePrompt("meta tags", url, metaTags, generatedMetaTags, pageSummary);
        const metaResult = await rateContentWithOpenAI(openai, metaPrompt);

        await new Promise(r => setTimeout(r, 6000));

        // Score structured data
        const structuredDataPrompt = buildAIScorePrompt("structured data", url, jsonLd, generatedSchema, pageSummary);
        const structuredDataResult = await rateContentWithOpenAI(openai, structuredDataPrompt);

        // Calculation and DB update logic remains the same
        const weightedScore = (
          (metaResult.ai_score * 0.4) +
          (structuredDataResult.ai_score * 0.4) +
          ((importance_score / 5) * 0.2) // This will now work correctly
        );

        // Inside the for loop of scoreAllDocsWithAI, replace the updateOne call
        await collection.updateOne(
          { url: { $regex: `^${normalizedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
          {
            $set: {
              'ai.page_summary': pageSummary,
              'ai.scoring': {
                meta_tags: {
                  score: metaResult.ai_score,
                  // --- FIX: Use optional chaining (?.) and nullish coalescing (??) for safety ---
                  component_scores: {
                    semantic_clarity: {
                      score: metaResult.component_scores?.semantic_clarity?.score ?? 0.1,
                      reasoning: metaResult.component_scores?.semantic_clarity?.reasoning ?? "Analysis failed"
                    },
                    contextual_relevance: {
                      score: metaResult.component_scores?.contextual_relevance?.score ?? 0.1,
                      reasoning: metaResult.component_scores?.contextual_relevance?.reasoning ?? "Analysis failed"
                    },
                    structural_optimization: {
                      score: metaResult.component_scores?.structural_optimization?.score ?? 0.1,
                      reasoning: metaResult.component_scores?.structural_optimization?.reasoning ?? "Analysis failed"
                    },
                    ai_query_alignment: {
                      score: metaResult.component_scores?.ai_query_alignment?.score ?? 0.1,
                      reasoning: metaResult.component_scores?.ai_query_alignment?.reasoning ?? "Analysis failed"
                    },
                    citation_potential: {
                      score: metaResult.component_scores?.citation_potential?.score ?? 0.1,
                      reasoning: metaResult.component_scores?.citation_potential?.reasoning ?? "Analysis failed"
                    }
                  },
                  reasoning: metaResult.reasoning,
                  scored_at: new Date()
                },
                structured_data: {
                  score: structuredDataResult.ai_score,
                  // --- FIX: Apply the same safety checks here ---
                  component_scores: {
                    semantic_clarity: {
                      score: structuredDataResult.component_scores?.semantic_clarity?.score ?? 0.1,
                      reasoning: structuredDataResult.component_scores?.semantic_clarity?.reasoning ?? "Analysis failed"
                    },
                    contextual_relevance: {
                      score: structuredDataResult.component_scores?.contextual_relevance?.score ?? 0.1,
                      reasoning: structuredDataResult.component_scores?.contextual_relevance?.reasoning ?? "Analysis failed"
                    },
                    structural_optimization: {
                      score: structuredDataResult.component_scores?.structural_optimization?.score ?? 0.1,
                      reasoning: structuredDataResult.component_scores?.structural_optimization?.reasoning ?? "Analysis failed"
                    },
                    ai_query_alignment: {
                      score: structuredDataResult.component_scores?.ai_query_alignment?.score ?? 0.1,
                      reasoning: structuredDataResult.component_scores?.ai_query_alignment?.reasoning ?? "Analysis failed"
                    },
                    citation_potential: {
                      score: structuredDataResult.component_scores?.citation_potential?.score ?? 0.1,
                      reasoning: structuredDataResult.component_scores?.citation_potential?.reasoning ?? "Analysis failed"
                    }
                  },
                  reasoning: structuredDataResult.reasoning,
                  scored_at: new Date()
                },
                page_importance: {
                  score: importance_score,
                  reasoning: reasoning,
                  scored_at: new Date()
                },
                overall_score: parseFloat(weightedScore.toFixed(3))
              },
              'ai.classification': {
                page_type: classification.page_type,
                faq_needed: classification.faq_needed,
                reasoning: classification.reason,
                classified_at: new Date()
              }
            }
          }
        );

        console.log(`✅ Scores - Meta: ${metaResult.ai_score.toFixed(2)} | Schema: ${structuredDataResult.ai_score.toFixed(2)} | Overall: ${weightedScore.toFixed(3)}`);

      } catch (e) {
        console.error(`❌ Failed processing ${url}:`, e.message);
        continue;
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log('\n🎉 All documents scored successfully!');
  
    // --- START: ADD THESE MISSING LINES ---
    const faqNeededCount = pageClassifications.filter(p => p.faq_needed).length;
    const typeDistribution = pageClassifications.reduce((acc, p) => {
      acc[p.page_type] = (acc[p.page_type] || 0) + 1;
      return acc;
    }, {});

    console.log(`📊 Summary: ${faqNeededCount}/${validDocs.length} pages need FAQ generation`);
    console.log(`🏷️  Page types:`, typeDistribution);
    // --- END: ADD THESE MISSING LINES 
    
    return {
      success: true,
      processedCount: validDocs.length,
      faqNeededCount,
      typeDistribution
    };

  } catch (error) {
    console.error('❌ Error in scoring process:', error);
    throw error;
  } finally {
    if (client) {
      await client.close();
      console.log('🔌 MongoDB connection closed');
    }
  }
}