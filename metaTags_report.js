import { MongoClient } from 'mongodb';
import puppeteer from 'puppeteer';

class GEOReportGenerator {
  constructor(mongoUri, dbName = 'webdata', collectionName = 'extractions_3') {
    this.mongoUri = mongoUri;
    this.dbName = dbName;
    this.collectionName = collectionName;
  }

  async connectToMongo() {
    console.log('🔌 Connecting to MongoDB...');
    this.client = new MongoClient(this.mongoUri);
    await this.client.connect();
    console.log('✅ Connected to MongoDB successfully');
    this.db = this.client.db(this.dbName);
    this.collection = this.db.collection(this.collectionName);
    console.log(`📂 Using database: ${this.dbName}, collection: ${this.collectionName}`);
  }

  async disconnectFromMongo() {
    if (this.client) {
      await this.client.close();
    }
  }

  async fetchGEOData() {
    await this.connectToMongo();
    console.log('📊 Fetching documents from MongoDB...');
    const documents = await this.collection.find({}).toArray();
    await this.disconnectFromMongo();
    console.log(`📄 Found ${documents.length} documents`);
    
    if (documents.length === 0) {
      console.warn('⚠️  No documents found in the collection. Please check:');
      console.warn('   - Database name: webdata');
      console.warn('   - Collection name: extractions_2');
      console.warn('   - MongoDB connection string');
    }
    
    return documents;
  }

  analyzeData(documents) {
    const stats = {
      totalPages: documents.length,
      optimizedPages: [],
      needsOptimizationPages: [],
      pageImportanceDistribution: { high: 0, medium: 0, low: 0 },
      averageScores: {
        metaTags: 0,
        pageImportance: 0
      }
    };

    let totalMetaScore = 0;
    let totalImportanceScore = 0;

    documents.forEach(doc => {
      // Fixed path: ai.meta_tags.analysis.needs_optimization
      const needsOptimization = doc.ai?.meta_tags?.analysis?.needs_optimization || false;
      const metaScore = doc.ai?.scoring?.meta_tags?.score || 0;
      const importanceScore = doc.ai?.page_importance?.score || 0;

      // Categorize by optimization needs
      if (needsOptimization) {
        stats.needsOptimizationPages.push(doc);
      } else {
        stats.optimizedPages.push(doc);
      }

      // Categorize by page importance (0-1 scale)
      if (importanceScore >= 0.7) {
        stats.pageImportanceDistribution.high++;
      } else if (importanceScore >= 0.4) {
        stats.pageImportanceDistribution.medium++;
      } else {
        stats.pageImportanceDistribution.low++;
      }

      totalMetaScore += metaScore;
      totalImportanceScore += importanceScore;
    });

    // Convert scores: multiply by 100 for percentage display
    stats.averageScores.metaTags = Math.round((totalMetaScore / documents.length) * 100);
    stats.averageScores.pageImportance = ((totalImportanceScore / documents.length) * 100).toFixed(1);
    stats.optimizationRate = (100-(stats.optimizedPages.length / stats.totalPages) * 100).toFixed(1);

    return stats;
  }

  getPageImportanceLabel(score) {
    // Only show importance if score is actually meaningful (> 0)
    if (!score || score === 0) return { label: '', class: '' };
    if (score >= 0.7) return { label: 'High Value', class: 'importance-high' };
    if (score >= 0.4) return { label: 'Medium Value', class: 'importance-medium' };
    if (score >= 0.1) return { label: 'Low Value', class: 'importance-low' };
    return { label: '', class: '' };
  }

  generateHTMLReport(documents, stats) {
    const currentDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Sort documents by needs optimization first, then by importance
    const sortedDocuments = documents.sort((a, b) => {
      const aNeedsOpt = a.ai?.meta_tags?.analysis?.needs_optimization || false;
      const bNeedsOpt = b.ai?.meta_tags?.analysis?.needs_optimization || false;
      
      // If optimization status is different, prioritize pages that need optimization
      if (aNeedsOpt !== bNeedsOpt) {
        return bNeedsOpt ? 1 : -1;
      }
      
      // If same optimization status, sort by importance score
      const aImportance = a.ai?.page_importance?.score || 0;
      const bImportance = b.ai?.page_importance?.score || 0;
      return bImportance - aImportance;
    });

    const totalPages = sortedDocuments.length + 1; // +1 for executive summary

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GEO Audit Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Times New Roman', serif;
            line-height: 1.5;
            color: #333;
            background: white;
            font-size: 12pt;
        }
        
        .page {
            max-width: 210mm;
            margin: 0 auto;
            padding: 25mm 20mm;
            background: white;
            box-shadow: 0 0 20px rgba(0,0,0,0.1);
            page-break-after: always;
            position: relative;
            min-height: auto;
        }
        
        .page:last-child {
            page-break-after: avoid;
        }
        
        .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 3px solid #2c3e50;
        }
        
        .header h1 {
            font-size: 24pt;
            font-weight: bold;
            color: #2c3e50;
            margin-bottom: 8px;
        }
        
        .header .subtitle {
            font-size: 14pt;
            color: #7f8c8d;
            margin-bottom: 5px;
        }
        
        .header .date {
            color: #95a5a6;
            font-size: 11pt;
        }
        
        .page-header {
            text-align: center;
            margin-bottom: 25px;
            padding-bottom: 15px;
            border-bottom: 2px solid #3498db;
        }
        
        .page-header h1 {
            font-size: 18pt;
            color: #2c3e50;
            margin-bottom: 5px;
        }
        
        .page-header .page-subtitle {
            font-size: 12pt;
            color: #7f8c8d;
        }
        
        .executive-summary {
            background: #f8f9fa;
            padding: 20px;
            border-left: 5px solid #3498db;
            margin-bottom: 30px;
        }
        
        .executive-summary h2 {
            font-size: 16pt;
            color: #2c3e50;
            margin-bottom: 15px;
        }
        
        .stats-overview {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin: 20px 0;
        }
        
        .stat-box {
            text-align: center;
            padding: 15px;
            border: 1px solid #ddd;
            border-radius: 3px;
            background: #f8f9fa;
        }
        
        .stat-number {
            font-size: 18pt;
            font-weight: bold;
            color: #2c3e50;
            display: block;
        }
        
        .stat-label {
            font-size: 9pt;
            color: #7f8c8d;
            margin-top: 5px;
        }
        
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
            margin: 15px 0;
        }
        
        .summary-item {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px dotted #bdc3c7;
        }
        
        .summary-label {
            font-weight: 600;
            color: #34495e;
        }
        
        .summary-value {
            font-weight: bold;
            color: #2c3e50;
        }
        
        .summary-value.good { color: #27ae60; }
        .summary-value.needs-attention { color: #e74c3c; }
        
        /* Individual Page Analysis Styles */
        .url-section {
            background: #f8f9fa;
            padding: 15px;
            border-left: 5px solid #3498db;
            margin-bottom: 25px;
            border-radius: 3px;
        }
        
        .url-title {
            font-size: 14pt;
            font-weight: bold;
            color: #2c3e50;
            word-break: break-all;
            margin-bottom: 10px;
            line-height: 1.3;
        }
        
        .url-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 10px;
        }
        
        .score-badge {
            font-weight: bold;
            padding: 6px 12px;
            border-radius: 5px;
            font-size: 11pt;
            color: white;
            background: #27ae60;
        }
        
        .score-badge.needs-work { background: #e74c3c; }
        .score-badge.medium { background: #f39c12; }
        
        .importance-badge {
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 10pt;
            font-weight: 600;
        }
        
        .importance-high {
            background: #fee;
            color: #c53030;
            border: 1px solid #fed7d7;
        }
        
        .importance-medium {
            background: #fffbf0;
            color: #d69e2e;
            border: 1px solid #fbd38d;
        }
        
        .importance-low {
            background: #f0fff4;
            color: #2f855a;
            border: 1px solid #c6f6d5;
        }
        
        .issues-section {
            background: #fff8dc;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 25px;
            border: 1px solid #f5deb3;
        }
        
        .issues-section h3 {
            color: #d69e2e;
            margin-bottom: 10px;
            font-size: 13pt;
        }
        
        .no-issues {
            background: #f0fff4;
            border: 1px solid #c6f6d5;
            color: #2f855a;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 25px;
            text-align: center;
            font-weight: 600;
        }
        
        .issues-list {
            margin-left: 20px;
            margin-top: 8px;
        }
        
        .issues-list li {
            margin-bottom: 5px;
            line-height: 1.4;
        }
        
        /* NON-BREAKING SECTION STYLES */
        .meta-comparison-section {
            margin-bottom: 25px;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        
        .component-scores-section {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            border: 1px solid #ddd;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        
        /* Ensure tables don't break */
        .meta-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
            font-size: 11pt;
            background: white;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            page-break-inside: avoid;
            break-inside: avoid;
        }
        
        .meta-comparison-section h3 {
            color: #2c3e50;
            margin-bottom: 15px;
            font-size: 14pt;
            border-bottom: 1px solid #bdc3c7;
            padding-bottom: 5px;
        }

        .meta-table th, .meta-table td {
            border: 2px solid #34495e;
            padding: 12px;
            text-align: left;
            vertical-align: top;
            word-wrap: break-word;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        
        .meta-table td:first-child {
            width: 120px;
            font-weight: bold;
            font-size: 11pt;
            background: #f8f9fa;
        }

        .meta-table th {
            background: #34495e !important;
            color: white !important;
            font-weight: bold;
            text-align: center;
            font-size: 12pt;
            padding: 15px 12px;
        }

        .meta-table .before-column {
            background: #fff5f5;
            width: 40%;
        }

        .meta-table .after-column {
            background: #f0fff4;
            width: 40%;
        }

        .meta-table .empty-field {
            color: #999;
            font-style: italic;
            text-align: center;
        }
        
        .meta-content {
            line-height: 1.4;
            max-width: 100%;
            word-wrap: break-word;
            overflow-wrap: break-word;
            font-size: 11pt;
            color: #333;
        }
        
        .component-scores-section h3 {
            color: #2c3e50;
            margin-bottom: 15px;
            font-size: 13pt;
        }
        
        .component-score {
            margin-bottom: 12px;
            padding: 10px;
            background: white;
            border-radius: 3px;
            border: 1px solid #e9ecef;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        
        .component-score-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5px;
        }
        
        .component-name {
            font-weight: bold;
            color: #2c3e50;
            font-size: 11pt;
        }
        
        .component-score-value {
            font-weight: bold;
            color: #2c3e50;
            font-size: 11pt;
            padding: 2px 8px;
            background: #e9ecef;
            border-radius: 3px;
        }
        
        .component-reasoning {
            font-size: 10pt;
            color: #666;
            line-height: 1.4;
            margin-top: 5px;
        }
        
        .footer {
            position: absolute;
            bottom: 15mm;
            left: 20mm;
            right: 20mm;
            text-align: center;
            font-size: 10pt;
            color: #7f8c8d;
            border-top: 1px solid #bdc3c7;
            padding-top: 10px;
        }
        
        @media print {
            .page {
                box-shadow: none;
                margin: 0;
                padding: 20mm 15mm;
                min-height: auto;
            }
            
            .footer {
                position: fixed;
                bottom: 15mm;
            }
            
            * {
                -webkit-print-color-adjust: exact !important;
                color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            
            .meta-table th {
                background: #34495e !important;
                color: white !important;
            }
            
            /* Enhanced print-specific non-breaking rules */
            .meta-comparison-section,
            .component-scores-section,
            .meta-table,
            .component-score {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
            }
            
            /* Force page break before sections if they would be split */
            .meta-comparison-section {
                orphans: 3;
                widows: 3;
            }
            
            .component-scores-section {
                orphans: 3;
                widows: 3;
            }
        }
    </style>
</head>
<body>
    <!-- Page 1: Executive Summary -->
    <div class="page">
        <div class="header">
            <h1>GEO Audit Report</h1>
            <div class="subtitle">Website Analysis & Optimization Report</div>
            <div class="date">Generated on ${currentDate}</div>
        </div>
        
        <div class="executive-summary">
            <h2>Executive Summary</h2>
            <p>Comprehensive GEO analysis completed for your website. Our AI-powered optimization engine has analyzed ${stats.totalPages} pages and generated improved meta tags where needed. The analysis shows ${stats.optimizationRate}% of pages are already well-optimized.</p>
            
            <div class="stats-overview">
                <div class="stat-box">
                    <span class="stat-number">${stats.totalPages}</span>
                    <div class="stat-label">Total Pages Analyzed</div>
                </div>
                <div class="stat-box">
                    <span class="stat-number">${stats.optimizedPages.length}</span>
                    <div class="stat-label">Already Optimized</div>
                </div>
                <div class="stat-box">
                    <span class="stat-number">${stats.needsOptimizationPages.length}</span>
                    <div class="stat-label">Need Optimization</div>
                </div>
            </div>
            
            <div class="summary-grid">
                <div class="summary-item">
                    <span class="summary-label">Optimization Potential:</span>
                    <span class="summary-value ${stats.optimizationRate >= 80 ? 'good' : 'needs-attention'}">${stats.optimizationRate}%</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">Average Meta Score:</span>
                    <span class="summary-value ${stats.averageScores.metaTags >= 70 ? 'good' : 'needs-attention'}">${stats.averageScores.metaTags}/100</span>
                </div>
            </div>
        </div>
        
    </div>
    
    ${this.generateIndividualPagesHTML(sortedDocuments, totalPages)}
</body>
</html>`;
  }

  generateIndividualPagesHTML(documents, totalPages) {
    let html = '';
    
    documents.forEach((doc, index) => {
      const pageNumber = index + 2; // +2 because first page is executive summary
      html += this.generateSinglePageHTML(doc, pageNumber, totalPages);
    });
    
    return html;
  }

  generateSinglePageHTML(doc, pageNumber, totalPages) {
    const url = doc.url || 'URL not available';
    const metaScore = Math.round((doc.ai?.scoring?.meta_tags?.score || 0) * 100);
    const importanceScore = doc.ai?.page_importance?.score || 0;
    const importance = this.getPageImportanceLabel(importanceScore);
    const needsOptimization = doc.ai?.meta_tags?.analysis?.needs_optimization || false;
    const existingIssues = doc.ai?.meta_tags?.analysis?.existing_issues || [];
    const includeIssues = doc.ai?.meta_tags?.analysis?.include || [];
    
    // Current tags from metaTags field
    const currentTags = doc.metaTags || {};
    // Optimized tags from ai.meta_tags.generated_tags
    const optimizedTags = doc.ai?.meta_tags?.generated_tags || {};
    
    const componentScores = doc.ai?.scoring?.meta_tags?.component_scores || {};
    
    let scoreClass = 'good';
    if (metaScore < 50) scoreClass = 'needs-work';
    else if (metaScore < 70) scoreClass = 'medium';

    return `
    <!-- Page ${pageNumber}: Individual URL Analysis -->
    <div class="page">
        <div class="page-header">
            <h1>GEO Analysis Report</h1>
            <div class="page-subtitle">Individual Page Analysis</div>
        </div>
        
        <div class="url-section">
            <div class="url-title">${url}</div>
            <div class="url-meta">
                <div>
                    ${importance.label ? `<span class="importance-badge ${importance.class}">${importance.label}</span>` : ''}
                </div>
                <span class="score-badge ${scoreClass}">Score: ${metaScore}/100</span>
            </div>
        </div>
        
        ${this.generateIssuesHTML(existingIssues, includeIssues, needsOptimization)}
        
        <div class="meta-comparison-section">
            <h3>📊 Meta Tags Comparison</h3>
            ${this.generateMetaComparisonTable(currentTags, optimizedTags)}
        </div>
        
        ${Object.keys(componentScores).length > 0 ? this.generateComponentScoresHTML(componentScores) : ''}
    </div>`;
  }

  // FIXED: This method now correctly checks for issues first
// In the GEOReportGenerator class...

  generateIssuesHTML(existingIssues, includeIssues, needsOptimization) {
    const allIssues = [...existingIssues, ...includeIssues];

    // If any specific issues are listed, display them.
    if (allIssues.length > 0) {
      return `
        <div class="issues-section">
            <h3>⚠️ Issues Found & Recommendations</h3>
            <ul class="issues-list">
                ${allIssues.map(issue => `<li>${issue}</li>`).join('')}
            </ul>
        </div>`;
    }

    // If no specific issues, but optimization is still needed, show a specific message.
    if (needsOptimization) {
      return `
        <div class="issues-section">
            <h3>⚠️ Recommendations</h3>
            <p>This page's meta tags are generally acceptable but could be improved for better keyword alignment and clarity. See the AI-optimized version for suggestions.</p>
        </div>`;
    }
    
    // If no issues and no optimization needed, show the success message.
    return `
        <div class="no-issues">
            <strong>✅ Status: No Issues Found</strong><br>
            This page is well optimized.
        </div>`;
  }

// In the GEOReportGenerator class...

// FINAL FIX: This method uses a more robust normalization to handle spaces and other variations.
generateMetaComparisonTable(currentTags, optimizedTags) {
    // Helper to normalize field names (e.g., 'OG Title', 'og_title', 'Description' -> 'ogtitle', 'description')
    const normalize = (field) => field.toLowerCase().replace(/[:_\s-]/g, '');

    const allFields = new Set([...Object.keys(currentTags), ...Object.keys(optimizedTags)]);
    const processedFields = new Set(); // Keep track of normalized fields already added

    if (allFields.size === 0) {
        return '<p style="text-align: center; color: #666; font-style: italic;">No meta tag data available for comparison.</p>';
    }

    let tableRows = '';

    // Use a stable sort to make the output order predictable
    const sortedFields = Array.from(allFields).sort();

    sortedFields.forEach(field => {
        const normalizedField = normalize(field);
        // Skip if we've already created a row for this normalized field
        if (processedFields.has(normalizedField)) {
            return;
        }

        // Find the corresponding keys in both original objects using the same normalization
        const currentKey = Object.keys(currentTags).find(k => normalize(k) === normalizedField);
        const optimizedKey = Object.keys(optimizedTags).find(k => normalize(k) === normalizedField);

        const currentValue = currentKey ? currentTags[currentKey] : undefined;
        const optimizedValue = optimizedKey ? optimizedTags[optimizedKey] : undefined;

        // Skip if there's no data at all for this tag
        if (!currentValue && !optimizedValue) return;

        // Mark this normalized field as processed
        processedFields.add(normalizedField);

        // Format field name for display
        const displayKey = optimizedKey || currentKey || field;
        let displayField;
        if (displayKey.toLowerCase().startsWith('og')) {
            displayField = 'OG ' + displayKey.substring(2).replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
            displayField = displayField.replace(/\b\w/g, l => l.toUpperCase());
        } else {
            displayField = displayKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }

        tableRows += `
            <tr>
                <td><strong>${displayField}</strong></td>
                <td class="before-column">
                    ${currentValue ? `<div class="meta-content">${currentValue}</div>` : '<span class="empty-field">Not set</span>'}
                </td>
                <td class="after-column">
                    ${optimizedValue ? `<div class="meta-content">${optimizedValue}</div>` : '<span class="empty-field">No optimization suggested</span>'}
                </td>
            </tr>`;
    });

    if (processedFields.size === 0) {
        return '<p style="text-align: center; color: #666; font-style: italic;">No meta tag data available for comparison.</p>';
    }
    
    return `
        <table class="meta-table">
            <thead>
                <tr>
                    <th>Meta Tag Field</th>
                    <th class="before-column">📍 Current Version</th>
                    <th class="after-column">✨ AI Optimized Version</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows}
            </tbody>
        </table>`;
}

  generateComponentScoresHTML(componentScores) {
    let html = `
      <div class="component-scores-section">
        <h3>🔍 Detailed Scoring Breakdown</h3>`;
    
    Object.entries(componentScores).forEach(([component, data]) => {
      const score = Math.round((data.score || 0) * 100);
      const reasoning = data.reasoning || 'No reasoning provided';
      const displayComponent = component.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      
      html += `
        <div class="component-score">
          <div class="component-score-header">
            <span class="component-name">${displayComponent}</span>
            <span class="component-score-value">${score}/100</span>
          </div>
          <div class="component-reasoning">${reasoning}</div>
        </div>`;
    });
    
    html += '</div>';
    return html;
  }

async generatePDFReport(outputPath) { // MODIFICATION 1: Removed default value
    try {
      // ADDITION: Add validation to ensure a path is provided
      if (!outputPath) {
        throw new Error('An output path for the PDF report must be provided.');
      }

      console.log('📊 Starting data analysis...');
      
      // Fetch data from MongoDB
      const documents = await this.fetchGEOData();
      
      if (documents.length === 0) {
        throw new Error('No documents found in MongoDB collection');
      }
      
      // Analyze the data
      const stats = this.analyzeData(documents);
      console.log('📈 Analysis complete:', {
        totalPages: stats.totalPages,
        optimized: stats.optimizedPages.length,
        needsOptimization: stats.needsOptimizationPages.length,
        optimizationRate: stats.optimizationRate + '%'
      });
      
      // Generate HTML
      console.log('🔧 Generating HTML content...');
      const htmlContent = this.generateHTMLReport(documents, stats);
      console.log('✅ HTML content generated');
      
      // Generate PDF using Puppeteer
      console.log('🎨 Converting HTML to PDF...');
      const browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor'
        ]
      });
      
      const page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
      
      const pdf = await page.pdf({
        path: outputPath, 
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: false,
        margin: { 
          top: '20mm', 
          bottom: '25mm', 
          left: '15mm', 
          right: '15mm' 
        }
      });
      
      await browser.close();
      console.log(`✅ PDF report generated successfully: ${outputPath}`);
      return pdf;
      
    } catch (error) {
      console.error('❌ Error generating PDF report:', error.message);
      console.error('Full error:', error);
      throw error;
    }
  }
}

// Usage example:
async function generateReport_1(reportPath) { 
  console.log('🚀 Starting GEO report generation...');
  
  // ADDITION: Validate the incoming path
  if (!reportPath) {
    console.error('❌ Error: No report path specified for generateReport_1.');
    return; // Exit if no path is given
  }

  const mongoUri = process.env.MONGODB_URI; // Replace with your MongoDB URI
  const generator = new GEOReportGenerator(mongoUri);
  
  try {
    console.log(`📊 Generating PDF report at: ${reportPath}`);
    // MODIFICATION 3: Pass the dynamic `reportPath` to the method
    await generator.generatePDFReport(reportPath); 
    console.log('✅ Report generation completed successfully!');
    console.log(`📄 Report saved as: ${reportPath}`); // Use the dynamic path in the log
  } catch (error) {
    console.error('❌ Failed to generate report:', error);
    console.error('Stack trace:', error.stack);
  }
}



// Export for use in other modules
export { generateReport_1 };

// Uncomment to run directly
//generateReport_1();