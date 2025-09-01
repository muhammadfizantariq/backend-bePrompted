import { MongoClient } from 'mongodb';
import PDFDocument from 'pdfkit';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ProfessionalReportGenerator {
    constructor(mongoUri, dbName, mongoOptions = {}) {
        this.mongoUri = mongoUri;
        this.dbName = dbName;
        this.mongoOptions = mongoOptions;
        this.client = null;
    }

    async connect() {
        try {
            console.log(`Attempting to connect to MongoDB at: ${this.mongoUri}`);
            this.client = new MongoClient(this.mongoUri, this.mongoOptions);
            await this.client.connect();
            console.log('✓ Successfully connected to MongoDB');
            
            // Test the connection
            await this.client.db(this.dbName).admin().ping();
            console.log('✓ MongoDB ping successful');
        } catch (error) {
            console.error('✗ MongoDB connection failed:', error.message);
            throw error;
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.close();
            console.log('Disconnected from MongoDB');
        }
    }

    async fetchData() {
        try {
            console.log(`Fetching data from database: ${this.dbName}, collection: extractions_3`);
            const db = this.client.db(this.dbName);
            const collection = db.collection('extractions_3');
            
            // Check if collection exists
            const collections = await db.listCollections({ name: 'extractions_3' }).toArray();
            if (collections.length === 0) {
                console.warn('⚠ Collection "extractions_3" not found in database');
                console.log('Available collections:');
                const allCollections = await db.listCollections().toArray();
                allCollections.forEach(col => console.log(`  - ${col.name}`));
                return [];
            }
            
            const allData = await collection.find({}).toArray();
            console.log(`✓ Fetched ${allData.length} total documents from collection`);
            
            // Filter out documents without claims_evaluation - ONLY include docs with valid claims
            const validData = allData.filter(item => 
                item.ai?.claims_evaluation?.claims_evaluation && 
                Array.isArray(item.ai.claims_evaluation.claims_evaluation) &&
                item.ai.claims_evaluation.claims_evaluation.length > 0
            );
            
            console.log(`✓ Filtered to ${validData.length} documents with valid claims_evaluation`);
            console.log(`✗ Completely ignoring ${allData.length - validData.length} documents without claims_evaluation`);
            
            if (validData.length > 0) {
                console.log('Sample document structure:');
                const sample = validData[0];
                console.log(`  - url: ${sample.url ? '✓' : '✗'}`);
                console.log(`  - ai: ${sample.ai ? '✓' : '✗'}`);
                if (sample.ai) {
                    console.log(`  - ai.key_claims_analysis: ${sample.ai.key_claims_analysis ? '✓' : '✗'}`);
                    console.log(`  - ai.claims_evaluation: ${sample.ai.claims_evaluation ? '✓' : '✗'}`);
                    console.log(`  - claims_evaluation count: ${sample.ai.claims_evaluation?.claims_evaluation?.length || 0}`);
                }
            }
            
            return validData;
        } catch (error) {
            console.error('✗ Error fetching data:', error.message);
            throw error;
        }
    }

    formatDate() {
        return new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    addHeader(doc, title) {
        // Company/Report Header
        doc.fontSize(24)
           .fillColor('#2C3E50')
           .font('Helvetica-Bold')
           .text(title, 50, 50);

        // Subtitle
        doc.fontSize(12)
           .fillColor('#7F8C8D')
           .font('Helvetica')
           .text(`Generated on ${this.formatDate()}`, 50, 80);

        // Header line
        doc.strokeColor('#3498DB')
           .lineWidth(3)
           .moveTo(50, 110)
           .lineTo(550, 110)
           .stroke();

        return 130;
    }

    // ✨ NEW METHOD: To handle the case where no claims are found
    addNoDataPage(doc) {
        let yPos = this.addHeader(doc, 'Analysis Report');

        yPos += 50;

        doc.fontSize(20)
           .font('Helvetica-Bold')
           .fillColor('#E74C3C') // Red color to indicate a problem
           .text('No Claim Data Found', { align: 'center' });

        yPos += 50;

        doc.fontSize(12)
           .font('Helvetica')
           .fillColor('#34495E')
           .text(
               'This report could not be generated because no documents containing scannable claims were found in the site. The analysis requires claims and analyzes the implication of claims on LLM visibility.',
               { align: 'left', indent: 20, lineGap: 5 }
           );

        yPos += 80;

        doc.fontSize(14)
           .font('Helvetica-Bold')
           .fillColor('#2C3E50')
           .text('Possible Reasons:', { underline: true });

        yPos += 30;

        doc.fontSize(11)
           .font('Helvetica')
           .list([
               'There are no claims existing in the site.',
               'The site is heavily restricted or requires authentication to access.',
               'The AI analysis did not identify any valid claims in the processed web pages.'
           ], { bulletRadius: 2, indent: 20 });

        yPos += 100;

        doc.fontSize(14)
           .font('Helvetica-Bold')
           .fillColor('#2C3E50')
           .text('Recommended Next Steps:', { underline: true });

        yPos += 30;

        doc.fontSize(11)
           .font('Helvetica')
           .list([
               'Verify that the MongoDB connection URI and database name are correct.',
               'Ensure that your data extraction and analysis pipeline is running correctly and populating the `extractions_3` collection.',
               'Manually inspect a few documents in the collection to confirm the structure and see if the `ai.claims_evaluation.claims_evaluation` array is present and contains data.'
           ], { bulletRadius: 2, indent: 20 });
    }

    getScoreColors(score) {
        if (score === null || score === undefined || score === 'N/A') {
            return {
                background: '#F8F9FA',
                text: '#6C757D',
                border: '#E9ECEF'
            };
        }
        
        const numScore = parseFloat(score);
        
        if (numScore >= 2) {
            return {
                background: '#D5F4E6',  // Light green
                text: '#0F5132',        // Dark green
                border: '#27AE60'       // Green border
            };
        } else if (numScore >= 1) {
            return {
                background: '#D1ECF1',  // Light blue
                text: '#0C5460',        // Dark blue
                border: '#17A2B8'       // Blue border
            };
        } else if (numScore >= 0) {
            return {
                background: '#FFF3CD',  // Light yellow
                text: '#664D03',        // Dark orange
                border: '#F39C12'       // Orange border
            };
        } else {
            return {
                background: '#F8D7DA',  // Light red
                text: '#721C24',        // Dark red
                border: '#E74C3C'       // Red border
            };
        }
    }

    addExecutiveSummary(doc, data) {
        // Start on new page for executive summary
        doc.addPage();
        
        let yPos = this.addHeader(doc, 'Executive Summary');
        yPos += 20;

        // ONLY count pages with valid claims_evaluation (data is already filtered)
        const totalPages = data.length;
        const avgScores = data
            .filter(item => item.ai?.claims_evaluation?.overall_analysis?.average_page_score !== undefined && 
                             item.ai?.claims_evaluation?.overall_analysis?.average_page_score !== null)
            .map(item => item.ai.claims_evaluation.overall_analysis.average_page_score);
        
        const overallAvgScore = avgScores.length > 0 
            ? (avgScores.reduce((a, b) => a + b, 0) / avgScores.length).toFixed(2)
            : 'N/A';

        const totalClaims = data.reduce((total, item) => {
            return total + (item.ai?.claims_evaluation?.claims_evaluation?.length || 0);
        }, 0);

        // Create summary statistics table
        this.drawTable(doc, yPos, [
            ['Metric', 'Value'],
            ['Total Pages Analyzed', totalPages.toString()],
            ['Total Claims Identified', totalClaims.toString()],
            ['Overall Average Score', overallAvgScore],
            ['Analysis Focus', 'LLM Visibility Improvement']
        ], [200, 150], '#3498DB');

        yPos += 200; // Give proper space after table

        // Key insights section header
        doc.fontSize(16)
           .fillColor('#2C3E50')
           .font('Helvetica-Bold')
           .text('Key Insights', 50, yPos);

        yPos += 30;

        // Calculate insights - ONLY from pages that have scores (filtered data only)
        const pagesWithScores = data.filter(item => 
            item.ai?.claims_evaluation?.overall_analysis?.average_page_score !== undefined &&
            item.ai?.claims_evaluation?.overall_analysis?.average_page_score !== null
        );
        
        const highScorePages = pagesWithScores.filter(item => 
            item.ai.claims_evaluation.overall_analysis.average_page_score >= 1
        ).length;
        
        const mediumScorePages = pagesWithScores.filter(item => {
            const score = item.ai.claims_evaluation.overall_analysis.average_page_score;
            return score >= 0 && score < 1;
        }).length;
        
        const lowScorePages = pagesWithScores.filter(item => 
            item.ai.claims_evaluation.overall_analysis.average_page_score < 0
        ).length;
        
        const noScorePages = totalPages - pagesWithScores.length;

        // Key insights in bullet points with exact percentage calculation (based on valid pages only)
        const highPercent = ((highScorePages/totalPages)*100);
        const mediumPercent = ((mediumScorePages/totalPages)*100);  
        const lowPercent = ((lowScorePages/totalPages)*100);
        const noScorePercent = ((noScorePages/totalPages)*100);

        doc.fontSize(11)
           .fillColor('#27AE60')
           .font('Helvetica')
           .text(`• ${highScorePages} pages (${highPercent.toFixed(1)}%) have high visibility scores (≥1)`, 50, yPos);

        doc.fillColor('#F39C12')
           .text(`• ${mediumScorePages} pages (${mediumPercent.toFixed(1)}%) have moderate scores (0 to <1)`, 50, yPos + 18);

        doc.fillColor('#E74C3C')
           .text(`• ${lowScorePages} pages (${lowPercent.toFixed(1)}%) need immediate attention (score <0)`, 50, yPos + 36);

        if (noScorePages > 0) {
            doc.fillColor('#95A5A6')
               .text(`• ${noScorePages} pages (${noScorePercent.toFixed(1)}%) have no score data`, 50, yPos + 54);
            
            doc.fillColor('#34495E')
               .text(`• Average claims per page: ${(totalClaims/totalPages).toFixed(1)}`, 50, yPos + 72);
        } else {
            doc.fillColor('#34495E')
               .text(`• Average claims per page: ${(totalClaims/totalPages).toFixed(1)}`, 50, yPos + 54);
        }

        return noScorePages > 0 ? yPos + 100 : yPos + 80;
    }

    addSummaryPage(doc, data) {
        doc.addPage();
        
        let yPos = this.addHeader(doc, 'Summary & Recommendations');
        yPos += 20;
        
        // Calculate summary statistics from filtered data only
        const pageScores = data
            .filter(item => item.ai?.claims_evaluation?.overall_analysis?.average_page_score !== undefined)
            .map(item => ({
                url: item.url,
                score: item.ai.claims_evaluation.overall_analysis.average_page_score
            }))
            .sort((a, b) => b.score - a.score);

        // Top performing pages table
        doc.fontSize(14)
           .fillColor('#27AE60')
           .font('Helvetica-Bold')
           .text('Top Performing Pages', 50, yPos);

        yPos += 25;

        const topPagesData = [['Rank', 'Score', 'URL']];
        pageScores.slice(0, 5).forEach((page, index) => {
            const displayUrl = page.url && page.url.length > 60 ? `${page.url.substring(0, 60)}...` : (page.url || 'No URL');
            topPagesData.push([
                (index + 1).toString(),
                page.score.toString(),
                displayUrl
            ]);
        });

        // Use score coloring for the Score column (index 1)
        this.drawTable(doc, yPos, topPagesData, [50, 60, 360], '#27AE60', true, 1);
        yPos += (topPagesData.length * 30) + 40; // Adjusted for new row height

        // Pages needing attention table
        doc.fontSize(14)
           .fillColor('#E74C3C')
           .font('Helvetica-Bold')
           .text('Pages Requiring Attention', 50, yPos);

        yPos += 25;

        const lowPagesData = [['Rank', 'Score', 'URL']];
        pageScores.slice(-5).reverse().forEach((page, index) => {
            const displayUrl = page.url && page.url.length > 60 ? `${page.url.substring(0, 60)}...` : (page.url || 'No URL');
            lowPagesData.push([
                (index + 1).toString(),
                page.score.toString(),
                displayUrl
            ]);
        });

        // Use score coloring for the Score column (index 1)
        this.drawTable(doc, yPos, lowPagesData, [50, 60, 360], '#E74C3C', true, 1);
    }

    drawTable(doc, yPos, data, columnWidths, headerColor = '#3498DB', useScoreColoring = false, scoreColumnIndex = -1) {
        const startX = 50;
        const rowHeight = 30; // IMPROVEMENT: Reduced row height for a tighter table
        let currentY = yPos;

        // Draw header row
        doc.rect(startX, currentY, columnWidths.reduce((a, b) => a + b, 0), rowHeight)
           .fillColor(headerColor)
           .fill();

        let currentX = startX;
        data[0].forEach((header, index) => {
            doc.fontSize(10)
               .fillColor('#FFFFFF')
               .font('Helvetica-Bold')
               .text(header, currentX + 3, currentY + 10, { // Adjusted Y for new row height
                   width: columnWidths[index] - 6,
                   align: 'center',
                   lineBreak: false
               });
            currentX += columnWidths[index];
        });

        currentY += rowHeight;

        // Draw data rows
        for (let i = 1; i < data.length; i++) {
            let fillColor = '#FFFFFF';
            let strokeColor = '#E9ECEF';
            let textColor = '#2C3E50';
            
            // Apply score-based coloring if enabled
            if (useScoreColoring && scoreColumnIndex >= 0 && scoreColumnIndex < data[i].length) {
                const scoreValue = data[i][scoreColumnIndex];
                const colors = this.getScoreColors(scoreValue);
                fillColor = colors.background;
                strokeColor = colors.border;
                textColor = colors.text;
            } else {
                // Default alternating row colors
                fillColor = i % 2 === 0 ? '#F8F9FA' : '#FFFFFF';
            }
            
            doc.rect(startX, currentY, columnWidths.reduce((a, b) => a + b, 0), rowHeight)
               .fillColor(fillColor)
               .fill()
               .strokeColor(strokeColor)
               .lineWidth(1)
               .stroke();

            currentX = startX;
            data[i].forEach((cell, index) => {
                const textAlign = index === 1 ? 'left' : 'center';
                const textSize = index === 1 ? 8 : 10;
                
                // Use score-based text color for score columns, default for others
                const cellTextColor = (useScoreColoring && index === scoreColumnIndex) ? textColor : '#2C3E50';
                
                doc.fontSize(textSize)
                   .fillColor(cellTextColor)
                   .font('Helvetica')
                   .text(cell.toString(), currentX + 3, currentY + 10, { // Adjusted Y for new row height
                       width: columnWidths[index] - 6,
                       align: textAlign,
                       lineBreak: false
                   });
                currentX += columnWidths[index];
            });

            currentY += rowHeight;
        }

        // Draw outer border
        doc.rect(startX, yPos, columnWidths.reduce((a, b) => a + b, 0), currentY - yPos)
           .strokeColor('#DEE2E6')
           .lineWidth(2)
           .stroke();
    }

    addPageAnalysis(doc, pageData, yPos) {
        // A consistent threshold for checking page breaks
        const PAGE_BREAK_Y = 680;

        // Check if we need a new page
        if (yPos > PAGE_BREAK_Y) {
            doc.addPage();
            yPos = 50;
        }

        // Get page score for header coloring
        const pageScore = pageData.ai?.claims_evaluation?.overall_analysis?.average_page_score;
        const scoreColors = this.getScoreColors(pageScore);

        // Page URL Header with score-based background color - ALWAYS show URL
        doc.rect(45, yPos - 5, 500, 35)
           .fillColor(scoreColors.background)
           .fill()
           .strokeColor(scoreColors.border)
           .lineWidth(2)
           .stroke();

        doc.fontSize(14)
           .fillColor(scoreColors.text)
           .font('Helvetica-Bold')
           .text('Page Analysis', 55, yPos + 5);

        // Add score badge in header if available
        if (pageScore !== null && pageScore !== undefined) {
            doc.fontSize(12)
               .fillColor(scoreColors.text)
               .font('Helvetica-Bold')
               .text(`Score: ${pageScore}`, 450, yPos + 8);
        }

        yPos += 40;

        // URL - ALWAYS display prominently on every page
        const url = pageData.url || 'URL not available';
        const displayUrl = url.length > 80 ? `${url.substring(0, 80)}...` : url;
        
        doc.fontSize(10)
           .fillColor('#2C3E50')
           .font('Helvetica-Bold')
           .text(`URL: `, 50, yPos);

        doc.fontSize(9)
           .fillColor('#7F8C8D')
           .font('Helvetica')
           .text(displayUrl, 80, yPos);

        yPos += 25;

        // --- NEW ORDER: Claims Analysis First ---
        if (pageData.ai?.claims_evaluation?.claims_evaluation && pageData.ai.claims_evaluation.claims_evaluation.length > 0) {
            doc.fontSize(12)
               .fillColor('#2C3E50')
               .font('Helvetica-Bold')
               .text('Claims Analysis', 50, yPos);

            yPos += 25;

            const evaluations = pageData.ai.claims_evaluation.claims_evaluation;

            // Process each claim individually with full details
            evaluations.forEach((evaluation, index) => {
                // Check if we need a new page for this claim
                if (yPos > PAGE_BREAK_Y - 100) { // Check with buffer for claim content
                    doc.addPage();
                    yPos = 50;
                    
                    // Re-display URL at top of new page
                    doc.fontSize(10).fillColor('#2C3E50').font('Helvetica-Bold').text(`URL: `, 50, yPos);
                    doc.fontSize(9).fillColor('#7F8C8D').font('Helvetica').text(displayUrl, 80, yPos);
                    yPos += 30;
                    
                    doc.fontSize(12)
                       .fillColor('#2C3E50')
                       .font('Helvetica-Bold')
                       .text('Claims Analysis (continued)', 50, yPos);
                    yPos += 25;
                }

                // Claim header with score coloring
                const claimScore = evaluation.claim_score;
                const scoreColors = this.getScoreColors(claimScore);
                
                // Claim number header with score background
                doc.rect(45, yPos - 5, 500, 25)
                   .fillColor(scoreColors.background)
                   .fill()
                   .strokeColor(scoreColors.border)
                   .lineWidth(1)
                   .stroke();

                doc.fontSize(11)
                   .fillColor(scoreColors.text)
                   .font('Helvetica-Bold')
                   .text(`Claim #${index + 1} - Score: ${claimScore || 'N/A'}`, 55, yPos + 5);

                yPos += 30; // IMPROVEMENT: Tightened spacing

                // Full claim text
                doc.fontSize(10)
                   .fillColor('#2C3E50')
                   .font('Helvetica-Bold')
                   .text('Claim:', 50, yPos);

                doc.fontSize(10) // IMPROVEMENT: Increased font size
                   .font('Helvetica')
                   .fillColor('#34495E')
                   .text(evaluation.claim || 'No claim text available', 50, yPos + 15, {
                       width: 500,
                       height: 50 // Increased height for larger font
                   });

                yPos += 55; // IMPROVEMENT: Adjusted spacing

                // Evaluation metrics in a compact table
                const metricsData = [
                    ['Metric', 'Value'],
                    ['Valid', evaluation.is_valid?.toString() || 'N/A'],
                    ['Quantified', evaluation.is_quantified?.toString() || 'N/A'],
                    ['Vague', evaluation.is_vague?.toString() || 'N/A'],
                    ['Needs Verification', evaluation.needs_verification?.toString() || 'N/A']
                ];

                this.drawTable(doc, yPos, metricsData, [120, 80], '#9B59B6');
                yPos += (metricsData.length * 30) + 15; // IMPROVEMENT: Tightened spacing and fixed the issue

                // Improvement suggestions - Full text
                if (evaluation.improvement_suggestions) {
                    doc.fontSize(10)
                       .fillColor('#E74C3C')
                       .font('Helvetica-Bold')
                       .text('Improvement Suggestions:', 50, yPos);

                    doc.fontSize(10) // IMPROVEMENT: Increased font size
                       .font('Helvetica')
                       .fillColor('#C0392B')
                       .text(evaluation.improvement_suggestions, 50, yPos + 15, {
                           width: 500,
                           height: 60 // Increased height for larger font
                       });

                    yPos += 70; // IMPROVEMENT: Adjusted spacing
                }

                // Add some spacing between claims
                yPos += 10;

                // Add separator line between claims
                doc.strokeColor('#E9ECEF')
                   .lineWidth(1)
                   .moveTo(50, yPos)
                   .lineTo(550, yPos)
                   .stroke();

                yPos += 15;
            });
        }
        
        // --- NEW ORDER: Overall Analysis Second ---
        if (pageData.ai?.claims_evaluation?.overall_analysis) {
            const analysis = pageData.ai.claims_evaluation.overall_analysis;
            
            // Summary section
            if (analysis.summary) {
                // Ensure enough space for summary
                if (yPos > PAGE_BREAK_Y - 50) {
                    doc.addPage();
                    yPos = 50;
                    
                    // Re-display URL at top of new page
                    doc.fontSize(10).fillColor('#2C3E50').font('Helvetica-Bold').text(`URL: `, 50, yPos);
                    doc.fontSize(9).fillColor('#7F8C8D').font('Helvetica').text(displayUrl, 80, yPos);
                    yPos += 30;
                }
                
                doc.fontSize(11)
                   .fillColor('#2C3E50')
                   .font('Helvetica-Bold')
                   .text('Page Summary:', 50, yPos);
                
                doc.fontSize(10)
                   .font('Helvetica')
                   .fillColor('#34495E')
                   .text(analysis.summary, 50, yPos + 15, {
                       width: 500,
                       height: 50
                   });
                yPos += 70;
            }

            // Recommendations section
            if (analysis.recommendations) {
                // Ensure enough space for recommendations
                if (yPos > PAGE_BREAK_Y - 50) {
                    doc.addPage();
                    yPos = 50;
                    
                    // Re-display URL at top of new page
                    doc.fontSize(10).fillColor('#2C3E50').font('Helvetica-Bold').text(`URL: `, 50, yPos);
                    doc.fontSize(9).fillColor('#7F8C8D').font('Helvetica').text(displayUrl, 80, yPos);
                    yPos += 30;
                }
                
                doc.fontSize(11)
                   .fillColor('#E74C3C')
                   .font('Helvetica-Bold')
                   .text('Page Recommendations:', 50, yPos);
                
                doc.fontSize(10)
                   .font('Helvetica')
                   .fillColor('#C0392B')
                   .text(analysis.recommendations, 50, yPos + 15, {
                       width: 500,
                       height: 50
                   });
                yPos += 70;
            }
        }

        // Add final separator line for the page
        doc.strokeColor('#BDC3C7')
           .lineWidth(2)
           .moveTo(50, yPos)
           .lineTo(550, yPos)
           .stroke();

        return yPos + 30;
    }

    // ✨ FIXED METHOD: Now properly handles both cases
    async generateReport(outputPath = './llm_visibility_report.pdf') {
        console.log('🚀 Starting PDF report generation...');
        
        try {
            await this.connect();
            const data = await this.fetchData();

            const doc = new PDFDocument({
                size: 'A4',
                margins: { top: 50, bottom: 50, left: 50, right: 50 }
            });

            // Normalize the output path to prevent double folder creation
            const normalizedOutputPath = path.resolve(outputPath);
            const outputDir = path.dirname(normalizedOutputPath);
            
            console.log(`📁 Output file will be: ${normalizedOutputPath}`);
            console.log(`📁 Output directory: ${outputDir}`);
            
            // Create output directory if it doesn't exist
            try {
                await fs.access(outputDir);
                console.log(`✓ Output directory already exists: ${outputDir}`);
            } catch {
                await fs.mkdir(outputDir, { recursive: true });
                console.log(`✓ Created output directory: ${outputDir}`);
            }

            // Create write stream and pipe the PDF
            const { createWriteStream } = await import('fs');
            const stream = createWriteStream(normalizedOutputPath);
            doc.pipe(stream);

            console.log('📝 Generating PDF content...');
            
            // --- CORE LOGIC: Handle both cases ---
            if (data.length === 0) {
                // If there's no data, generate the special "No Data" page
                console.warn('⚠ No documents with claims found. Generating a "No Data" report.');
                this.addNoDataPage(doc);
            } else {
                // Otherwise, generate the full report as before
                console.log(`📊 Processing ${data.length} pages for report...`);

                // Title page
                let yPos = this.addHeader(doc, 'LLM Visibility Analysis Report');
                
                doc.fontSize(14)
                   .fillColor('#7F8C8D')
                   .font('Helvetica')
                   .text('Comprehensive Analysis of Web Page Claims and LLM Visibility Optimization', 50, yPos + 50, {
                       width: 500,
                       align: 'center'
                   });

                // Executive Summary on separate page
                this.addExecutiveSummary(doc, data);

                // Add summary & recommendations page EARLY in the report
                this.addSummaryPage(doc, data);

                // Process each page for detailed analysis
                let processedPages = 0;
                for (const pageData of data) {
                    if (processedPages === 0) {
                        doc.addPage();
                        yPos = this.addHeader(doc, 'Detailed Page Analysis');
                        yPos += 20;
                    }
                    
                    yPos = this.addPageAnalysis(doc, pageData, yPos);
                    processedPages++;
                    if (processedPages % 5 === 0) {
                        console.log(`  Processed ${processedPages}/${data.length} pages...`);
                    }
                }
            }

            // Finalize the PDF
            doc.end();

            // Wait for the PDF to be written
            await new Promise((resolve, reject) => {
                stream.on('finish', () => {
                    console.log('✓ PDF file write completed');
                    resolve();
                });
                stream.on('error', (err) => {
                    console.error('✗ Error writing PDF file:', err);
                    reject(err);
                });
                
                // Add timeout to prevent hanging
                setTimeout(() => {
                    reject(new Error('PDF generation timed out'));
                }, 30000); // 30 second timeout
            });

            // Verify the file was created
            try {
                const stats = await fs.stat(normalizedOutputPath);
                console.log(`✓ PDF file created successfully (${Math.round(stats.size / 1024)} KB)`);
            } catch (statError) {
                console.error('✗ PDF file was not created:', statError.message);
                throw statError;
            }

            console.log(`✅ Report generated successfully: ${normalizedOutputPath}`);
            
        } catch (error) {
            console.error('❌ Error generating report:', error.message);
            console.error('Stack trace:', error.stack);
            throw error;
        } finally {
            await this.disconnect();
        }
    }
}

// Usage configuration
const config = {
    mongoUri: MONGODB_URI, // Replace with your MongoDB URI
    dbName: 'webdata',
    outputPath: path.join(__dirname, 'llm_visibility_report.pdf') // Fixed: Use path.join instead of path.resolve
};

// Main execution function
const generateReport = async () => {
    console.log('🔧 Initializing report generator with configuration:');
    console.log(`  MongoDB URI: ${config.mongoUri}`);
    console.log(`  Database: ${config.dbName}`);
    console.log(`  Output Path: ${config.outputPath}`);
    console.log('');
    
    const generator = new ProfessionalReportGenerator(config.mongoUri, config.dbName);
    
    try {
        await generator.generateReport(config.outputPath);
        console.log('🎉 Report generation completed successfully!');
    } catch (error) {
        console.error('💥 Failed to generate report:', error.message);
        
        // Provide helpful troubleshooting tips
        console.log('\n🔍 Troubleshooting tips:');
        console.log('1. Check if MongoDB is running');
        console.log('2. Verify the database name and collection exist');
        console.log('3. Ensure documents have ai.claims_evaluation.claims_evaluation data');
        console.log('4. Ensure you have write permissions to the output directory');
        console.log('5. Check your MongoDB connection string');
        
        process.exit(1);
    }
};

// Export for use as module
export default ProfessionalReportGenerator;
export { generateReport };

// FIXED: More reliable way to check if script is run directly
const isMainModule = process.argv[1] === __filename || 
                     import.meta.url === `file://${process.argv[1]}` ||
                     process.argv[1].endsWith(path.basename(__filename));

if (isMainModule) {
    console.log('📋 Script detected as main module - starting report generation...');
    generateReport().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
} else {
    console.log('📋 Script loaded as module');
}