import fs from 'fs/promises';
import path from 'path';
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';

const HIGHER_IS_BETTER_METRICS = [
  'avgAltTextCoverage',
  'imageOptimization',
  'cssOptimization',
  'jsOptimization'
];

// Metrics checking for the EXISTENCE of a feature. A value of 0 is POOR.
const PRESENCE_IS_GOOD_METRICS = [
  'pageWithStructuredData',
  'internalLinks',
  'externalLinks',
  'h1Tags',
  'wordCount'
];

// Metrics counting PROBLEMS. A value of 0 is EXCELLENT.
const LOWER_IS_BETTER_METRICS = [
  'pageMissingH1',
  'pageWithJSScript', // Assuming 0 JS scripts is considered optimal for this report
  'missingAltText',
  'missingTitle',
  'brokenLinks',
  'redirects',
  'serverErrors',
  'pageWithMetaRobots',
  'consoleErrors',
  'noscriptTags'
];

// Main import function that generates PDF report
const generateReport = async (final, options = {}) => {
  try {
    console.log('Processing report data...');
    const processedData = processReportData(final);
    
    console.log('Final Score Calculation:');
    console.log(`Claims Score: ${processedData.claimsScore}`);
    console.log(`Crawlability Score: ${processedData.crawlabilityScore}`);
    // --- CHANGE 1: Removed the rating from the console log ---
    console.log(`Final Score: ${processedData.finalScore}`);
    console.log(`Crawlability includes metadata: ${processedData.crawlabilityIncludesMetadata}`);

    // Use directory from options, or default to 'reports'
    const { directory = 'reports', fileName } = options;
    const reportsDir = path.join(process.cwd(), directory);
    
    // Ensure reports directory exists
    try {
      await fs.access(reportsDir);
    } catch {
      await fs.mkdir(reportsDir, { recursive: true });
      console.log(`Created '${directory}' directory`);
    }
    
    // Generate PDF report, passing the directory and optional custom file name
    const pdfResult = await generatePDFReport(processedData, reportsDir, fileName);
    
    return {
      ...pdfResult,
      processedData,
      message: `PDF report generated successfully at ${pdfResult.filePath}`
    };
    
  } catch (error) {
    console.error('Error generating report:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Process and calculate scores from the input data
const processReportData = (data) => {
  // This function no longer calculates any scores.
  // It simply extracts the pre-calculated data passed from quick_scan.js.
  
  // Check if the technical analysis was based on meta tags
  const crawlabilityIncludesMetadata = checkCrawlabilityForMetadata(data.crawlabilityAnalysis);

  return {
    url: data.url,
    timestamp: data.timestamp,
    
    // Use the scores and ratings directly from the input data
    finalScore: data.finalScore,
    rating: data.finalRating, // Use finalRating from the main script
    claimsScore: data.claimsAnalysis?.page_score || 0,
    crawlabilityScore: data.crawlabilityAnalysis?.score || 0,
    
    crawlabilityIncludesMetadata,
    summary: data.claimsAnalysis?.summary,
    claims: data.claimsAnalysis?.evaluated_claims || [],
    recommendations: data.claimsAnalysis?.recommendations || [],
    crawlabilityMetrics: data.crawlabilityAnalysis?.metrics || {},
    crawlabilityIssues: data.crawlabilityAnalysis?.issues || [],
    crawlabilityRecommendations: data.crawlabilityAnalysis?.recommendations || [],
    crawlabilityRating: data.crawlabilityAnalysis?.rating || 'N/A',
    metaTags: data.metaTags || {}
  };
};
// Check if crawlability analysis includes metadata evaluation
const checkCrawlabilityForMetadata = (crawlabilityAnalysis) => {
  if (!crawlabilityAnalysis || !crawlabilityAnalysis.metrics) return false;
  
  // Look for metadata-related metrics in crawlability analysis
  const metadataIndicators = [
    'metaDescription',
    'metaTitle', 
    'ogTags',
    'metaTags',
    'titleTags',
    'descriptionTags',
    'structuredData',
    'altText',
    'robots'
  ];
  
  const metrics = crawlabilityAnalysis.metrics;
  const hasMetadataMetrics = Object.keys(metrics).some(key => 
    metadataIndicators.some(indicator => 
      key.toLowerCase().includes(indicator.toLowerCase())
    )
  );
  
  return hasMetadataMetrics;
};

// Generate PDF report using PDFKit
const generatePDFReport = async (data, reportsDir, customFileName) => {
  return new Promise((resolve, reject) => {
    try {
        // Use custom file name if provided, otherwise generate one
        const fileName = customFileName
            ? (customFileName.endsWith('.pdf') ? customFileName : `${customFileName}.pdf`)
            : (() => {
                const hostname = new URL(data.url).hostname.replace(/\./g, '_');
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                return `GEO_Report_${hostname}_${timestamp}.pdf`;
            })();
      
      const filePath = path.join(reportsDir, fileName);
      
      // Create PDF document
      const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true }); // Enable page buffering
      const stream = createWriteStream(filePath);
      
      doc.pipe(stream);
      
      // Colors
      const colors = {
        primary: '#2563eb',
        secondary: '#6366f1',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
        text: '#1f2937',
        lightText: '#6b7280'
      };
      
      // Helper functions
      const addHeader = () => {
        doc.rect(0, 0, doc.page.width, 120).fill(colors.primary);
        doc.fillColor('white')
           .fontSize(28)
           .font('Helvetica-Bold')
           .text('Page Analysis Report', 50, 30);
        
        doc.fontSize(14)
           .font('Helvetica')
           .text(data.url, 50, 65)
           .text(`Generated: ${new Date(data.timestamp).toLocaleString()}`, 50, 85);
        
        // Score circle
        const scoreX = doc.page.width - 120;
        const scoreY = 60;
        doc.circle(scoreX, scoreY, 35).fill('white');
        doc.fillColor(colors.primary)
           .fontSize(24)
           .font('Helvetica-Bold')
           .text(data.finalScore.toString(), scoreX - 15, scoreY - 12);
        
        // --- CHANGE 2: Removed the rating text from the top score circle ---
        // doc.fontSize(10)
        //    .text(data.rating, scoreX - 20, scoreY + 8);
        
        doc.y = 150;
      };
      
      const addSection = (title, content) => {
        // This initial check is a fallback, the main logic is now inside the content function
        if (doc.y > doc.page.height - 100) {
          doc.addPage();
        }
        
        // We let the content function handle its own page breaks if needed,
        // but draw the title after the content function decides.
        if (typeof content === 'function') {
          content(title); // Pass title to the content function
        } else {
           // Draw title for simple content
           doc.fillColor(colors.text)
              .fontSize(18)
              .font('Helvetica-Bold')
              .text(title, 50, doc.y);
           doc.moveTo(50, doc.y + 10)
              .lineTo(doc.page.width - 50, doc.y + 10)
              .stroke(colors.primary);
           doc.y += 20;

          doc.fontSize(12)
             .font('Helvetica')
             .fillColor(colors.text)
             .text(content || 'No data available', 50, doc.y + 10, {
                width: doc.page.width - 100,
                lineGap: 5
             });
        }
      };
      
      const drawProgressBar = (x, y, width, score, label, includesMetadata = false) => {
        const barHeight = 12;
        const percentage = score / 100;
        
        // Background bar
        doc.rect(x, y, width, barHeight)
           .fill('#e5e7eb');
        
        // Progress bar
        const progressWidth = width * percentage;
        const barColor = score >= 80 ? colors.success : 
                         score >= 60 ? colors.primary : 
                         score >= 40 ? colors.warning : colors.danger;
        
        doc.rect(x, y, progressWidth, barHeight)
           .fill(barColor);
        
        // Label
        doc.fillColor(colors.text)
           .fontSize(12)
           .font('Helvetica-Bold')
           .text(label, x, y - 20);
        
        // Score text
        doc.fillColor(colors.text)
           .fontSize(14)
           .font('Helvetica-Bold')
           .text(`${score}/100`, x + width - 50, y - 20);
        
        // Metadata indicator
        if (includesMetadata) {
          doc.fillColor(colors.success)
             .fontSize(9)
             .text('(includes metadata evaluation)', x, y + barHeight + 8);
        }
        
        return y + barHeight + (includesMetadata ? 30 : 20);
      };
      
      // Fixed function to determine status based on metric type and value
     // --- REVISED: Hardcoded logic for metric status ---
const getMetricStatus = (key, value) => {
  let status = 'Good';
  let statusColor = colors.success;

  if (typeof value === 'number') {
    // CATEGORY 1: Percentage-based metrics where higher is better
    if (HIGHER_IS_BETTER_METRICS.includes(key)) {
      if (value >= 90) {
        status = 'Excellent';
        statusColor = colors.success;
      } else if (value >= 70) {
        status = 'Good';
        statusColor = colors.warning;
      } else {
        status = 'Poor';
        statusColor = colors.danger;
      }
    }
    // CATEGORY 2: Count-based metrics where PRESENCE is good (0 is bad)
    else if (PRESENCE_IS_GOOD_METRICS.includes(key)) {
      if (value > 0) {
        status = 'Good';
        statusColor = colors.success;
      } else {
        status = 'Poor';
        statusColor = colors.danger;
      }
    }
    // CATEGORY 3: Count-based metrics where ABSENCE of problems is good (0 is best)
    else if (LOWER_IS_BETTER_METRICS.includes(key)) {
      if (value === 0) {
        status = 'Excellent';
        statusColor = colors.success;
      } else if (value <= 2) { // A small number of issues might be acceptable
        status = 'Good';
        statusColor = colors.warning;
      } else { // Many issues are poor
        status = 'Poor';
        statusColor = colors.danger;
      }
    }
    // Fallback for any unlisted numeric metric
    else {
      status = 'Info'; // Assign a neutral status if metric type is unknown
      statusColor = colors.lightText;
    }
  } else {
    // For non-numeric values (e.g., true/false)
    status = value ? 'Good' : 'Poor';
    statusColor = value ? colors.success : colors.danger;
  }

  return { status, statusColor };
};
      
      // --- PDF content generation ---
      
      addHeader();
      
      addSection('Executive Summary', (title) => {
        doc.fillColor(colors.text).fontSize(18).font('Helvetica-Bold').text(title, 50, doc.y);
        doc.moveTo(50, doc.y + 10).lineTo(doc.page.width - 50, doc.y + 10).stroke(colors.primary);
        doc.y += 20;

        doc.fontSize(12)
           .font('Helvetica')
           .fillColor(colors.text)
           .text(data.summary || 'Single page analysis completed successfully.', 50, doc.y + 10, {
              width: doc.page.width - 100,
              lineGap: 5
           });
        
        doc.fillColor(colors.lightText)
           .fontSize(10)
           .text('Note: This analysis covers a single page and its associated elements.', 50, doc.y + 10);
        
        doc.y += 40;
      });
      
      addSection('Score Breakdown', (title) => {
        doc.fillColor(colors.text).fontSize(18).font('Helvetica-Bold').text(title, 50, doc.y);
        doc.moveTo(50, doc.y + 10).lineTo(doc.page.width - 50, doc.y + 10).stroke(colors.primary);
        doc.y += 20;

        let currentY = doc.y + 20;
        const barWidth = doc.page.width - 150;
        const leftMargin = 60;
        
        currentY = drawProgressBar(leftMargin, currentY, barWidth, data.claimsScore, 'Claims Analysis (Page Content)');
        currentY += 20;
        
        currentY = drawProgressBar(leftMargin, currentY, barWidth, data.crawlabilityScore, 'Technical Analysis (Page Structure)', data.crawlabilityIncludesMetadata);
        currentY += 30;
        
        doc.rect(50, currentY, doc.page.width - 100, 50)
           .fill('#f0f9ff')
           .stroke(colors.primary);
        
        doc.fillColor(colors.primary)
           .fontSize(22)
           .font('Helvetica-Bold')
           .text('Final Score:', 70, currentY + 12);
        
        doc.fontSize(28)
           .text(`${data.finalScore}/100`, doc.page.width - 200, currentY + 8);
        
        // --- CHANGE 3: Removed the rating from the Final Score section ---
        // doc.fillColor(colors.text)
        //    .fontSize(16)
        //    .font('Helvetica')
        //    .text(`(${data.rating})`, doc.page.width - 120, currentY + 20);
        
        doc.y = currentY + 70;
      });
      
      if (data.claims.length > 0) {
        doc.addPage();
        
        addSection('Claims Analysis', (title) => {
        doc.fillColor(colors.text).fontSize(18).font('Helvetica-Bold').text(title, 50, doc.y);
        doc.moveTo(50, doc.y + 10).lineTo(doc.page.width - 50, doc.y + 10).stroke(colors.primary);
        doc.y += 20;
          
          data.claims.forEach((claim, index) => {
            if (doc.y > doc.page.height - 120) {
              doc.addPage();
            }
            
            const scoreColor = claim.claim_score >= 2 ? colors.success : 
                                 claim.claim_score >= 0 ? colors.warning : colors.danger;
            
            doc.rect(50, doc.y, doc.page.width - 100, 60).fill('#f9fafb').stroke('#e5e7eb');
            doc.rect(doc.page.width - 100, doc.y + 5, 40, 20).fill(scoreColor);
            
            doc.fillColor('white').fontSize(10).font('Helvetica-Bold').text(claim.claim_score.toString(), doc.page.width - 95, doc.y + 10);
            
            doc.fillColor(colors.text).fontSize(10).font('Helvetica-Bold').text(`Claim ${index + 1}:`, 60, doc.y + 10);
            doc.fontSize(9).font('Helvetica').text(claim.claim, 60, doc.y + 25, { width: doc.page.width - 160 });
            
            doc.y += 70;
            
            if (claim.improvement_suggestions) {
              doc.fontSize(9).fillColor(colors.lightText)
                 .text('Improvement: ' + claim.improvement_suggestions, 60, doc.y, {
                    width: doc.page.width - 120,
                    lineGap: 3
                   });
              doc.y += 30;
            }
          });
        });
      }
      
      if (data.recommendations.length > 0) {
        addSection('Recommendations', (title) => {
        doc.fillColor(colors.text).fontSize(18).font('Helvetica-Bold').text(title, 50, doc.y);
        doc.moveTo(50, doc.y + 10).lineTo(doc.page.width - 50, doc.y + 10).stroke(colors.primary);
        doc.y += 20;
          
          data.recommendations.forEach((rec, index) => {
            doc.text(`${index + 1}. ${rec}`, 50, doc.y + 10, {
              width: doc.page.width - 100,
              lineGap: 8
            });
          });
        });
      }
      
      // Technical Analysis (formerly Crawlability Analysis)
      addSection('Technical Analysis', (title) => {
        // --- FIX STARTS HERE ---
        // 1. Calculate the total height needed for the entire technical analysis section.
        const hasMetrics = Object.keys(data.crawlabilityMetrics).length > 0;
        const hasIssues = data.crawlabilityIssues.length > 0;
        const rowHeight = 28;
        let requiredHeight = 0;

        // Height for title and initial text
        requiredHeight += 80;

        // Height for the metrics table
        if (hasMetrics) {
            requiredHeight += 45; // "Technical Metrics:" sub-header + padding
            requiredHeight += (Object.keys(data.crawlabilityMetrics).length + 1) * rowHeight; // header + rows
        }

        // Height for the issues list
        if (hasIssues) {
            requiredHeight += 40; // "Issues Found:" sub-header + padding
            requiredHeight += data.crawlabilityIssues.length * 20; // Approximate height per issue
        } else {
            requiredHeight += 40; // Height for "No issues found" message
        }

        // 2. Check if the required height fits on the current page. If not, add a new page.
        // (Leaving a 60px margin for the footer)
        if (doc.y + requiredHeight > doc.page.height - 60) {
            doc.addPage();
        }
        // --- FIX ENDS HERE ---

        // Now draw the content, knowing we have enough space
        doc.fillColor(colors.text).fontSize(18).font('Helvetica-Bold').text(title, 50, doc.y);
        doc.moveTo(50, doc.y + 10).lineTo(doc.page.width - 50, doc.y + 10).stroke(colors.primary);
        doc.y += 20;

        doc.fontSize(12)
           .font('Helvetica')
           .fillColor(colors.text)
           .text(`Rating: ${data.crawlabilityRating} (${data.crawlabilityScore}/100)`, 50, doc.y + 10);
        
        if (data.crawlabilityIncludesMetadata) {
          doc.fillColor(colors.success)
             .text('✓ This analysis includes metadata evaluation', 50, doc.y + 10);
          doc.fillColor(colors.text);
        }
        
        doc.y += 30;
        
        if (hasMetrics) {
          doc.font('Helvetica-Bold').text('Technical Metrics:', 50, doc.y + 15);
          doc.y += 30;
          
          const tableX = 50;
          const tableWidth = doc.page.width - 100;
          const colWidths = [tableWidth * 0.6, tableWidth * 0.25, tableWidth * 0.15];
          
          let currentY = doc.y;
          doc.rect(tableX, currentY, tableWidth, rowHeight).fill('#f1f5f9').stroke('#cbd5e1');
          
          doc.fillColor(colors.text)
             .fontSize(12)
             .font('Helvetica-Bold')
             .text('Metric', tableX + 12, currentY + 8)
             .text('Value', tableX + colWidths[0] + 12, currentY + 8)
             .text('Status', tableX + colWidths[0] + colWidths[1] + 12, currentY + 8);
          
          currentY += rowHeight;
          
          Object.entries(data.crawlabilityMetrics).forEach(([key, value], index) => {
            const isEven = index % 2 === 0;
            
            doc.rect(tableX, currentY, tableWidth, rowHeight).fill(isEven ? '#ffffff' : '#f8fafc').stroke('#e2e8f0');
            
            const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim();
            
            let displayValue = value;
            if (typeof value === 'number' && (key.includes('Coverage') || key.includes('Optimization') || key.includes('Alt'))) {
              displayValue = `${value}%`;
            }
            
            const { status, statusColor } = getMetricStatus(key, value);
            
            doc.fillColor(colors.text).fontSize(11).font('Helvetica').text(label, tableX + 12, currentY + 8, { width: colWidths[0] - 20 });
            doc.fontSize(11).font('Helvetica-Bold').text(displayValue.toString(), tableX + colWidths[0] + 12, currentY + 8);
            doc.fillColor(statusColor).fontSize(10).font('Helvetica-Bold').text(status, tableX + colWidths[0] + colWidths[1] + 12, currentY + 9);
            
            currentY += rowHeight;
          });
          
          doc.y = currentY + 15;
        }
        
        if (hasIssues) {
          doc.font('Helvetica-Bold').fillColor(colors.danger).text('Issues Found:', 50, doc.y + 10);
          doc.font('Helvetica').fillColor(colors.text);
          
          data.crawlabilityIssues.forEach(issue => {
            doc.text(`• ${issue}`, 70, doc.y + 5);
          });
        } else {
          doc.font('Helvetica-Bold').fillColor(colors.success).text('✓ No issues found - Excellent technical implementation!', 50, doc.y + 10);
        }
      });
      
      // Footer
      const range = doc.bufferedPageRange(); // Get the range of buffered pages
      for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          // Add page number
          doc.fontSize(9)
             .fillColor(colors.lightText)
             .text(`Page ${i + 1} of ${range.count}`, 
                   50, 
                   doc.page.height - 50, 
                   { align: 'center', width: doc.page.width - 100 }
             );
      }
      doc.end();
     stream.on('finish', () => {
        resolve({
          filePath,
          fileName,
          success: true,
          finalScore: data.finalScore,
          rating: data.rating
        });
      });
      
      stream.on('error', (error) => {
        reject(error);
      });
      
    } catch (error) {
      reject(error);
    }
  });
};

// Export the main function
export { generateReport };