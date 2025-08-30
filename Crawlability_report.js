import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import robotsParser from 'robots-parser';
import fs from 'fs';
import puppeteer from 'puppeteer';
import path from 'path';

// ==================== CONFIGURATION ====================
// --- Crawl Settings ---
const MAX_DEPTH = 2; // How deep to crawl from the base URL.
const MAX_PAGES = 20; // Maximum number of pages to crawl.
const USER_AGENT = "LLM-Crawlability-Checker/1.0"; // Custom user agent for the bot.

// --- MongoDB Settings (UPDATE THESE) ---
const MONGO_URI = "mongodb://localhost:27017"; // Your MongoDB connection string.
const DB_NAME = "webdata"; // The name of the database.
const COLLECTION_NAME = "extractions_3"; // The name of the collection.

// ==================== DATABASE CONNECTION ====================
/**
 * Connects to MongoDB and returns the database and collection objects.
 * @returns {Promise<{client: MongoClient, db: any, collection: any}>}
 */
async function connectToDb() {
    const client = new MongoClient(MONGO_URI);
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);
        console.log("✅ Successfully connected to MongoDB.");
        return { client, db, collection };
    } catch (err) {
        console.error("❌ Could not connect to MongoDB.", err);
        process.exit(1);
    }
}

// ==================== CRAWLER LOGIC ====================
/**
 * Normalizes a URL by removing the hash fragment.
 * @param {string} u - The URL string.
 * @returns {string} - The normalized URL.
 */
function normalizeUrl(u) {
    try {
        const parsed = new URL(u);
        parsed.hash = "";
        return parsed.href;
    } catch {
        return u;
    }
}

/**
 * Fetches the HTML content of a URL with a timeout.
 * @param {string} url - The URL to fetch.
 * @returns {Promise<{html: string|null, error: string|null, statusCode: number|null}>}
 */
async function fetchHTML(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10-second timeout
    try {
        const res = await fetch(url, { redirect: "follow", signal: controller.signal, headers: { 'User-Agent': USER_AGENT } });
        clearTimeout(timeout);
        if (!res.ok) {
            const error = `HTTP ${res.status} - ${res.statusText}`;
            console.error(`⚠️  Failed to fetch ${url} (Status: ${res.status})`);
            return { html: null, error, statusCode: res.status };
        }
        const html = await res.text();
        return { html, error: null, statusCode: res.status };
    } catch (err) {
        clearTimeout(timeout);
        const error = err.message;
        console.error(`❌ Fetch error for ${url}:`, error);
        return { html: null, error, statusCode: null };
    }
}

/**
 * Fetches and parses the robots.txt file for a given base URL.
 * @param {string} baseUrl - The base URL of the site.
 * @returns {Promise<{robots: object|null, error: string|null}>}
 */
async function getRobots(baseUrl) {
    try {
        const robotsUrl = new URL("/robots.txt", baseUrl).href;
        const res = await fetch(robotsUrl, { headers: { 'User-Agent': USER_AGENT } });
        if (!res.ok) {
            return { robots: null, error: `robots.txt returned ${res.status}` };
        }
        const txt = await res.text();
        const robots = robotsParser(robotsUrl, txt);
        return { robots, error: null };
    } catch (err) {
        return { robots: null, error: err.message };
    }
}

/**
 * Performs basic connectivity and accessibility tests for a URL.
 * @param {string} baseUrl - The URL to test.
 * @returns {Promise<object>} - Diagnostic information about the URL.
 */
async function performDiagnostics(baseUrl) {
    const diagnostics = {
        urlValid: false,
        dnsResolvable: false,
        serverResponsive: false,
        httpAccessible: false,
        httpsAccessible: false,
        robotsAccessible: false,
        redirectChain: [],
        finalUrl: null,
        statusCode: null,
        responseTime: null,
        contentType: null,
        serverHeaders: {},
        errors: []
    };

    // URL Validation
    try {
        const parsed = new URL(baseUrl);
        diagnostics.urlValid = true;
        diagnostics.dnsResolvable = true; // Assume DNS is fine if URL parses
    } catch (err) {
        diagnostics.errors.push(`Invalid URL format: ${err.message}`);
        return diagnostics;
    }

    // Test HTTP/HTTPS accessibility
    const startTime = Date.now();
    const { html, error, statusCode } = await fetchHTML(baseUrl);
    diagnostics.responseTime = Date.now() - startTime;

    if (html) {
        diagnostics.serverResponsive = true;
        diagnostics.httpAccessible = true;
        diagnostics.statusCode = statusCode;
        diagnostics.finalUrl = baseUrl;
    } else if (error) {
        diagnostics.errors.push(`Connection failed: ${error}`);
        
        // Try HTTPS if HTTP failed
        if (baseUrl.startsWith('http://')) {
            const httpsUrl = baseUrl.replace('http://', 'https://');
            const { html: httpsHtml, error: httpsError, statusCode: httpsStatusCode } = await fetchHTML(httpsUrl);
            if (httpsHtml) {
                diagnostics.httpsAccessible = true;
                diagnostics.serverResponsive = true;
                diagnostics.statusCode = httpsStatusCode;
                diagnostics.finalUrl = httpsUrl;
            } else {
                diagnostics.errors.push(`HTTPS also failed: ${httpsError}`);
            }
        }
    }

    // Test robots.txt accessibility
    const { robots, error: robotsError } = await getRobots(baseUrl);
    if (robots) {
        diagnostics.robotsAccessible = true;
    } else if (robotsError) {
        diagnostics.errors.push(`robots.txt inaccessible: ${robotsError}`);
    }

    return diagnostics;
}

/**
 * The main crawling function that explores a website.
 * @param {string} baseUrl - The starting URL for the crawl.
 * @returns {Promise<object>} - A comprehensive object containing all crawl data.
 */
async function crawl(baseUrl) {
    const visited = new Set();
    const toVisit = [{ url: normalizeUrl(baseUrl), depth: 0 }];
    const pages = [];
    const crawlErrors = [];

    console.log("=".repeat(50));
    console.log(`🕷️  Starting crawl for: ${baseUrl}`);
    console.log(`📊 Max Depth: ${MAX_DEPTH} | Max Pages: ${MAX_PAGES}`);
    console.log("=".repeat(50));

    // Perform initial diagnostics
    const diagnostics = await performDiagnostics(baseUrl);

    const { robots, error: robotsError } = await getRobots(baseUrl);
    const robotsFound = !!robots;
    if (robotsFound) {
        console.log("📄 Found robots.txt and will respect its rules.");
    } else {
        console.log("ℹ️  No robots.txt found. Crawling all discoverable pages.");
        if (robotsError) {
            crawlErrors.push(`robots.txt error: ${robotsError}`);
        }
    }
    console.log();

    // If basic connectivity fails, return early with diagnostics
    if (!diagnostics.serverResponsive) {
        console.log("❌ Server is not responsive. Cannot proceed with crawling.");
        return {
            targetUrl: baseUrl,
            pages: [],
            crawlDate: new Date(),
            userAgent: USER_AGENT,
            maxDepth: MAX_DEPTH,
            maxPages: MAX_PAGES,
            robotsFound,
            diagnostics,
            crawlErrors,
            crawlSuccess: false,
            crawlFailureReason: "Server not responsive"
        };
    }

    while (toVisit.length > 0 && visited.size < MAX_PAGES) {
        const { url, depth } = toVisit.shift();

        if (visited.has(url) || depth > MAX_DEPTH) {
            continue;
        }

        if (robots && !robots.isAllowed(url, USER_AGENT)) {
            console.log(`🚫 Skipping (blocked by robots.txt): ${url}`);
            crawlErrors.push(`Blocked by robots.txt: ${url}`);
            continue;
        }

        visited.add(url);
        console.log(`[${visited.size}/${MAX_PAGES}] Crawling (Depth ${depth}): ${url}`);

        const { html, error } = await fetchHTML(url);
        if (!html) {
            crawlErrors.push(`Failed to fetch ${url}: ${error}`);
            continue;
        }

        const dom = new JSDOM(html);
        const doc = dom.window.document;

        // Collect on-page metrics
        const images = Array.from(doc.querySelectorAll("img"));
        const totalImages = images.length;
        const withAlt = images.filter(img => img.hasAttribute("alt") && img.getAttribute("alt").trim() !== "").length;
        
        pages.push({
            fullUrl: url,
            totalImages: totalImages,
            withAlt: withAlt,
            jsonLd: doc.querySelectorAll('script[type="application/ld+json"]').length,
            robotsDirectives: Array.from(doc.querySelectorAll('meta[name="robots"]')).map(m => m.content.trim()),
            h1Count: doc.querySelectorAll("h1").length,
            h2Count: doc.querySelectorAll("h2").length,
            h3Count: doc.querySelectorAll("h3").length,
            noJsContent: doc.querySelectorAll("noscript").length,
        });

        // Find new internal links to visit
        if (depth < MAX_DEPTH) {
            const links = Array.from(doc.querySelectorAll("a[href]"))
                .map(a => {
                    try {
                        return normalizeUrl(new URL(a.href, baseUrl).href);
                    } catch {
                        return null;
                    }
                })
                .filter(href => href && href.startsWith(baseUrl) && !visited.has(href));
            
            const uniqueLinks = [...new Set(links)];
            uniqueLinks.forEach(link => toVisit.push({ url: link, depth: depth + 1 }));
        }
    }
    
    console.log("\n✅ Crawl finished.");
    return {
        targetUrl: baseUrl,
        pages,
        crawlDate: new Date(),
        userAgent: USER_AGENT,
        maxDepth: MAX_DEPTH,
        maxPages: MAX_PAGES,
        robotsFound,
        diagnostics,
        crawlErrors,
        crawlSuccess: pages.length > 0,
        crawlFailureReason: pages.length === 0 ? "No pages could be successfully crawled" : null
    };
}

// ==================== FALLBACK REPORT GENERATION ====================
/**
 * Generates a fallback report when crawling fails completely.
 * @param {string} targetUrl - The URL that failed to be crawled.
 * @param {object} diagnostics - Diagnostic information about the URL.
 * @param {Array} crawlErrors - Array of errors encountered during crawling.
 * @returns {object} - Fallback crawl data structure.
 */
function generateFallbackReport(targetUrl, diagnostics = {}, crawlErrors = []) {
    const commonIssues = [
        "Server not responding or unreachable",
        "DNS resolution failures",
        "SSL/TLS certificate issues",
        "HTTP status errors (4xx, 5xx)",
        "Network connectivity problems",
        "Firewall or security restrictions",
        "robots.txt blocking all crawlers",
        "Redirect loops or excessive redirects",
        "JavaScript-heavy sites without server-side rendering",
        "Authentication requirements",
        "Rate limiting or anti-bot measures",
        "Geo-blocking restrictions",
        "Invalid HTML structure",
        "Server timeouts"
    ];

    const genericRecommendations = [
        "Check server uptime and hosting configuration",
        "Verify DNS settings and domain configuration",
        "Review and update SSL certificates",
        "Examine robots.txt file for overly restrictive rules",
        "Implement proper server-side rendering for JavaScript content",
        "Configure appropriate HTTP status codes",
        "Optimize server response times",
        "Review security settings and whitelist legitimate crawlers",
        "Check for redirect chains and fix loops",
        "Ensure proper HTML structure and validation",
        "Monitor server logs for crawling attempts",
        "Implement structured data markup",
        "Add proper meta tags and heading structure"
    ];

    const crawlabilityTips = [
        {
            category: "Server Configuration",
            tips: [
                "Ensure your web server (Apache, Nginx, IIS) is properly configured and responding to requests",
                "Set up proper HTTP status codes: 200 for success, 301/302 for redirects, 404 for not found",
                "Configure server timeout settings to allow adequate time for crawlers",
                "Enable compression (gzip) to improve page load times for crawlers",
                "Set up proper caching headers to optimize crawler efficiency"
            ]
        },
        {
            category: "robots.txt Best Practices",
            tips: [
                "Create a robots.txt file at your domain root (yoursite.com/robots.txt)",
                "Use 'User-agent: *' followed by 'Allow: /' to allow all crawlers",
                "Only use 'Disallow:' directives for content you specifically don't want crawled",
                "Include your XML sitemap location: 'Sitemap: https://yoursite.com/sitemap.xml'",
                "Test your robots.txt using Google Search Console or online validators"
            ]
        },
        {
            category: "Technical SEO Fundamentals",
            tips: [
                "Ensure every page has a unique, descriptive title tag (50-60 characters)",
                "Add meta descriptions to all pages (150-160 characters)",
                "Use proper heading structure (H1, H2, H3) with descriptive text",
                "Implement canonical tags to prevent duplicate content issues",
                "Add structured data (JSON-LD) to help search engines understand your content"
            ]
        },
        {
            category: "Site Architecture",
            tips: [
                "Create an XML sitemap and submit it to search engines",
                "Ensure internal linking connects all important pages",
                "Keep URL structure simple and descriptive (avoid complex parameters)",
                "Implement breadcrumb navigation for better site structure",
                "Limit page depth - important content should be reachable within 3-4 clicks"
            ]
        },
        {
            category: "Content Accessibility",
            tips: [
                "Ensure critical content loads without JavaScript (progressive enhancement)",
                "Add descriptive alt text to all images",
                "Use semantic HTML elements (header, nav, main, article, section)",
                "Ensure fast loading times (aim for under 3 seconds)",
                "Make your site mobile-friendly and responsive"
            ]
        },
        {
            category: "Security & Access",
            tips: [
                "Use HTTPS with a valid SSL certificate",
                "Avoid blocking legitimate crawlers with security software",
                "Don't require login to access publicly viewable content",
                "Configure firewalls to allow known search engine crawler IPs",
                "Avoid aggressive rate limiting that blocks legitimate crawling"
            ]
        },
        {
            category: "Monitoring & Maintenance",
            tips: [
                "Regularly check Google Search Console for crawling errors",
                "Monitor server logs for crawler activity and errors",
                "Set up uptime monitoring to detect server issues",
                "Regularly validate your HTML markup",
                "Keep your CMS and plugins updated for security and performance"
            ]
        }
    ];

    return {
        targetUrl,
        pages: [],
        crawlDate: new Date(),
        userAgent: USER_AGENT,
        maxDepth: MAX_DEPTH,
        maxPages: MAX_PAGES,
        robotsFound: false,
        diagnostics,
        crawlErrors,
        crawlSuccess: false,
        crawlFailureReason: "Complete crawl failure",
        fallbackReport: {
            commonUncrawlableReasons: commonIssues,
            genericRecommendations: genericRecommendations,
            detectedIssues: crawlErrors.length > 0 ? crawlErrors : ["Unable to establish connection with the target URL"],
            crawlabilityTips: crawlabilityTips
        }
    };
}

// ==================== HTML REPORT GENERATION ====================
/**
 * Analyzes crawl results to generate a score, summaries, and issues.
 * @param {Array<object>} pages - Array of page data from the crawl.
 * @param {object} crawlData - Complete crawl data including diagnostics and errors.
 * @returns {object} - An analysis object with score, summary, issues, etc.
 */
function analyzeResults(pages, crawlData = {}) {
    const { crawlSuccess, diagnostics = {}, crawlErrors = [], fallbackReport } = crawlData;
    
    if (!crawlSuccess || pages.length === 0) {
        // Generate analysis for failed crawl
        return {
            score: 0,
            summary: [],
            issues: fallbackReport ? fallbackReport.detectedIssues : ["Complete crawl failure - unable to analyze any pages"],
            recommendations: fallbackReport ? fallbackReport.genericRecommendations : ["Check server accessibility and configuration"],
            isFallbackReport: true
        };
    }

    let score = 100;
    const summary = [];
    const issues = [];
    const recommendations = [];

    // Meta Robots Analysis
    const blockedPages = pages.filter(p => p.robotsDirectives && p.robotsDirectives.some(d => /noindex|nofollow/i.test(d)));
    if (blockedPages.length > 0) {
        issues.push(`Meta Robots Restrictions: ${blockedPages.length} page(s) have 'noindex' or 'nofollow' directives`);
        recommendations.push("Review meta robots directives to ensure important pages are indexable");
        score -= Math.min(20, blockedPages.length * 5);
    } else {
        summary.push("No problematic meta robots directives found");
    }

    // Alt Text Analysis
    const totalImgs = pages.reduce((acc, p) => acc + (p.totalImages || 0), 0);
    const totalAlts = pages.reduce((acc, p) => acc + (p.withAlt || 0), 0);
    const avgAltCoverage = totalImgs > 0 ? totalAlts / totalImgs : 1;
    
    if (avgAltCoverage < 0.8 && totalImgs > 0) {
        issues.push(`Image Alt Text: Only ${(avgAltCoverage * 100).toFixed(0)}% of images have alt text`);
        recommendations.push("Add descriptive alt text to all images for better accessibility and SEO");
        score -= 10;
    } else if (totalImgs > 0) {
        summary.push(`Good image alt text coverage: ${(avgAltCoverage * 100).toFixed(0)}%`);
    }

    // Structured Data Analysis
    const pagesWithSchema = pages.filter(p => (p.jsonLd || 0) > 0).length;
    const schemaPercentage = pages.length > 0 ? (pagesWithSchema / pages.length) : 0;
    
    if (schemaPercentage < 0.5) {
        issues.push(`Structured Data: Only ${pagesWithSchema}/${pages.length} pages have JSON-LD markup`);
        recommendations.push("Implement structured data markup to enhance search result appearance");
        score -= 15;
    } else {
        summary.push(`Good structured data coverage: ${pagesWithSchema}/${pages.length} pages`);
    }

    // Heading Structure Analysis
    const pagesMissingH1 = pages.filter(p => (p.h1Count || 0) === 0).length;
    if (pagesMissingH1 > 0) {
        issues.push(`Heading Structure: ${pagesMissingH1} page(s) missing H1 tags`);
        recommendations.push("Ensure every page has exactly one descriptive H1 tag");
        score -= Math.min(15, pagesMissingH1 * 3);
    } else {
        summary.push("All pages have proper H1 heading structure");
    }

    // JavaScript Dependency Analysis
    const jsHeavyPages = pages.filter(p => (p.noJsContent || 0) > 0).length;
    if (jsHeavyPages > 0) {
        issues.push(`JavaScript Dependency: ${jsHeavyPages} page(s) may have content requiring JavaScript`);
        recommendations.push("Ensure critical content is accessible without JavaScript");
        score -= 10;
    } else {
        summary.push("No excessive JavaScript dependency detected");
    }

    // Add crawl errors to issues if any
    if (crawlErrors.length > 0) {
        issues.push(`Crawl Errors: ${crawlErrors.length} error(s) encountered during crawling`);
        score -= Math.min(15, crawlErrors.length * 2);
    }
    
    return { 
        score: Math.max(0, Math.round(score)), 
        summary, 
        issues, 
        recommendations,
        isFallbackReport: false
    };
}

/**
 * Generates the complete HTML report as a string.
 * @param {object} crawlData - The complete data object from the crawl function.
 * @returns {string} - The full HTML page as a string.
 */
function generateHtmlReport(crawlData) {
    const { targetUrl, pages, crawlDate, userAgent, maxDepth, maxPages, robotsFound, diagnostics = {}, crawlErrors = [], fallbackReport } = crawlData;
    const analysis = analyzeResults(pages, crawlData);

    const formattedDate = crawlDate.toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    // Helper to truncate URLs for display
    const truncateUrl = (url, maxLength = 45) => {
        if (url.length <= maxLength) return url;
        return url.substring(0, maxLength - 3) + "...";
    };

    // Generate table rows from page data or fallback message
    const tableRows = pages.length > 0 ? pages.map((page, index) => {
        const altPercent = page.totalImages > 0 ? `${Math.round((page.withAlt / page.totalImages) * 100)}%` : "N/A";
        const jsonLdDisplay = page.jsonLd > 0 ? `✅ ${page.jsonLd}` : "❌ 0";
        const h1Display = page.h1Count > 0 ? `✅ ${page.h1Count}` : "❌ 0";
        const robotsDisplay = page.robotsDirectives.length > 0 ? page.robotsDirectives.join(", ") : "None";
        const noScriptDisplay = page.noJsContent > 0 ? `⚠️ ${page.noJsContent}` : "✅ 0";

        return `
            <tr>
                <td style="text-align: center; font-weight: bold;">${index + 1}</td>
                <td class="url-cell">
                    <a href="${page.fullUrl}" class="url-link" target="_blank">${truncateUrl(page.fullUrl)}</a>
                </td>
                <td>${page.withAlt}/${page.totalImages}</td>
                <td>${altPercent}</td>
                <td><span class="status-badge ${jsonLdDisplay.includes('✅') ? 'status-yes' : 'status-no'}">${jsonLdDisplay}</span></td>
                <td><span class="status-badge ${h1Display.includes('✅') ? 'status-yes' : 'status-no'}">${h1Display}</span></td>
                <td>${page.h2Count}/${page.h3Count}</td>
                <td>${robotsDisplay}</td>
                <td><span class="status-badge ${noScriptDisplay.includes('✅') ? 'status-yes' : 'status-no'}">${noScriptDisplay}</span></td>
            </tr>`;
    }).join('') : `<tr><td colspan="9" style="text-align: center; padding: 20px; color: #dc3545;">❌ No pages could be crawled. See diagnostics section below for details.</td></tr>`;

    const summaryItems = analysis.summary.map(item => `<li>✅ ${item}</li>`).join('');
    const issueItems = analysis.issues.map(item => `<li>⚠️ ${item}</li>`).join('');
    const recommendationItems = analysis.recommendations.map(item => `<li>💡 ${item}</li>`).join('');

    // Generate diagnostics section if available
    const diagnosticsSection = diagnostics && Object.keys(diagnostics).length > 0 ? `
        <div class="analysis-card" style="margin-top: 30px;">
            <h3>🔍 Technical Diagnostics</h3>
            <ul class="analysis-list">
                <li>URL Valid: ${diagnostics.urlValid ? '✅ Yes' : '❌ No'}</li>
                <li>Server Responsive: ${diagnostics.serverResponsive ? '✅ Yes' : '❌ No'}</li>
                <li>HTTP Accessible: ${diagnostics.httpAccessible ? '✅ Yes' : '❌ No'}</li>
                <li>HTTPS Accessible: ${diagnostics.httpsAccessible ? '✅ Yes' : '❌ No'}</li>
                <li>robots.txt Accessible: ${diagnostics.robotsAccessible ? '✅ Yes' : '❌ No'}</li>
                ${diagnostics.responseTime ? `<li>Response Time: ${diagnostics.responseTime}ms</li>` : ''}
                ${diagnostics.statusCode ? `<li>HTTP Status: ${diagnostics.statusCode}</li>` : ''}
                ${diagnostics.errors.length > 0 ? diagnostics.errors.map(err => `<li>❌ ${err}</li>`).join('') : ''}
            </ul>
        </div>` : '';

    // Generate fallback information section if this is a fallback report
    const fallbackSection = fallbackReport ? `
        <div class="analysis-card" style="margin-top: 30px; border-left-color: #dc3545;">
            <h3>⚠️ Common Reasons Why Sites Become Uncrawlable</h3>
            <ul class="analysis-list">
                ${fallbackReport.commonUncrawlableReasons.map(reason => `<li>• ${reason}</li>`).join('')}
            </ul>
        </div>
        
        <div class="crawlability-tips" style="margin-top: 40px;">
            <h2 style="color: #1a237e; margin-bottom: 30px; font-size: 1.8em; border-bottom: 3px solid #e9ecef; padding-bottom: 10px;">💡 Complete Guide to Improving Crawlability</h2>
            ${fallbackReport.crawlabilityTips.map(section => `
                <div class="tip-category" style="margin-bottom: 30px;">
                    <h3 style="color: #495057; margin-bottom: 15px; font-size: 1.3em; padding: 10px 0; border-bottom: 2px solid #28a745;">${section.category}</h3>
                    <ul class="tip-list" style="list-style: none; padding: 0;">
                        ${section.tips.map(tip => `
                            <li style="margin-bottom: 12px; padding: 12px 15px; background: #f8f9fa; border-left: 4px solid #28a745; border-radius: 4px;">
                                <span style="color: #28a745; margin-right: 8px;">✓</span>${tip}
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `).join('')}
        </div>` : '';

    // Return the full HTML document as a template literal
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Crawlability Analysis Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background: #f4f4f4; }
        .container { max-width: 1200px; margin: 20px auto; background: white; box-shadow: 0 0 20px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #1a237e 0%, #3f51b5 100%); color: white; padding: 40px 30px; text-align: center; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .header h1 { font-size: 2.5em; margin-bottom: 10px; }
        .header p { font-size: 1.2em; opacity: 0.9; }
        .report-meta { background: #f8f9fa; padding: 20px 30px; border-bottom: 1px solid #e9ecef; display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; }
        .meta-item { display: flex; align-items: center; gap: 10px; }
        .meta-label { font-weight: 600; color: #495057; }
        .meta-value { color: #1976d2; }
        .content { padding: 30px; }
        .score-section { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 40px; }
        .score-card { background: #fff; color: #1a237e; border: 1px solid #e9ecef; padding: 25px; border-radius: 12px; text-align: center; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
        .score-number { font-size: 3em; font-weight: bold; }
        .score-label { font-size: 1.1em; color: #495057; }
        .analysis-section { margin-bottom: 40px; }
        .analysis-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
        .analysis-card { background: #f8f9fa; border-radius: 12px; padding: 25px; border-left: 5px solid #28a745; }
        .analysis-card.issues { border-left-color: #dc3545; }
        .analysis-card.recs { border-left-color: #ffc107; }
        .analysis-card h3 { color: #495057; margin-bottom: 15px; font-size: 1.3em; }
        .analysis-list { list-style: none; padding: 0; }
        .analysis-list li { margin-bottom: 10px; padding: 8px 0; border-bottom: 1px solid #dee2e6; }
        .analysis-list li:last-child { border-bottom: none; }
        .table-section h2 { color: #1a237e; margin-bottom: 20px; font-size: 1.8em; border-bottom: 3px solid #e9ecef; padding-bottom: 10px; }
        .table-container { border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); overflow: hidden; }
        .data-table { width: 100%; border-collapse: collapse; background: white; font-size: 0.9em; }
        .data-table th { background: linear-gradient(135deg, #1a237e 0%, #3f51b5 100%); color: white; padding: 15px 12px; text-align: left; font-weight: 600; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .data-table td { padding: 12px; border-bottom: 1px solid #e9ecef; }
        .data-table tr:nth-child(even) { background: #f8f9fa; }
        .url-cell { max-width: 250px; word-break: break-all; }
        .url-link { color: #1976d2; text-decoration: none; font-weight: 500; }
        .url-link:hover { text-decoration: underline; }
        .status-badge { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; padding: 4px 8px; border-radius: 4px; font-size: 0.8em; font-weight: 600; }
        .status-yes { background: #d4edda; color: #155724; }
        .status-no { background: #f8d7da; color: #721c24; }
        .footer { background: #f8f9fa; padding: 20px 30px; text-align: center; color: #6c757d; border-top: 1px solid #e9ecef; }
        .failure-notice { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; padding: 15px; border-radius: 8px; margin-bottom: 30px; text-align: center; }
        @media (max-width: 992px) { .analysis-grid { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🕷️ Crawlability Analysis Report</h1>
            <p>Professional SEO Technical Audit</p>
        </div>
        
        <div class="report-meta">
            <div class="meta-item"><span class="meta-label">Target URL:</span><span class="meta-value">${targetUrl}</span></div>
            <div class="meta-item"><span class="meta-label">Report Date:</span><span class="meta-value">${formattedDate}</span></div>
            <div class="meta-item"><span class="meta-label">User Agent:</span><span class="meta-value">${userAgent}</span></div>
            <div class="meta-item"><span class="meta-label">Max Depth:</span><span class="meta-value">${maxDepth}</span></div>
            <div class="meta-item"><span class="meta-label">Max Pages:</span><span class="meta-value">${maxPages}</span></div>
            <div class="meta-item"><span class="meta-label">Robots.txt:</span><span class="meta-value">${robotsFound ? '✅ Found' : '❌ Not Found'}</span></div>
        </div>
        
        <div class="content">
            ${pages.length === 0 ? '<div class="failure-notice"><strong>⚠️ Crawl Failed:</strong> No pages could be successfully crawled. This report contains diagnostic information and general recommendations.</div>' : ''}
            
            <div class="score-section">
                <div class="score-card"><div class="score-number">${analysis.score}</div><div class="score-label">Crawlability Score</div></div>
                <div class="score-card"><div class="score-number">${pages.length}</div><div class="score-label">Pages Analyzed</div></div>
                <div class="score-card"><div class="score-number">${analysis.issues.length}</div><div class="score-label">Issues Found</div></div>
                <div class="score-card"><div class="score-number">${analysis.recommendations.length}</div><div class="score-label">Recommendations</div></div>
            </div>
            
            <div class="analysis-section">
                <div class="analysis-grid">
                    <div class="analysis-card">
                        <h3>✅ Positive Findings</h3>
                        <ul class="analysis-list">${summaryItems || '<li>No positive findings due to crawl failure.</li>'}</ul>
                    </div>
                    <div class="analysis-card issues">
                        <h3>⚠️ Issues Found</h3>
                        <ul class="analysis-list">${issueItems || '<li>No issues found. Excellent!</li>'}</ul>
                    </div>
                </div>
                ${recommendationItems ? `
                <div class="analysis-card recs" style="margin-top: 30px;">
                    <h3>💡 Recommendations</h3>
                    <ul class="analysis-list">${recommendationItems}</ul>
                </div>` : ''}
                ${diagnosticsSection}
                ${fallbackSection}
            </div>
            
            <div class="table-section">
                <h2>📊 Detailed Page Analysis</h2>
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>#</th><th>URL</th><th>Images (Alt/Total)</th><th>Alt %</th><th>JSON-LD</th><th>H1</th><th>H2/H3</th><th>Meta Robots</th><th>NoScript</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
            </div>
        </div>
        
        <div class="footer">
            <p>Generated by Dynamic Crawlability Analysis Tool</p>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Generates a PDF report from HTML content and saves it in a 'reports' directory.
 * @param {string} htmlContent - The complete HTML string for the report.
 * @param {string} fullPdfPath - The full path where the PDF should be saved.
 */
async function generatePdfReport(htmlContent, fullPdfPath) {
    let browser;
    try {
        const resolvedPath = path.resolve(fullPdfPath);
        const targetDir = path.dirname(resolvedPath);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();

        await page.setContent(htmlContent, {
            waitUntil: 'networkidle0'
        });

        await page.pdf({
            path: resolvedPath,
            format: 'A4',
            printBackground: true
        });

        console.log(`📄 PDF report generated: ${resolvedPath}`);
    } catch (error) {
        console.error(`❌ Failed to generate PDF report:`, error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// ==================== MAIN EXECUTION ====================
/**
 * The main function to run the entire process from the command line.
 */
async function main() {
    const target = process.argv[2];
    if (!target) {
        console.error("❌ Usage: node dynamic-report-generator.js <URL>");
        console.error("   Example: node dynamic-report-generator.js https://example.com");
        process.exit(1);
    }

    let dbClient;
    try {
        // 1. Connect to Database
        const { client, collection } = await connectToDb();
        dbClient = client;

        // 2. Crawl the website
        let crawlResult;
        try {
            crawlResult = await crawl(target);
        } catch (error) {
            console.error("❌ Critical crawl error:", error);
            // Generate fallback report
            crawlResult = generateFallbackReport(target, {}, [`Critical error: ${error.message}`]);
        }

        // 3. Always save results to MongoDB (even for failed crawls)
        if (crawlResult) {
            const insertResult = await collection.insertOne(crawlResult);
            console.log(`\n💾 Crawl report saved to MongoDB with ID: ${insertResult.insertedId}`);

            // 4. Always generate PDF Report (even for failed crawls)
            const htmlReport = generateHtmlReport(crawlResult);
            const reportFilename = `Crawlability_Report_${new URL(target).hostname}.pdf`;
            await generatePdfReport(htmlReport, reportFilename);
            
            if (crawlResult.crawlSuccess) {
                console.log(`✅ Successfully generated report for ${crawlResult.pages.length} pages.`);
            } else {
                console.log(`⚠️ Generated diagnostic report for failed crawl. See report for details.`);
            }
        } else {
            console.log("\n❌ Could not generate any report data.");
        }

    } catch (error) {
        console.error("\n❌ An unexpected error occurred during the process:", error);
        
        // Even if everything fails, try to generate a basic fallback report
        try {
            const fallbackData = generateFallbackReport(target, {}, [`System error: ${error.message}`]);
            const htmlReport = generateHtmlReport(fallbackData);
            const reportFilename = `Crawlability_Report_FAILED_${new URL(target).hostname}.pdf`;
            await generatePdfReport(htmlReport, reportFilename);
            console.log("📄 Generated fallback diagnostic report despite system errors.");
        } catch (fallbackError) {
            console.error("❌ Could not generate even a fallback report:", fallbackError);
        }
    } finally {
        // 5. Close the database connection
        if (dbClient) {
            await dbClient.close();
            console.log("\n🔌 MongoDB connection closed.");
        }
    }
}

// Exportable main function for external use
/**
 * Crawls a website, saves the data, generates a PDF report, and returns the file path.
 * @param {string} targetUrl The full URL of the website to crawl (e.g., 'https://example.com').
 * @param {string} pdfFilename The desired filename for the output PDF (e.g., 'report.pdf').
 * @returns {Promise<string|null>} The full path to the generated PDF file, or null if failed.
 */
export async function generateCrawlabilityPdfReport(targetUrl, pdfFilename) {
    if (!targetUrl || !pdfFilename) {
        console.error("❌ Both targetUrl and pdfFilename must be provided.");
        return null;
    }

    let dbClient;
    try {
        const { client, collection } = await connectToDb();
        dbClient = client;

        let crawlResult;
        try {
            crawlResult = await crawl(targetUrl);
        } catch (error) {
            console.error("❌ Crawl failed, generating fallback report:", error);
            crawlResult = generateFallbackReport(targetUrl, {}, [`Crawl error: ${error.message}`]);
        }

        if (crawlResult) {
            await collection.insertOne(crawlResult);

            const htmlReport = generateHtmlReport(crawlResult);
            await generatePdfReport(htmlReport, pdfFilename);

            return path.resolve(pdfFilename);
        } else {
            // Last resort fallback
            const fallbackData = generateFallbackReport(targetUrl, {}, ["Unable to perform crawl analysis"]);
            const htmlReport = generateHtmlReport(fallbackData);
            await generatePdfReport(htmlReport, pdfFilename);
            
            return path.resolve(pdfFilename);
        }
    } catch (error) {
        console.error("❌ An error occurred in generateCrawlabilityPdfReport:", error);
        
        // Try to generate a minimal fallback report even on system errors
        try {
            const fallbackData = generateFallbackReport(targetUrl, {}, [`System error: ${error.message}`]);
            const htmlReport = generateHtmlReport(fallbackData);
            await generatePdfReport(htmlReport, pdfFilename);
            
            return path.resolve(pdfFilename);
        } catch (fallbackError) {
            console.error("❌ Could not generate fallback report:", fallbackError);
            return null;
        }
    } finally {
        if (dbClient) {
            await dbClient.close();
        }
    }
}

// Export the PDF function for direct use if needed
export { generatePdfReport };