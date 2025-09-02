import { MongoClient } from 'mongodb';
import { htmlToPdf } from './utils/htmlToPdf.js';

class StructuredDataReportGenerator {
  constructor(mongoUri, dbName = 'webdata', collectionName = 'extractions_3', mongoOptions = {}) {
    this.mongoUri = mongoUri;
    this.dbName = dbName;
    this.collectionName = collectionName;
    this.mongoOptions = mongoOptions;
  }

  async connectToMongo() {
    console.log('🔌 Connecting to MongoDB...');
    this.client = new MongoClient(this.mongoUri, this.mongoOptions);
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

  async fetchStructuredData() {
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
        structuredData: 0,
        pageImportance: 0
      }
    };

    let totalStructuredScore = 0;
    let totalImportanceScore = 0;

    documents.forEach(doc => {
      // Fixed logic: if needs_optimization is true, it goes to needsOptimizationPages
      // if needs_optimization is false or undefined, it's considered optimized
      const needsOptimization = doc.ai?.structured_data?.analysis?.needs_optimization === true;
      const structuredScore = doc.ai?.scoring?.structured_data?.score || 0;
      const importanceScore = doc.ai?.page_importance?.score || 0;

      // Categorize by optimization needs - FIXED LOGIC
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

      totalStructuredScore += structuredScore;
      totalImportanceScore += importanceScore;
    });

    // Convert scores: multiply by 100 for percentage display
    stats.averageScores.structuredData = Math.round((totalStructuredScore / documents.length) * 100);
    stats.averageScores.pageImportance = ((totalImportanceScore / documents.length) * 100).toFixed(1);
    
    // FIXED: Calculate optimization rate correctly
    stats.optimizationRate = (100-(stats.optimizedPages.length / stats.totalPages) * 100).toFixed(1);
    console.log('📈 Optimization lenght : ',stats.optimizationRate.length);
    console.log('📈 Documentation lenght : ',stats.totalPages);
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

    // Show all pages - sort by needs optimization first, then by importance
    const allPages = documents.sort((a, b) => {
      const aNeedsOpt = a.ai?.structured_data?.analysis?.needs_optimization === true;
      const bNeedsOpt = b.ai?.structured_data?.analysis?.needs_optimization === true;
      
      // If optimization status is different, prioritize pages that need optimization
      if (aNeedsOpt !== bNeedsOpt) {
        return bNeedsOpt ? 1 : -1;
      }
      
      // If same optimization status, sort by importance score
      const aImportance = a.ai?.page_importance?.score || 0;
      const bImportance = b.ai?.page_importance?.score || 0;
      return bImportance - aImportance;
    });

    const totalPages = Math.ceil(allPages.length / 2) + 1; // Changed to 2 pages per PDF page

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Structured Data Audit Report</title>
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
            min-height: 297mm;
            margin: 0 auto;
            padding: 25mm 20mm;
            background: white;
            box-shadow: 0 0 20px rgba(0,0,0,0.1);
            page-break-after: always;
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
        
        .executive-summary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 25px;
            border-radius: 8px;
            margin-bottom: 30px;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
        }
        
        .executive-summary h2 {
            font-size: 18pt;
            margin-bottom: 15px;
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        
        .executive-summary p {
            font-size: 13pt;
            margin-bottom: 20px;
            opacity: 0.95;
        }
        
        .stats-overview {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
            margin: 20px 0;
        }
        
        .stat-box {
            text-align: center;
            padding: 20px;
            background: rgba(255, 255, 255, 0.15);
            border-radius: 8px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .stat-number {
            font-size: 28pt;
            font-weight: bold;
            display: block;
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        
        .stat-label {
            font-size: 10pt;
            margin-top: 8px;
            opacity: 0.9;
        }
        
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
            margin: 20px 0;
        }
        
        .summary-item {
            display: flex;
            justify-content: space-between;
            padding: 12px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.3);
        }
        
        .summary-label {
            font-weight: 600;
        }
        
        .summary-value {
            font-weight: bold;
            padding: 4px 12px;
            border-radius: 20px;
            background: rgba(255, 255, 255, 0.2);
        }
        
        .summary-value.good { 
            background: rgba(46, 204, 113, 0.8);
        }
        .summary-value.needs-attention { 
            background: rgba(231, 76, 60, 0.8);
        }
        
        .section {
            margin-bottom: 35px;
            page-break-inside: avoid;
        }
        
        .section h2 {
            font-size: 18pt;
            margin-bottom: 20px;
            color: #2c3e50;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        
        .section-subtitle {
            font-size: 12pt;
            color: #7f8c8d;
            margin-bottom: 20px;
            padding: 0 5px;
            font-style: italic;
        }
        
        .page-analysis {
            margin-bottom: 40px;
            border-radius: 8px;
            overflow: hidden;
            page-break-inside: avoid;
            width: 100%;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            border: 1px solid #e9ecef;
            min-height: 400px;
        }
        
        .page-header {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            padding: 12px 15px;
            border-bottom: 1px solid #ddd;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .page-url {
            font-weight: bold;
            color: #2c3e50;
            font-size: 11pt;
            max-width: 60%;
            word-break: break-all;
        }
        
        .page-score {
            font-weight: bold;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 10pt;
            color: white;
            background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%);
            box-shadow: 0 2px 4px rgba(39, 174, 96, 0.3);
        }
        
        .page-score.needs-work { 
            background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
            box-shadow: 0 2px 4px rgba(231, 76, 60, 0.3);
        }
        .page-score.medium { 
            background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%);
            box-shadow: 0 2px 4px rgba(243, 156, 18, 0.3);
        }
        
        .page-importance {
            margin-left: 10px;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 9pt;
            font-weight: 600;
        }
        
        .importance-high {
            background: linear-gradient(135deg, #fee 0%, #fdd 100%);
            color: #c53030;
            border: 1px solid #fed7d7;
        }
        
        .importance-medium {
            background: linear-gradient(135deg, #fffbf0 0%, #fef5e7 100%);
            color: #d69e2e;
            border: 1px solid #fbd38d;
        }
        
        .importance-low {
            background: linear-gradient(135deg, #f0fff4 0%, #e6fffa 100%);
            color: #2f855a;
            border: 1px solid #c6f6d5;
        }
        
        .page-content {
            padding: 15px;
            background: #fafafa;
            min-height: 350px;
        }
        
        .issues-section {
            background: linear-gradient(135deg, #fff8dc 0%, #fef7cd 100%);
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 15px;
            border-left: 4px solid #f39c12;
        }
        
        .no-issues {
            color: #2f855a;
            font-weight: 600;
        }
        
        .schema-comparison {
            margin: 15px 0;
        }
        
        .schema-table {
            width: 100%;
            border-collapse: collapse;
            margin: 10px 0;
            font-size: 10pt;
            table-layout: fixed;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .schema-table th, .schema-table td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
            vertical-align: top;
            word-wrap: break-word;
            word-break: break-word;
            overflow: visible;
        }
        
        .schema-table td:first-child {
            width: 50%;
            font-weight: bold;
            font-size: 9pt;
        }

        .schema-table th {
            background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
            color: white;
            font-weight: bold;
            font-size: 12pt;
            text-shadow: 0 1px 2px rgba(0,0,0,0.5);
            padding: 12px 8px;
            text-align: center;
        }

        .schema-table .before-column {
            background: linear-gradient(135deg, #fff5f5 0%, #fed7d7 100%);
            border-color: #fed7d7;
            width: 50%;
            color: #000;
        }

        .schema-table .after-column {
            background: linear-gradient(135deg, #f0fff4 0%, #c6f6d5 100%);
            border-color: #c6f6d5;
            width: 50%;
            color: #000;
        }

        .schema-table .empty-field {
            color: #999;
            font-style: italic;
        }

        .schema-code {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 4px;
            padding: 12px;
            font-family: 'Courier New', monospace;
            font-size: 7pt;
            overflow: visible;
            white-space: pre-wrap;
            word-wrap: break-word;
            word-break: break-all;
            min-height: 200px;
            max-height: none;
            overflow-y: visible;
            line-height: 1.3;
            width: 100%;
            box-sizing: border-box;
            color: #000;
            height: auto;
        }
        
        .component-scores {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            padding: 12px;
            border-radius: 6px;
            margin-top: 15px;
            font-size: 9pt;
            page-break-inside: avoid;
            border: 1px solid #dee2e6;
        }
        
        .component-score {
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding: 6px 0;
            border-bottom: 1px dotted #ced4da;
        }
        
        .score-info {
            flex: 1;
        }
        
        .score-value {
            font-weight: bold;
            color: #2c3e50;
            min-width: 60px;
            text-align: right;
            padding: 2px 8px;
            background: rgba(52, 152, 219, 0.1);
            border-radius: 12px;
        }
        
        .score-reasoning {
            font-size: 8pt;
            color: #666;
            margin-top: 3px;
            line-height: 1.3;
        }
        
        .footer {
            text-align: center;
            font-size: 10pt;
            color: #7f8c8d;
            border-top: 2px solid #bdc3c7;
            padding-top: 15px;
            margin-top: 30px;
            position: absolute;
            bottom: 20mm;
            left: 20mm;
            right: 20mm;
        }
        
        @media print {
            .page {
                box-shadow: none;
                margin: 0;
                padding: 20mm 15mm;
            }
        }
    </style>
</head>
<body>
    <!-- Page 1: Executive Summary -->
    <div class="page">
        <div class="header">
            <h1>Structured Data Audit Report</h1>
            <div class="subtitle">Website Schema Analysis</div>
            <div class="date">Generated on ${currentDate}</div>
        </div>
        
        <div class="executive-summary">
            <h2>Executive Summary</h2>
            <p>Comprehensive structured data analysis completed for your website. Our AI-powered optimization engine has analyzed ${stats.totalPages} pages and generated improved schema markup where needed. The analysis shows ${stats.optimizationRate}% of pages are already well-optimized.</p>
            
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
                    <span class="summary-label">Average Schema Score:</span>
                    <span class="summary-value ${stats.averageScores.structuredData >= 70 ? 'good' : 'needs-attention'}">${stats.averageScores.structuredData}/100</span>
                </div>
            </div>
        </div>
        
        <div class="footer">
            <p>Report generated by Generative Engine Optimizer | Page 1 of ${totalPages}</p>
        </div>
    </div>
    
    ${this.generateAllPagesHTML(allPages, totalPages)}
</body>
</html>`;
  }

  generateAllPagesHTML(pages, totalPages) {
    let html = '';
    let pageNumber = 2;
    
    // Process pages in chunks of 2 per PDF page for better space utilization
    for (let i = 0; i < pages.length; i += 2) {
      const chunk = pages.slice(i, i + 2);
      
      html += `
    <!-- Page ${pageNumber}: Structured Data Analysis Results -->
    <div class="page">
        <div class="section">            
            ${chunk.map(doc => this.generatePageAnalysisHTML(doc)).join('')}
        </div>
        
        <div class="footer">
            <p>Report generated by Generative Engine Optimizer | Page ${pageNumber} of ${totalPages}</p>
        </div>
    </div>`;
      
      pageNumber++;
    }
    
    return html;
  }

  generatePageAnalysisHTML(doc) {
    const url = doc.url || 'URL not available';
    const structuredScore = Math.round((doc.ai?.scoring?.structured_data?.score || 0) * 100);
    const importanceScore = doc.ai?.page_importance?.score || 0;
    const importance = this.getPageImportanceLabel(importanceScore);
    const needsOptimization = doc.ai?.structured_data?.analysis?.needs_optimization === true;
    const existingIssues = doc.ai?.structured_data?.analysis?.existing_issues || [];
    const includeIssues = doc.ai?.structured_data?.analysis?.include || [];
    
    // Current schema from jsonLd field
    const currentSchema = doc.jsonLd || {};
    // Optimized schema from ai.structured_data.generated_schema
    const optimizedSchema = doc.ai?.structured_data?.generated_schema || {};
    
    const componentScores = doc.ai?.scoring?.structured_data?.component_scores || {};
    
    let scoreClass = 'good';
    if (structuredScore < 50) scoreClass = 'needs-work';
    else if (structuredScore < 70) scoreClass = 'medium';

    return `
        <div class="page-analysis">
            <div class="page-header">
                <div>
                    <span class="page-url">${url}</span>
                    ${importance.label ? `<span class="page-importance ${importance.class}">${importance.label}</span>` : ''}
                </div>
                <span class="page-score ${scoreClass}">Score: ${structuredScore}/100</span>
            </div>
            <div class="page-content">
                ${this.generateIssuesSection(existingIssues, includeIssues, needsOptimization)}
                ${this.generateSchemaComparison(currentSchema, optimizedSchema, needsOptimization)}
                ${Object.keys(componentScores).length > 0 ? this.generateComponentScores(componentScores) : ''}
            </div>
        </div>`;
  }

  generateIssuesSection(existingIssues, includeIssues, needsOptimization) {
    const allIssues = [...existingIssues, ...includeIssues];
    
    if (!needsOptimization || allIssues.length === 0) {
      return `
        <div class="issues-section">
            <strong>Status:</strong> <span class="no-issues">✓ No issues found - Page is well optimized</span>
        </div>`;
    }

    return `
        <div class="issues-section">
            <strong>Issues Found:</strong>
            <ul style="margin-left: 20px; margin-top: 8px; font-size: 10pt;">
                ${allIssues.map(issue => `<li style="margin-bottom: 4px;">${issue}</li>`).join('')}
            </ul>
        </div>`;
  }

  generateSchemaComparison(currentSchema, optimizedSchema, needsOptimization) {
    // Helper function to format JSON for display with better formatting
    const formatJSON = (obj) => {
      if (!obj || typeof obj !== 'object') return 'Not set';
      try {
        // Create a more compact JSON display
        const jsonString = JSON.stringify(obj, null, 1);
        return jsonString;
      } catch (e) {
        return String(obj);
      }
    };

    // Check if we have any schema data to display
    const hasCurrentSchema = currentSchema && Object.keys(currentSchema).length > 0;
    const hasOptimizedSchema = optimizedSchema && Object.keys(optimizedSchema).length > 0;
    
    if (!hasCurrentSchema && !hasOptimizedSchema) {
      return `
        <div class="schema-comparison">
          <table class="schema-table">
            <thead>
              <tr>
                <th class="before-column">Current Schema</th>
                <th class="after-column">Optimized Schema</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="before-column"><span class="empty-field">No structured data found</span></td>
                <td class="after-column"><span class="empty-field">No optimized schema available</span></td>
              </tr>
            </tbody>
          </table>
        </div>`;
    }

    let html = `
      <div class="schema-comparison">
        <table class="schema-table">
          <thead>
            <tr>
              <th class="before-column">Current Schema</th>
              <th class="after-column">Optimized Schema</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="before-column">
                ${hasCurrentSchema ? `<div class="schema-code">${formatJSON(currentSchema)}</div>` : '<span class="empty-field">No structured data found</span>'}
              </td>
              <td class="after-column">
                ${hasOptimizedSchema ? `<div class="schema-code">${formatJSON(optimizedSchema)}</div>` : '<span class="empty-field">No optimized schema available</span>'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>`;
    
    return html;
  }

  generateComponentScores(componentScores) {
    let html = '<div class="component-scores"><strong>Detailed Scoring Breakdown:</strong><br>';
    
    Object.entries(componentScores).forEach(([component, data]) => {
      const score = Math.round((data.score || 0) * 100);
      const reasoning = data.reasoning || 'No reasoning provided';
      html += `
        <div class="component-score">
            <div class="score-info">
                <div><strong>${component.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</strong></div>
                <div class="score-reasoning">${reasoning}</div>
            </div>
            <div class="score-value">${score}/100</div>
        </div>`;
    });
    
    html += '</div>';
    return html;
  }

  async generatePDFReport(outputPath = './reports/structuredDataAudit_report.pdf') {
    try {
      console.log('📊 Starting data analysis...');
      
      // Fetch data from MongoDB
      const documents = await this.fetchStructuredData();
      
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
      
  // Generate PDF with Puppeteer or fallback to wkhtmltopdf
  console.log('🎨 Converting HTML to PDF...');
  await htmlToPdf(htmlContent, outputPath);
  console.log(`✅ PDF report generated successfully: ${outputPath}`);
  return outputPath;
      
    } catch (error) {
      console.error('❌ Error generating PDF report:', error.message);
      console.error('Full error:', error);
      throw error;
    }
  }
}

// Usage example:
async function generateReport() {
  console.log('🚀 Starting Structured Data report generation...');
  
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const generator = new StructuredDataReportGenerator(mongoUri);
  
  try {
    console.log('📊 Generating PDF report...');
    await generator.generatePDFReport('./reports/structuredDataAudit_report.pdf');
    console.log('✅ Report generation completed successfully!');
    console.log('📄 Report saved as: ./reports/structuredDataAudit_report.pdf');
  } catch (error) {
    console.error('❌ Failed to generate report:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Export for use in other modules
export default StructuredDataReportGenerator;

// Uncomment to run directly
//generateReport();