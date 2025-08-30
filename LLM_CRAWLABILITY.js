// crawlability-checker.js

// ==================== IMPORTS ====================

import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import robotsParser from "robots-parser";

// ==================== CONFIG ====================
const DEFAULT_MAX_DEPTH = 1;
const DEFAULT_MAX_PAGES = 1;
const USER_AGENT = "LLM-Crawlability-Checker";

// ==================== HELPERS ====================

// Normalize URLs (remove hash, standardize format)
function normalizeUrl(u) {
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return u;
  }
}

// Truncate URL for better display
function truncateUrl(url, maxLength = 60) {
  if (url.length <= maxLength) return url;
  const domain = new URL(url).hostname;
  const path = new URL(url).pathname;

  if (domain.length + path.length <= maxLength) {
    return domain + path;
  }

  const availableSpace = maxLength - domain.length - 3; // 3 for "..."
  return domain + path.substring(0, availableSpace) + "...";
}

// Fetch HTML with timeout
async function fetchHTML(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { redirect: "follow", signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Failed to fetch ${url}`);
    return await res.text();
  } catch (err) {
    clearTimeout(timeout);
    console.error(`Fetch error for ${url}:`, err.message);
    return null;
  }
}

// Get robots.txt and parse
async function getRobots(baseUrl) {
  try {
    const robotsUrl = new URL("/robots.txt", baseUrl).href;
    const res = await fetch(robotsUrl);
    if (!res.ok) return null;
    const txt = await res.text();
    return robotsParser(robotsUrl, txt);
  } catch {
    return null;
  }
}

// ==================== MAIN ANALYSIS FUNCTION ====================

/**
 * Analyzes website crawlability and returns detailed metrics
 * @param {string} targetUrl - The URL to analyze
 * @param {Object} options - Configuration options
 * @param {number} options.maxDepth - Maximum crawl depth (default: 1)
 * @param {number} options.maxPages - Maximum pages to analyze (default: 1)
 * @param {boolean} options.verbose - Enable console logging (default: false)
 * @returns {Promise<Object>} Analysis results with metrics and scores
 */
export async function analyzeCrawlability(targetUrl, options = {}) {
  const {
    maxDepth = DEFAULT_MAX_DEPTH,
    maxPages = DEFAULT_MAX_PAGES,
    verbose = false
  } = options;

  const visited = new Set();
  const toVisit = [{ url: normalizeUrl(targetUrl), depth: 0 }];
  const pages = [];

  if (verbose) {
    console.log("🕷️  CRAWLABILITY CHECKER");
    console.log("=".repeat(50));
    console.log(`🎯 Target: ${targetUrl}`);
    console.log(`📊 Max Depth: ${maxDepth} | Max Pages: ${maxPages}`);
    console.log("=".repeat(50));
  }

  // Fetch robots.txt
  const robots = await getRobots(targetUrl);
  const robotsInfo = {
    found: !!robots,
    allowed: robots ? robots.isAllowed(targetUrl, USER_AGENT) : true
  };

  if (verbose) {
    if (robots) {
      console.log("📄 Found robots.txt — interpreting rules...");
      console.log(`   • User-agent rules for "${USER_AGENT}": ${robotsInfo.allowed ? "✅ Allowed" : "❌ Blocked"}`);
    } else {
      console.log("ℹ️  No robots.txt found — all pages assumed crawlable unless meta tags say otherwise.");
    }
    console.log();
  }

  // Crawl pages
  while (toVisit.length && visited.size < maxPages) {
    const { url, depth } = toVisit.shift();
    if (visited.has(url) || depth > maxDepth) continue;

    if (robots && !robots.isAllowed(url, USER_AGENT)) {
      if (verbose) console.log(`🚫 Skipping (blocked by robots.txt): ${truncateUrl(url)}`);
      continue;
    }

    visited.add(url);
    if (verbose) console.log(`🔍 Crawling [${visited.size.toString().padStart(2)}/${maxPages}]: ${truncateUrl(url)}`);

    const html = await fetchHTML(url);
    if (!html) continue;

    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Collect metrics
    const images = Array.from(doc.querySelectorAll("img"));
    const totalImages = images.length;
    const withAlt = images.filter(img => img.hasAttribute("alt") && img.getAttribute("alt").trim() !== "").length;
    const jsonLd = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).length;
    const robotsMeta = Array.from(doc.querySelectorAll('meta[name="robots"]')).map(m => m.content.trim());
    const h1Count = doc.querySelectorAll("h1").length;
    const h2Count = doc.querySelectorAll("h2").length;
    const h3Count = doc.querySelectorAll("h3").length;
    const noJsContent = doc.querySelectorAll("noscript").length;

    pages.push({
      url: url,
      displayUrl: truncateUrl(url, 40),
      totalImages,
      withAlt,
      altTextCoverage: totalImages > 0 ? (withAlt / totalImages) : 1,
      jsonLd,
      robotsDirectives: robotsMeta,
      h1Count,
      h2Count,
      h3Count,
      noJsContent
    });

    // Extract internal links for deeper crawling
    const links = Array.from(doc.querySelectorAll("a[href]"))
      .map(a => {
        try {
          return normalizeUrl(new URL(a.href, targetUrl).href);
        } catch {
          return null;
        }
      })
      .filter(href => href && href.startsWith(targetUrl) && !visited.has(href));

    links.forEach(l => toVisit.push({ url: l, depth: depth + 1 }));
  }

  // Calculate analysis scores and metrics
  const analysis = calculateAnalysisScores(pages, verbose);

  return {
    targetUrl,
    robotsInfo,
    pagesAnalyzed: pages.length,
    pages: pages.map(page => ({
      url: page.url,
      displayUrl: page.displayUrl,
      metrics: {
        images: {
          total: page.totalImages,
          withAlt: page.withAlt,
          altCoverage: Math.round(page.altTextCoverage * 100)
        },
        structuredData: {
          jsonLdCount: page.jsonLd
        },
        headings: {
          h1: page.h1Count,
          h2: page.h2Count,
          h3: page.h3Count
        },
        robotsDirectives: page.robotsDirectives,
        noScriptElements: page.noJsContent
      }
    })),
    analysis
  };
}

// ==================== ANALYSIS SCORING ====================

function calculateAnalysisScores(pages, verbose = false) {
  let score = 100;
  const issues = [];
  const recommendations = [];

  if (verbose) {
    console.log("\n📊 CRAWLABILITY ANALYSIS");
    console.log("=".repeat(50));
  }

  // Meta robots restrictions
  const blockedPages = pages.filter(p => p.robotsDirectives.some(d => /noindex|nofollow/i.test(d)));
  if (blockedPages.length > 0) {
    const issue = `Meta robots restrictions found on ${blockedPages.length} pages`;
    issues.push(issue);
    recommendations.push("Review meta robots tags that may prevent indexing");
    score -= 20;
    if (verbose) {
      console.log(`⚠️  META ROBOTS RESTRICTIONS (${blockedPages.length} pages)`);
      blockedPages.forEach(p => console.log(`   📄 ${p.displayUrl} → ${p.robotsDirectives.join(", ")}`));
    }
  } else if (verbose) {
    console.log("✅ META ROBOTS: No restrictions found");
  }

  // Alt text coverage
  const avgAltCoverage = pages.reduce((acc, p) => acc + p.altTextCoverage, 0) / pages.length;
  if (avgAltCoverage < 0.8) {
    const coverage = Math.round(avgAltCoverage * 100);
    const issue = `Low alt text coverage: ${coverage}%`;
    issues.push(issue);
    recommendations.push("Add descriptive alt text to images for better accessibility and SEO");
    score -= 10;
    if (verbose) console.log(`⚠️  IMAGE ALT TEXT: ${coverage}% coverage`);
  } else if (verbose) {
    console.log(`✅ IMAGE ALT TEXT: ${Math.round(avgAltCoverage * 100)}% coverage (Good!)`);
  }

  // JSON-LD structured data
  const pagesWithSchema = pages.filter(p => p.jsonLd > 0).length;
  if (pagesWithSchema === 0) {
    issues.push("No structured data (JSON-LD) found");
    recommendations.push("Add schema markup to improve search visibility");
    score -= 10;
    if (verbose) console.log("⚠️  STRUCTURED DATA: No JSON-LD detected");
  } else if (verbose) {
    console.log(`✅ STRUCTURED DATA: ${pagesWithSchema}/${pages.length} pages have JSON-LD`);
  }

  // Heading structure
  const pagesMissingH1 = pages.filter(p => p.h1Count === 0).length;
  if (pagesMissingH1 > 0) {
    issues.push(`${pagesMissingH1} pages missing H1 tags`);
    recommendations.push("Ensure all pages have proper H1 heading structure");
    score -= 10;
    if (verbose) console.log(`⚠️  HEADING STRUCTURE: ${pagesMissingH1} pages missing H1 tags`);
  } else if (verbose) {
    console.log("✅ HEADING STRUCTURE: All pages have H1 tags");
  }

  // JavaScript dependency
  const jsHeavyPages = pages.filter(p => p.noJsContent > 0).length;
  if (jsHeavyPages > 0) {
    issues.push(`${jsHeavyPages} pages have NoScript content`);
    recommendations.push("Review JavaScript dependencies that may limit crawler access");
    score -= 10;
    if (verbose) console.log(`⚠️  JAVASCRIPT DEPENDENCY: ${jsHeavyPages} pages have NoScript content`);
  } else if (verbose) {
    console.log("✅ JAVASCRIPT: No major JS-only content detected");
  }

  const rating = score >= 90 ? "Excellent" : score >= 70 ? "Good" : "Needs Work";
  
  if (verbose) {
    console.log("\n" + "=".repeat(50));
    console.log(`🎯 OVERALL CRAWLABILITY SCORE: ${score}/100`);
    console.log(`📊 RATING: ${rating}`);
    console.log("=".repeat(50));
  }

  return {
    score,
    rating,
    issues,
    recommendations,
    metrics: {
      avgAltTextCoverage: Math.round(avgAltCoverage * 100),
      pageWithStructuredData: pagesWithSchema,
      pageMissingH1: pagesMissingH1,
      pageWithJSScript: jsHeavyPages,
      pageWithMetaRobots: blockedPages.length
    }
  };
}

// ==================== CLI SUPPORT ====================

// Support for running as CLI script
if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2];
  if (!target) {
    console.error("❌ Usage: node crawlability-checker.js <URL>");
    process.exit(1);
  }

  analyzeCrawlability(target, { verbose: true })
    .then(result => {
      console.log("\n📋 ANALYSIS COMPLETE");
      console.log("=".repeat(50));
      console.log(`Final Score: ${result.analysis.score}/100`);
      console.log(`Rating: ${result.analysis.rating}`);
      if (result.analysis.issues.length > 0) {
        console.log("\nKey Issues:");
        result.analysis.issues.forEach(issue => console.log(`• ${issue}`));
      }
    })
    .catch(err => {
      console.error("❌ Analysis failed:", err.message);
      process.exit(1);
    });
}