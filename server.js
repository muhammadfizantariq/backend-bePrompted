import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import StructuredDataReportGenerator from './structuredData_report.js'
import { analyzeWebsite } from './website-analyzer.js';
import { analyzeWebsiteGeo } from './schemasAnalyzer.js';
import { sendFullAnalysisEmail } from './email.js';
import { scoreAllDocsWithAI } from './geo-scoring-module.js';
import { RISKCLAIMSAnalyzer } from './claimsRisks.js';
import ProfessionalReportGenerator from './ClaimsReport.js';
import { generateReport_1 } from './metaTags_report.js';
import { generateCrawlabilityPdfReport } from './Crawlability_report.js';
import { StandaloneAnalyzer } from './quick_scan.js';
import dotenv from 'dotenv';
import FAQJsonLdReportGenerator from './faqLd_generator.js';
import { promises as fs } from 'fs';
import crypto from 'crypto';

// Import route modules
import paymentRoutes from './routes/payment.js';
import createAnalysisRoutes from './routes/analysis.js';

dotenv.config();

const app = express();

// Base reports directory (can be overridden in environment)
const REPORTS_BASE = process.env.REPORTS_DIR || './reports';

// Ensure base reports directory exists at startup (handles permission issues early)
async function ensureReportsBaseDir() {
  try {
    await fs.mkdir(REPORTS_BASE, { recursive: true });
    console.log(`📁 Reports base directory ready: ${REPORTS_BASE}`);
  } catch (err) {
    console.error(`❌ Failed to create reports base directory '${REPORTS_BASE}': ${err.message}`);
    if (err.code === 'EACCES') {
      console.error('   🔐 Permission denied. If running in Docker, ensure the directory is writable or not mounted read-only.');
      console.error('   💡 Fix: create the directory on host with correct permissions or avoid mounting it as root-only.');
    }
  }
}
const PORT = process.env.PORT || 5000;

// Allow your frontend domain
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000", // frontend URL
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true
}));
app.use(express.json());

// Use payment routes immediately
app.use('/', paymentRoutes);

const CONFIG = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    maxCalls: 40,
    windowMs: 10000
  },
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
    dbName: process.env.DB_NAME || 'webdata',
    collectionName: process.env.COLLECTION_NAME || 'extractions_3',
    // Dynamic MongoDB connection options based on URI type
    get options() {
      const uri = this.uri;
      
      // For MongoDB Atlas (cloud) - use TLS options
      if (uri.includes('mongodb+srv://') || uri.includes('ssl=true')) {
        return {
          // TLS/SSL options for MongoDB connections
          tls: true,
          tlsAllowInvalidCertificates: true,
          tlsAllowInvalidHostnames: true,
          
          // Connection timeouts
          connectTimeoutMS: 30000,
          socketTimeoutMS: 30000,
          serverSelectionTimeoutMS: 30000,
          
          // Connection pool settings
          maxPoolSize: 10,
          minPoolSize: 5,
          
          // Retry settings
          retryWrites: true,
          retryReads: true,
          
          // Server selection
          heartbeatFrequencyMS: 10000
        };
      }
      
      // For local MongoDB - minimal options
      return {
        // Connection timeouts
        connectTimeoutMS: 30000,
        socketTimeoutMS: 30000,
        serverSelectionTimeoutMS: 30000,
        
        // Connection pool settings
        maxPoolSize: 10,
        minPoolSize: 5,
        
        // Retry settings
        retryWrites: true,
        retryReads: true
      };
    }
  }
};


class AnalysisQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.currentTask = null;
    this.processedUrls = new Set(); 
    this.queueLock = false;
  }

  async addTask(email, url, res) {
    // Normalize URL to prevent duplicates
    const normalizedUrl = this.normalizeUrl(url);
    const taskId = this.generateTaskId(email, normalizedUrl);
    
    // Check if the same URL is already being processed or queued
    const isDuplicate = this.queue.some(task => task.taskId === taskId) || 
                       (this.currentTask && this.currentTask.taskId === taskId);
    
    if (isDuplicate) {
      console.log(`⚠️ Duplicate request detected for ${normalizedUrl} by ${email}. Rejecting.`);
      return res.status(409).json({ 
        success: false, 
        error: 'This URL is already being processed. Please wait for the current analysis to complete.' 
      });
    }

    const task = {
      taskId,
      email,
      url: normalizedUrl,
      res,
      queuedAt: Date.now(), // When it was added to queue
      retryCount: 0
    };

    // Thread-safe queue addition
    while (this.queueLock) {
      await this.sleep(100);
    }
    
    this.queueLock = true;
    this.queue.push(task);
    this.queueLock = false;

    console.log(`📥 Task ${taskId} added to queue. Position: ${this.queue.length}`);
    this.logQueueStatus();

    // Start processing if not already running
    if (!this.isProcessing) {
      setImmediate(() => this.processQueue());
    }

    return null; 
  }

  async processQueue() {
    // Double-check lock pattern to prevent race conditions
    if (this.isProcessing) {
      console.log('⚠️ Queue processing already in progress. Skipping.');
      return;
    }

    this.isProcessing = true;
    console.log('▶️ Queue processor started.');

    try {
      while (this.queue.length > 0) {
        // Thread-safe task retrieval
        while (this.queueLock) {
          await this.sleep(100);
        }
        
        this.queueLock = true;
        const task = this.queue.shift();
        this.queueLock = false;

        if (!task) continue;

        this.currentTask = task;
        
        // Generate timestamp when work actually starts (not when queued)
        task.processingStartedAt = Date.now();
        
        console.log(`\n🔬 Processing task: ${task.taskId}`);
        console.log(`   URL: ${task.url}`);
        console.log(`   Email: ${task.email}`);
        console.log(`   Queued for: ${Date.now() - task.queuedAt}ms`);
        console.log(`   Queue remaining: ${this.queue.length}`);

        try {
          await this.processTask(task);
        } catch (error) {
          await this.handleTaskError(task, error);
        } finally {
          this.currentTask = null;
          // Always clean database after each task to prevent contamination
          await this.cleanupAfterTask(task);
        }
      }
    } finally {
      this.isProcessing = false;
      console.log('✅ Queue processor stopped. All tasks completed.');
    }
  }

  async processTask(task) {
    const startTime = Date.now();
    
    try {
      const result = await ultimateAnalyzer.runUltimateAnalysis(task.url, task.email, task);
      
      // Send email notification after successful analysis
      if (result && result.success) {
        try {
          console.log(`📧 Sending analysis results email to ${task.email}...`);
          console.log(`   Report directory: ${result.reportDirectory}`);
          
          await sendFullAnalysisEmail({
            to: task.email,
            url: task.url,
            reportDirectory: result.reportDirectory,
            analysisResults: result
          });
          console.log(`✅ Analysis results email sent successfully to ${task.email}`);
        } catch (emailError) {
          console.error(`❌ Failed to send analysis email to ${task.email}:`, emailError.message);
          console.error(`   Email error details:`, {
            errorCode: emailError.code,
            errorResponse: emailError.response,
            commandUsed: emailError.command
          });
          // Don't fail the entire task if email fails - analysis was successful
        }
      } else {
        console.warn(`⚠️ Skipping email send - analysis was not successful for ${task.email}`);
        if (result?.error) {
          console.warn(`   Analysis error: ${result.error}`);
        }
      }
      
      if (!task.res.headersSent) {
        // Add processing time to response
        result.processingTimeMs = Date.now() - startTime;
        result.taskId = task.taskId;
        task.res.json(result);
      }
      
      console.log(`✅ Task ${task.taskId} completed successfully in ${Date.now() - startTime}ms`);
      
    } catch (error) {
      console.error(`💥 Task ${task.taskId} failed:`, error.message);
      
      if (!task.res.headersSent) {
        task.res.status(500).json({
          success: false,
          error: 'Analysis failed due to server error',
          taskId: task.taskId,
          processingTimeMs: Date.now() - startTime
        });
      }
    }
  }

  async handleTaskError(task, error) {
    console.error(`💥 Critical error in task ${task.taskId}:`, error);
    
    // Implement retry logic for recoverable errors
    if (task.retryCount < 2 && this.isRetryableError(error)) {
      task.retryCount++;
      console.log(`🔄 Retrying task ${task.taskId} (attempt ${task.retryCount + 1}/3)`);
      
      // Add back to queue with delay
      setTimeout(() => {
        this.queueLock = true;
        this.queue.unshift(task); // Add to front for priority
        this.queueLock = false;
      }, 5000 * task.retryCount); // Exponential backoff
      
      return;
    }

    // Final failure
    if (!task.res.headersSent) {
      task.res.status(500).json({
        success: false,
        error: 'Analysis failed after retries',
        taskId: task.taskId
      });
    }
  }

  async cleanupAfterTask(task) {
    console.log(`🧼 Cleaning up after task: ${task.taskId}`);
    try {
      await deleteDatabase();
      console.log('✅ Database cleaned successfully');
    } catch (error) {
      console.error('❌ Database cleanup failed:', error.message);
    }
  }

  normalizeUrl(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }

  generateTaskId(email, url) {
    const data = `${email}:${url}:${Date.now()}`;
    return crypto.createHash('md5').update(data).digest('hex').substring(0, 8);
  }

  isRetryableError(error) {
    const retryableErrors = [
      'timeout',
      'network',
      'connection',
      'ENOTFOUND',
      'ECONNRESET'
    ];
    
    return retryableErrors.some(keyword => 
      error.message.toLowerCase().includes(keyword)
    );
  }

  logQueueStatus() {
    const queueSummary = this.queue.map(task => ({
      taskId: task.taskId,
      url: task.url,
      email: task.email,
      retries: task.retryCount
    }));
    
    console.log('📋 Current Queue Status:', JSON.stringify(queueSummary, null, 2));
    
    if (this.currentTask) {
      console.log('🔄 Currently Processing:', {
        taskId: this.currentTask.taskId,
        url: this.currentTask.url,
        email: this.currentTask.email
      });
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get queue status for monitoring
  getStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      currentTask: this.currentTask ? {
        taskId: this.currentTask.taskId,
        url: this.currentTask.url,
        email: this.currentTask.email
      } : null,
      queueItems: this.queue.map(task => ({
        taskId: task.taskId,
        url: task.url,
        email: task.email,
        retries: task.retryCount,
        waitTime: Date.now() - task.queuedAt
      }))
    };
  }
}

// Initialize the robust queue system
const analysisQueue = new AnalysisQueue();

// --- END QUEUE SYSTEM ---

class UltimateAnalyzer {
  constructor() {
    this.riskClaimsAnalyzer = null;
    this.quickAnalyzer = null;
    this.initializeAnalyzers();
  }

  initializeAnalyzers() {
    if (!CONFIG.openai.apiKey) {
      console.warn('⚠️ OPENAI_API_KEY not found - AI analysis will be unavailable');
    } else {
      try {
        this.riskClaimsAnalyzer = new RISKCLAIMSAnalyzer(CONFIG.openai.apiKey, {
          maxCalls: CONFIG.openai.maxCalls,
          windowMs: CONFIG.openai.windowMs,
          mongoUri: CONFIG.mongodb.uri,
          mongoOptions: CONFIG.mongodb.options,
          dbName: CONFIG.mongodb.dbName,
          collectionName: CONFIG.mongodb.collectionName
        });
      } catch (error) {
        console.warn('⚠️ Failed to initialize RISKCLAIMSAnalyzer:', error.message);
      }

      try {
        this.quickAnalyzer = new StandaloneAnalyzer({
          jinaApiKey: process.env.JINA_API_KEY,
          openaiApiKey: CONFIG.openai.apiKey
        });
        console.log('✅ Quick analyzer initialized');
      } catch (error) {
        console.warn('⚠️ Failed to initialize Quick Analyzer:', error.message);
      }
    }
  }

  async cleanup() {
    if (this.riskClaimsAnalyzer) {
      await this.riskClaimsAnalyzer.disconnect();
    }
  }

  async runQuickScan(url, email = null) {
    if (!this.quickAnalyzer) {
      throw new Error('Quick Analyzer not initialized - check API keys');
    }

    console.log(`⚡ Starting quick scan for: ${url}${email ? ` (requested by: ${email})` : ''}`);
    const result = await this.quickAnalyzer.analyzeSingleUrl(url, email);

    if (result.status === 'success') {
      const safeResult = {
        success: true,
        data: {
          url: result.url || url,
          finalScore: result.finalScore || 0,
          summary: result.claimsAnalysis?.summary || 'No summary available',
          recommendations: result.claimsAnalysis?.recommendations || []
        }
      };

      console.log('📊 Quick scan results prepared:', {
        url: safeResult.data.url,
        score: safeResult.data.finalScore,
        recommendationsCount: safeResult.data.recommendations.length
      });
      return safeResult;
    } else {
      console.error('❌ Quick scan failed:', result.error);
      return {
        success: false,
        error: result.error || 'Quick scan failed - check console for details'
      };
    }
  }

  async runRiskClaimsAnalysis(url) {
    if (!this.riskClaimsAnalyzer) {
      throw new Error('RISKCLAIMSAnalyzer not initialized - check OPENAI_API_KEY');
    }
    return await this.riskClaimsAnalyzer.analyzeComplete(url);
  }

  async runUltimateAnalysis(url, email, task = null) {
    const results = {
      success: false,
      steps: {},
      error: null,
      reportDirectory: null,
      startTime: new Date().toISOString()
    };

    let reportDir = null;

    try {
      // Create directory with timestamp from when processing actually starts
      const hostname = new URL(url).hostname.replace(/\./g, '_');
      
      // Use processing start time for timestamp (not queue time)
      const processingStartTime = task?.processingStartedAt || Date.now();
      const timestamp = new Date(processingStartTime).toISOString().replace(/[:.]/g, '-').slice(0, 19);
      
      const emailDir = email.replace(/[@.]/g, '_');
      
      // Keep your original path structure, only add unique suffix if collision detected
  let baseReportDir = `${REPORTS_BASE}/${emailDir}/${hostname}_${timestamp}`;
      reportDir = baseReportDir;
      
      // Check if directory already exists and add minimal unique suffix if needed
      try {
        await fs.access(reportDir);
        // Directory exists, add minimal unique suffix
        const uniqueId = crypto.randomBytes(2).toString('hex'); // Smaller ID
        reportDir = `${baseReportDir}_${uniqueId}`;
        console.log(`⚠️ Directory collision detected, using: ${reportDir}`);
      } catch {
        // Directory doesn't exist, use original name
        console.log(`📁 Using original directory name: ${reportDir}`);
      }
      results.reportDirectory = reportDir;

      await fs.mkdir(reportDir, { recursive: true });
      console.log(`📁 Created unique report directory: ${reportDir}`);

      // --- 📊 ANALYSIS BLOCK ---
      console.log('🌐 Step 1: Website Structure Analysis...');
      const websiteResult = await analyzeWebsite(url, { 
        minDelayMs: 5000, 
        maxIterations: 5,
        mongoUri: CONFIG.mongodb.uri,
        mongoOptions: CONFIG.mongodb.options,
        dbName: CONFIG.mongodb.dbName,
        collectionName: CONFIG.mongodb.collectionName
      });
      results.steps.website = websiteResult;
      if (!websiteResult.success) throw new Error(`Website analysis failed: ${websiteResult.error}`);

      console.log('🎯 Step 2: GEO Schemas Analysis...');
      const geoResult = await analyzeWebsiteGeo(url, {
        verbose: false, 
        baseSleepMs: 3000, 
        mongoUri: CONFIG.mongodb.uri,
        mongoOptions: CONFIG.mongodb.options,
        openaiApiKey: CONFIG.openai.apiKey, 
        dbName: CONFIG.mongodb.dbName,
        collectionName: CONFIG.mongodb.collectionName
      });
      results.steps.geo = geoResult;
      if (!geoResult.overallSuccess) throw new Error(`GEO analysis failed: ${geoResult.error}`);

      console.log('⚡ Step 3: GEO Scoring...');
      const scoringConfig = {
        mongoUri: CONFIG.mongodb.uri, 
        mongoOptions: CONFIG.mongodb.options,
        dbName: CONFIG.mongodb.dbName,
        collectionName: CONFIG.mongodb.collectionName, 
        openaiApiKey: CONFIG.openai.apiKey
      };
      if (!scoringConfig.openaiApiKey) throw new Error('OPENAI_API_KEY is required for GEO scoring');
      const scoringResult = await scoreAllDocsWithAI(scoringConfig);
      results.steps.scoring = scoringResult;
      if (!scoringResult.success) throw new Error(`GEO scoring failed: ${scoringResult.message}`);

      console.log('🔍 Step 4: Risk & Claims Analysis...');
      const riskClaimsResult = await this.runRiskClaimsAnalysis(url);
      results.steps.riskClaims = riskClaimsResult;

      // --- 📄 REPORTING BLOCK ---
      console.log('\n✅ All analyses complete. Now generating reports...');
      console.log('ℹ️ Note: Each report generation is independent - failures won\'t stop other reports');

      // Generate reports sequentially to avoid race conditions and resource conflicts
      console.log('\n🔄 Starting sequential report generation for stability...');
      
      // Professional Content Report (Claims-based)
      results.steps.professionalReport = await this.generateProfessionalReport(reportDir);
      
      // Crawlability Report (Independent)
      results.steps.crawlabilityReport = await this.generateCrawlabilityReport(url, reportDir);
      
      // FAQ JSON-LD Report (Independent)
      results.steps.faqReport = await this.generateFAQReport(reportDir);
      
      // Structured Data Report (Independent) 
      results.steps.structuredDataReport = await this.generateStructuredDataReport(reportDir);
      
      // Meta Tags (GEO) Report (Independent)
      results.steps.geoReport = await this.generateGeoReport(reportDir);

      // Count successful reports
      const reportSteps = ['professionalReport', 'crawlabilityReport', 'faqReport', 'structuredDataReport', 'geoReport'];
      const successfulReports = reportSteps.filter(step => results.steps[step]?.success).length;
      const totalReports = reportSteps.length;
      
      console.log(`\n📊 Report Generation Summary:`);
      console.log(`   ✅ Successful: ${successfulReports}/${totalReports} reports`);
      console.log(`   📁 All reports saved to: ${reportDir}`);
      
      // Log individual report status
      reportSteps.forEach(stepName => {
        const stepResult = results.steps[stepName];
        if (stepResult) {
          const status = stepResult.success ? '✅' : '❌';
          const message = stepResult.success ? stepResult.path : stepResult.error;
          console.log(`   ${status} ${stepName}: ${message}`);
        }
      });

      results.success = true;
      results.endTime = new Date().toISOString();
      console.log(`\n🎉 Ultimate analysis and reporting completed successfully! Reports saved in: ${reportDir}`);
      
    } catch (error) {
      results.error = error.message;
      results.endTime = new Date().toISOString();
      console.error('💥 Ultimate analysis CRASHED during execution:', error.message);
      
      // Clean up failed directory if it was created
      if (reportDir) {
        try {
          // Use fs.rm instead of deprecated fs.rmdir
          await fs.rm(reportDir, { recursive: true, force: true });
          console.log(`🧹 Cleaned up failed report directory: ${reportDir}`);
        } catch (cleanupError) {
          console.warn('⚠️ Failed to cleanup report directory:', cleanupError.message);
        }
      }
    }

    return results;
  }

  // Individual report generation methods - each is independent and non-blocking
  async generateProfessionalReport(reportDir) {
    console.log('\n📄 Step 5: Generating Professional Content Report...');
    const startTime = Date.now();
    try {
      const generator = new ProfessionalReportGenerator(CONFIG.mongodb.uri, CONFIG.mongodb.dbName, CONFIG.mongodb.options);
      const reportPath = `${reportDir}/WebsiteContent_report.pdf`;
      await generator.generateReport(reportPath);
      console.log(`✅ Professional report completed in ${Date.now() - startTime}ms`);
      return { success: true, path: reportPath, duration: Date.now() - startTime };
    } catch (e) {
      console.error(`❌ Professional report failed after ${Date.now() - startTime}ms:`, e.message);
      console.error('   This is usually due to missing claims_evaluation data - other reports will continue');
      return { success: false, error: e.message, duration: Date.now() - startTime };
    }
  }

  async generateCrawlabilityReport(url, reportDir) {
    console.log('\n📄 Step 6: Generating Crawlability Report...');
    const startTime = Date.now();
    try {
      const pdfFilename = `${reportDir}/llm_Crawlability_Report.pdf`;
      console.log(`   📊 Starting crawl analysis for: ${url}`);
      
      const crawlResult = await generateCrawlabilityPdfReport(url, pdfFilename);
      
      if (crawlResult) {
        console.log(`✅ Crawlability report completed in ${Date.now() - startTime}ms`);
        return { success: true, result: crawlResult, path: pdfFilename, duration: Date.now() - startTime };
      } else {
        console.log(`⚠️ Crawlability report completed but no pages were crawled (${Date.now() - startTime}ms)`);
        return { success: false, error: 'No pages crawled', duration: Date.now() - startTime };
      }
    } catch (e) {
      console.error(`❌ Crawlability report failed after ${Date.now() - startTime}ms:`, e.message);
      return { success: false, error: e.message, duration: Date.now() - startTime };
    }
  }

  async generateFAQReport(reportDir) {
    console.log('\n📄 Step 7: Generating FAQ JSON-LD Report...');
    const startTime = Date.now();
    try {
      const generator = new FAQJsonLdReportGenerator(
        CONFIG.mongodb.uri,
        CONFIG.mongodb.dbName,
        CONFIG.mongodb.collectionName,
        CONFIG.mongodb.options
      );
      const faqPath = `${reportDir}/faq_jsonld_report.pdf`;
      console.log(`   📊 Analyzing FAQ data from collection: ${CONFIG.mongodb.collectionName}`);
      
      await generator.generatePDFReport(faqPath);
      console.log(`✅ FAQ report completed in ${Date.now() - startTime}ms`);
      return { success: true, path: faqPath, duration: Date.now() - startTime };
    } catch (e) {
      console.error(`❌ FAQ report failed after ${Date.now() - startTime}ms:`, e.message);
      return { success: false, error: e.message, duration: Date.now() - startTime };
    }
  }

  async generateStructuredDataReport(reportDir) {
    console.log('\n📄 Step 8: Generating Structured Data Report...');
    const startTime = Date.now();
    try {
      const generator = new StructuredDataReportGenerator(CONFIG.mongodb.uri, CONFIG.mongodb.dbName, CONFIG.mongodb.collectionName, CONFIG.mongodb.options);
      const sdPath = `${reportDir}/structuredDataAudit_report.pdf`;
      console.log(`   📊 Analyzing structured data from collection: ${CONFIG.mongodb.collectionName}`);
      
      await generator.generatePDFReport(sdPath);
      console.log(`✅ Structured Data report completed in ${Date.now() - startTime}ms`);
      return { success: true, path: sdPath, duration: Date.now() - startTime };
    } catch (e) {
      console.error(`❌ Structured Data report failed after ${Date.now() - startTime}ms:`, e.message);
      return { success: false, error: e.message, duration: Date.now() - startTime };
    }
  }

  async generateGeoReport(reportDir) {
    console.log('\n📄 Step 9: Generating Meta Tags (GEO) Report...');
    const startTime = Date.now();
    try {
      const geoReportPath = `${reportDir}/metaTags_analysis.pdf`;
      console.log(`   📊 Analyzing meta tags and GEO data from collection: ${CONFIG.mongodb.collectionName}`);
      
      await generateReport_1(geoReportPath);
      console.log(`✅ Meta Tags (GEO) report completed in ${Date.now() - startTime}ms`);
      return { success: true, path: geoReportPath, duration: Date.now() - startTime };
    } catch (e) {
      console.error(`❌ Meta Tags (GEO) report failed after ${Date.now() - startTime}ms:`, e.message);
      return { success: false, error: e.message, duration: Date.now() - startTime };
    }
  }
}

const ultimateAnalyzer = new UltimateAnalyzer();

// Now that we have the dependencies, create and use analysis routes
const analysisRoutes = createAnalysisRoutes(analysisQueue, ultimateAnalyzer);
app.use('/', analysisRoutes);

async function deleteDatabase() {
  try {
    console.log('🔌 Attempting MongoDB connection for cleanup...');
    const client = new MongoClient(CONFIG.mongodb.uri, CONFIG.mongodb.options);
    
    // Test connection first
    await client.connect();
    console.log('✅ MongoDB connection successful for cleanup');
    
    const db = client.db(CONFIG.mongodb.dbName);
    await db.dropDatabase();
    console.log(`🧹 Database '${CONFIG.mongodb.dbName}' deleted successfully for fresh start.`);
    
    await client.close();
    console.log('✅ MongoDB connection closed after cleanup');
  } catch (err) {
    console.error(`❌ Failed to delete database: ${err.message}`);
    if (err.message.includes('ECONNREFUSED')) {
      console.error('   💡 MongoDB server is not running or not accessible');
    } else if (err.message.includes('authentication')) {
      console.error('   💡 Check MongoDB username/password in connection string');
    } else if (err.message.includes('tls') || err.message.includes('ssl')) {
      console.error('   💡 TLS/SSL connection issue - check connection string and certificates');
    }
  }
}

// --- GRACEFUL SHUTDOWN ---
async function gracefulShutdown() {
  console.log('\n🛑 Shutdown signal received. Starting graceful shutdown...');
  
  // Wait for current analysis to complete (max 2 minutes)
  const maxWaitTime = 120000; // 2 minutes
  const startTime = Date.now();
  
  while (analysisQueue.isProcessing && (Date.now() - startTime) < maxWaitTime) {
    console.log('⏳ Waiting for current analysis to complete...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  if (analysisQueue.isProcessing) {
    console.log('⚠️ Force stopping - analysis taking too long');
    // Clean database to prevent stale data
    await deleteDatabase();
  }
  
  // Cleanup analyzers
  await ultimateAnalyzer.cleanup();
  
  console.log('✅ Graceful shutdown completed');
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);  // Ctrl+C
process.on('SIGTERM', gracefulShutdown); // Docker/PM2 termination
process.on('SIGQUIT', gracefulShutdown); // Quit signal

// Handle uncaught exceptions gracefully
process.on('uncaughtException', async (error) => {
  console.error('💥 Uncaught Exception:', error);
  await deleteDatabase(); // Clean up
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  await deleteDatabase(); // Clean up
  process.exit(1);
});

// Prepare reports directory then start server
ensureReportsBaseDir().then(() => {
app.listen(PORT, () => {
  console.log(`🚀 Ultimate Analysis Server running on http://localhost:${PORT}`);
  console.log(`📋 Environment check:`);
  console.log(`   - MONGODB_URI: ${CONFIG.mongodb.uri ? '✅' : '❌ Missing'}`);
  console.log(`   - OPENAI_API_KEY: ${CONFIG.openai.apiKey ? '✅' : '❌ Missing'}`);
  console.log(`   - JINA_API_KEY: ${process.env.JINA_API_KEY ? '✅' : '❌ Missing'}`);
  console.log(`   - Database: ${CONFIG.mongodb.dbName}`);
  console.log(`   - Collection: ${CONFIG.mongodb.collectionName}`);
  if (process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE_PATH) {
    console.log(`   - Chrome Path: ${process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE_PATH}`);
  }
  
  // Debug MongoDB connection options
  const mongoOptions = CONFIG.mongodb.options;
  console.log(`\n🔌 MongoDB Connection Options:`);
  console.log(`   - TLS: ${mongoOptions.tls || 'false'}`);
  console.log(`   - TLS Allow Invalid Certificates: ${mongoOptions.tlsAllowInvalidCertificates || 'false'}`);
  console.log(`   - Connection Timeout: ${mongoOptions.connectTimeoutMS}ms`);
  console.log(`   - Max Pool Size: ${mongoOptions.maxPoolSize}`);
  
  console.log(`\n📡 Available endpoints:`);
  console.log(`   - POST /quick-scan - Fast content analysis (~2-3 minutes)`);
  console.log(`   - POST /analyze - Complete analysis with reports (~15-30 minutes)`);
  console.log(`   - GET /queue-status - Check current queue status`);
  console.log(`   - GET /health - Server health and configuration check`);
});
});

export default app;