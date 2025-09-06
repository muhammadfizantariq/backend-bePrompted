// website-analyzer.js - Modular Version

import axios from 'axios';
import https from 'https';
import { MongoClient } from 'mongodb';
import { createRequire } from 'node:module';
// Use puppeteer-core so we rely on the system / injected Chromium (set via env)
import puppeteer from 'puppeteer-core';


import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
const cheerio = require('cheerio');

dotenv.config();

export class WebsiteAnalyzer {
  constructor(options = {}) {
    this.config = {
      mongoUri: options.mongoUri || process.env.MONGODB_URI || 'mongodb://localhost:27017',
      mongoOptions: options.mongoOptions || {},
      dbName: options.dbName || 'webdata',
      collectionName: options.collectionName || 'extractions_3',
      jinaApiKey: options.jinaApiKey || process.env.JINA_API_KEY,

      minDelayMs: options.minDelayMs || 10000,
      maxIterations: options.maxIterations || 10,
      maxQueuedLinks: options.maxQueuedLinks || 5 // <-- Added variable
    };

    this.client = new MongoClient(this.config.mongoUri, this.config.mongoOptions);
    this.collection = null;

    this.isConnected = false;
  }

  // --- MongoDB Connection Management ---
  async connectToMongo() {
    if (this.isConnected) return;
    
    try {
      await this.client.connect();
      const db = this.client.db(this.config.dbName);
      this.collection = db.collection(this.config.collectionName);
      this.isConnected = true;
      console.log('✅ Connected to MongoDB\n');
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

  // --- Content Fetching ---
  async fetchViaJinaAI(url) {
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
            reject(new Error(`Non-200 response: ${res.statusCode}`));
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.end();
    });
  }


// Replace your existing extractFromHTML method with this enhanced version
async extractFromHTML(url) {
  // Method 1: Try Puppeteer first
  try {
    if (process.env.DISABLE_PUPPETEER === 'true') {
      throw new Error('Puppeteer disabled by DISABLE_PUPPETEER env flag');
    }
    console.log('🚀 Attempting HTML extraction with Puppeteer...');

    // Resolve executable path (supports Docker + various deploy targets)
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH ||
                           process.env.CHROME_EXECUTABLE_PATH ||
                           process.env.CHROMIUM_PATH ||
                           '/usr/bin/chromium';

    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--no-first-run',
        '--no-default-browser-check'
      ]
    });
    console.log(`🧭 Using Chromium at: ${executablePath}`);
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    await page.goto(url, { 
      waitUntil: 'networkidle2', 
      timeout: 15000 
    });

    // Extract data using browser's DOM API
    const extractedData = await page.evaluate(() => {
      const getMeta = (attrName, attrValue) => {
        const el = document.querySelector(`meta[${attrName}="${attrValue}"]`);
        return el ? el.getAttribute('content') : null;
      };

      // JSON-LD extraction
      const jsonLdScripts = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
        try {
          const parsed = JSON.parse(script.textContent.trim());
          jsonLdScripts.push(parsed);
        } catch (e) {
          // Skip invalid JSON-LD
        }
      });

      // Meta tags extraction
      const metaTags = {
        title: document.title?.trim() || null,
        description: getMeta('name', 'description'),
        keywords: getMeta('name', 'keywords'),
        ogTitle: getMeta('property', 'og:title'),
        ogDescription: getMeta('property', 'og:description'),
        ogImage: getMeta('property', 'og:image')
      };

      // Extract links
      const baseUrl = window.location.href;
      const baseUrlObj = new URL(baseUrl);
      const origin = baseUrlObj.origin;
      const links = new Set();

      document.querySelectorAll('a[href]').forEach(anchor => {
        const href = anchor.getAttribute('href');
        if (!href) return;

        try {
          const fullUrl = new URL(href, baseUrl);
          
          if (fullUrl.origin !== origin) return;
          
          const relativePath = fullUrl.pathname.replace(/\/$/, '');
          const segments = relativePath.split('/').filter(Boolean);

          if (segments.length === 0) return;
          if (fullUrl.href === origin || fullUrl.href === origin + '/') return;

          if (segments.length <= 2) {
            fullUrl.hash = '';
            const cleanUrl = fullUrl.href;
            
            if (!/[)\]"']+$/.test(cleanUrl)) {
              links.add(cleanUrl);
            }
          }
        } catch (e) {
          // Skip invalid URLs
        }
      });

      return {
        jsonLd: jsonLdScripts,
        metaTags,
        actualLinks: Array.from(links)
      };
    });

    await browser.close();
    
    console.log(`✅ Puppeteer extraction successful`);
    console.log(`✅ Found ${extractedData.jsonLd.length} JSON-LD blocks`);
    console.log(`✅ Found ${extractedData.actualLinks.length} actual links`);
    console.log('✅ Meta tags extracted');
    
    return extractedData;

  } catch (puppeteerError) {
    console.warn('⚠️ Puppeteer extraction failed:', puppeteerError.message);
    console.log('🔄 Falling back to Axios + Cheerio method...');

    // Method 2: Fallback to Axios + Cheerio
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 10000,
      });

      const $ = cheerio.load(response.data);

      // JSON-LD extraction with Cheerio
      const jsonLdScripts = [];
      $('script[type="application/ld+json"]').each((i, el) => {
        const raw = $(el).html()?.trim();
        try {
          const parsed = JSON.parse(raw);
          jsonLdScripts.push(parsed);
        } catch {
          // Skip invalid JSON-LD
        }
      });

      // Meta tags extraction with Cheerio
      const getMeta = (attrName, attrValue) =>
        $(`meta[${attrName}="${attrValue}"]`).attr('content');

      const metaTags = {
        title: $('title').text()?.trim() || null,
        description: getMeta('name', 'description'),
        keywords: getMeta('name', 'keywords'),
        ogTitle: getMeta('property', 'og:title'),
        ogDescription: getMeta('property', 'og:description'),
        ogImage: getMeta('property', 'og:image')
      };

      // Extract actual links from HTML using existing method
      const actualLinks = this.extractLinksFromHTML($, url);

      console.log('✅ Axios fallback extraction successful');
      console.log(`✅ Found ${jsonLdScripts.length} JSON-LD blocks`);
      console.log(`✅ Found ${actualLinks.length} actual links`);
      console.log('✅ Meta tags extracted');

      return {
        jsonLd: jsonLdScripts,
        metaTags,
        actualLinks,
      };

    } catch (axiosError) {
      console.error('❌ Both Puppeteer and Axios extraction failed');
      console.error('Puppeteer error:', puppeteerError.message);
      console.error('Axios error:', axiosError.message);
      
      // Return null to trigger the existing error handling in analyzeWebsite
      return null;
    }
  }
}
  // --- Link Extraction Utilities ---
  extractLinksFromHTML($, baseUrl) {
    const baseUrlObj = new URL(baseUrl);
    const origin = baseUrlObj.origin;
    const links = new Set();

    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      try {
        const fullUrl = new URL(href, baseUrl);
        
        if (fullUrl.origin !== origin) return;
        
        const relativePath = fullUrl.pathname.replace(/\/$/, '');
        const segments = relativePath.split('/').filter(Boolean);

        if (segments.length === 0) return;
        if (fullUrl.href === origin || fullUrl.href === origin + '/') return;

        if (segments.length <= 2) {
          fullUrl.hash = '';
          const cleanUrl = fullUrl.href;
          
          if (!/[)\]"']+$/.test(cleanUrl)) {
            links.add(cleanUrl);
          }
        }
      } catch (e) {
        // Skip invalid URLs
      }
    });

    return Array.from(links);
  }

  extractLinksFromText(baseUrl, text) {
    const baseUrlObj = new URL(baseUrl);
    const origin = baseUrlObj.origin;
    const links = new Set();

    const patterns = [
      new RegExp(`${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/[^\\s"'>)\\]]+)`, 'gi'),
      /href=["']?([/][^"'>\s)]+)/gi,
      /(?:href|to|link)=["']?([/][a-zA-Z0-9\-_/]+)/gi
    ];

    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        let path = match[1];
        if (!path) continue;

        path = path.replace(/[)\]"']+$/, '');
        
        try {
          const fullUrl = new URL(path, origin);
          const relativePath = fullUrl.pathname.replace(/\/$/, '');
          const segments = relativePath.split('/').filter(Boolean);

          if (segments.length === 0 || segments.length > 2) continue;
          if (fullUrl.href === origin || fullUrl.href === origin + '/') continue;

          fullUrl.hash = '';
          const cleanUrl = fullUrl.href;
          
          if (!/[)\]"']+$/.test(cleanUrl) && this.isValidPath(relativePath)) {
            links.add(cleanUrl);
          }
        } catch (e) {
          // Skip invalid URLs
        }
      }
    });

    return Array.from(links);
  }

  isValidPath(path) {
    const segments = path.split('/').filter(Boolean);
    
    const invalidPatterns = [
      /\.(css|js|png|jpg|jpeg|gif|svg|ico|pdf|zip|exe)$/i,
      /^[)\]"']/,
      /[)\]"']$/,
      /^\s*$/
    ];
    
    for (const segment of segments) {
      for (const pattern of invalidPatterns) {
        if (pattern.test(segment)) return false;
      }
    }
    
    return true;
  }

  // --- Database Operations ---
  async saveToMongo(payload) {
    try {
      const result = await this.collection.insertOne(payload);
      console.log(`✅ Saved to MongoDB with _id: ${result.insertedId}\n`);
      return result;
    } catch (err) {
      console.error('❌ Failed to save in MongoDB:', err.message);
      throw err;
    }
  }

  async updateDocument(filter, update, options = {}) {
    try {
      const result = await this.collection.updateOne(filter, update, { upsert: true, ...options });
      return result;
    } catch (err) {
      console.error('❌ Failed to update document:', err.message);
      throw err;
    }
  }

  async findDocument(filter, options = {}) {
    try {
      return await this.collection.findOne(filter, options);
    } catch (err) {
      console.error('❌ Failed to find document:', err.message);
      throw err;
    }
  }

  async countDocuments(filter = {}) {
    try {
      return await this.collection.countDocuments(filter);
    } catch (err) {
      console.error('❌ Failed to count documents:', err.message);
      throw err;
    }
  }

  async findDocuments(filter = {}, options = {}) {
    try {
      return await this.collection.find(filter, options).toArray();
    } catch (err) {
      console.error('❌ Failed to find documents:', err.message);
      throw err;
    }
  }

  // --- Utility Methods ---
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --- Core Analysis Methods ---
  async analyzeWebsite(targetUrl, queueLinks = false) {
    console.log(`🌐 Analyzing: ${targetUrl}\n`);

    let jinaContent = null;
    let htmlData = null;
    let errorMsg = null;

    try {
      jinaContent = await this.fetchViaJinaAI(targetUrl);
      htmlData = await this.extractFromHTML(targetUrl);
      if (!htmlData) throw new Error('HTML extraction failed');
    } catch (err) {
      errorMsg = err.message;
      console.error(`❌ Error analyzing ${targetUrl}:`, errorMsg);
      
      await this.updateDocument(
        { url: targetUrl },
        { $set: { status: 'broken', error: errorMsg, processedAt: new Date() } }
      );
      return { success: false, error: errorMsg };
    }

    const dataToSave = {
      url: targetUrl,
      timestamp: new Date(),
      jsonLd: htmlData.jsonLd,
      metaTags: htmlData.metaTags,
      jinaContent: jinaContent || null,
      actualLinks: htmlData.actualLinks || [],
      status: 'done',
      processedAt: new Date(),
    };

    await this.updateDocument(
      { url: targetUrl },
      { $set: dataToSave }
    );

    if (queueLinks) {
      let linksToQueue = htmlData.actualLinks || [];
      
      if (linksToQueue.length < 3 && jinaContent) {
        const textLinks = this.extractLinksFromText(targetUrl, jinaContent);
        linksToQueue = [...new Set([...linksToQueue, ...textLinks])];
      }
      
      // Limit the number of links to queue
      linksToQueue = linksToQueue.slice(0, this.config.maxQueuedLinks);

      console.log(`Found ${linksToQueue.length} links to queue`);
      
      for (const link of linksToQueue) {
        if (!link || typeof link !== 'string') continue;
        
        const exists = await this.findDocument({ url: link });
        if (!exists) {
          await this.collection.insertOne({
            url: link,
            status: 'pending',
            timestamp: new Date(),
            jsonLd: [],
            metaTags: {},
            jinaContent: null,
            actualLinks: [],
          });
          console.log(`✅ Queued: ${link}`);
        } else {
          console.log(`⏭️  Already exists: ${link}`);
        }
      }
    }

    return { success: true, data: dataToSave };
  }

  async inferCommonRoutes(baseUrl) {
    // Define common website routes/pages
    const commonRoutes = [
      '/about',
      '/about-us',
      '/contact',
      '/contact-us',
      '/pricing',
      '/features',
      '/services',
      '/products',
      '/blog',
      '/news',
      '/support',
      '/help',
      '/faq',
      '/careers',
      '/team',
      '/privacy',
      '/terms',
      '/login',
      '/signup',
      '/register'
    ];

    const baseUrlObj = new URL(baseUrl);
    let queuedCount = 0;
    for (const route of commonRoutes) {
      if (queuedCount >= this.config.maxQueuedLinks) break; // <-- Limit queued links
      const fullUrl = `${baseUrlObj.origin}${route}`;
      const exists = await this.findDocument({ url: fullUrl });
      
      if (!exists) {
        await this.collection.insertOne({
          url: fullUrl,
          status: 'pending',
          timestamp: new Date(),
          source: 'common_routes'
        });
        console.log(`📝 Queued common route: ${fullUrl}`);
        queuedCount++;
      }
    }
    
    return { success: true, queuedCount };
  }

  async processPageFromMongo(targetUrl) {
    const doc = await this.findDocument(
      { url: targetUrl },
      { sort: { timestamp: -1 } }
    );

    if (!doc) {
      console.error('❌ No stored data found for:', targetUrl);
      return { success: false, error: 'No data found' };
    }

    const existingLinks = doc.actualLinks || [];
    
    if (existingLinks.length >= 4) {
      console.log(`Using ${existingLinks.length} existing links from HTML extraction`);
      return { success: true, linksCount: existingLinks.length };
    }

    // Instead of AI inference, use common routes inference
    console.log('Insufficient links found, inferring common routes...');
    return await this.inferCommonRoutes(targetUrl);
  }

  async processPendingLinks() {
    const pendingDocs = await this.findDocuments({ status: 'pending' });
    if (!pendingDocs.length) {
      console.log('✅ No pending links to process.');
      return { processed: 0 };
    }
    
    console.log(`📋 Processing ${pendingDocs.length} pending links...`);
    let processed = 0;
    
    for (const doc of pendingDocs) {
      const result = await this.analyzeWebsite(doc.url, false);
      if (result.success) processed++;
      await this.sleep(this.config.minDelayMs);
    }
    
    return { processed };
  }

  // --- Main Analysis Method ---
  async analyzeFullWebsite(targetUrl) {
    try {
      await this.connectToMongo();

      console.log('🚀 Step 1: Analyzing base URL...');
      const baseResult = await this.analyzeWebsite(targetUrl, true);
      if (!baseResult.success) {
        throw new Error(`Failed to analyze base URL: ${baseResult.error}`);
      }

      console.log('📝 Step 2: Inferring common routes...');
      await this.processPageFromMongo(targetUrl);

      console.log('⚡ Step 3: Processing all pending links...');
      let iteration = 1;
      let moreToProcess = true;
      let totalProcessed = 0;
      
      while (moreToProcess && iteration <= this.config.maxIterations) {
        console.log(`\n--- Iteration ${iteration} ---`);
        const result = await this.processPendingLinks();
        totalProcessed += result.processed;
        
        const count = await this.countDocuments({ status: 'pending' });
        moreToProcess = count > 0;
        iteration++;
      }
      
      if (iteration > this.config.maxIterations) {
        console.log('⚠️  Reached maximum iterations, stopping...');
      }
      
      const finalStats = await this.getStats();
      console.log(`\n📊 Final Report:`);
      console.log(`   ✅ Successfully processed: ${finalStats.done}`);
      console.log(`   ❌ Broken/failed: ${finalStats.broken}`);
      console.log(`   ⏳ Still pending: ${finalStats.pending}`);
      
      return {
        success: true,
        stats: finalStats,
        totalProcessed
      };
      
    } catch (err) {
      console.error('❌ Error during analysis:', err.message);
      return { success: false, error: err.message };
    }
  }

  async getStats() {
    const done = await this.countDocuments({ status: 'done' });
    const broken = await this.countDocuments({ status: 'broken' });
    const pending = await this.countDocuments({ status: 'pending' });
    
    return { done, broken, pending, total: done + broken + pending };
  }

  // --- Data Retrieval Methods ---
  async getProcessedData(filter = {}) {
    return await this.findDocuments({ status: 'done', ...filter });
  }

  async getDataByUrl(url) {
    return await this.findDocument({ url });
  }
}

// Export the class as default and also named export
export default WebsiteAnalyzer;

// Utility function to create and run a quick analysis
export async function analyzeWebsite(url, options = {}) {
  const analyzer = new WebsiteAnalyzer(options);
  try {
    const result = await analyzer.analyzeFullWebsite(url);
    return result;
  } finally {
    await analyzer.closeMongo();
  }
}