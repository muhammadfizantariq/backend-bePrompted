import PDFDocument from 'pdfkit';
import fs from 'fs';
import { MongoClient } from 'mongodb';

export default class FAQJsonLdReportGenerator {
  constructor(mongoUri, dbName, collectionName, mongoOptions = {}) {
    this.mongoUri = mongoUri;
    this.dbName = dbName;
    this.collectionName = collectionName;
    this.mongoOptions = mongoOptions;
    this.client = null;
  }

  async connect() {
    try {
      this.client = new MongoClient(this.mongoUri, this.mongoOptions);
      await this.client.connect();
      console.log('✅ Connected to MongoDB for FAQ JSON-LD Report');
    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      console.log('✅ Disconnected from MongoDB');
    }
  }

  async fetchFAQData() {
    try {
      const db = this.client.db(this.dbName);
      const collection = db.collection(this.collectionName);
      
      const query = {
        'ai.classification.faq_needed': true,
        'ai.faq_schema.faq_jsonld': { $exists: true, $ne: null }
      };

      const projection = {
        url: 1,
        'ai.faq_schema.faq_jsonld': 1
      };

      const docs = await collection.find(query, { projection }).toArray();
      console.log(`📊 Found ${docs.length} documents with FAQ JSON-LD data`);
      
      return docs;
    } catch (error) {
      console.error('❌ Error fetching FAQ data:', error);
      throw error;
    }
  }

  formatJsonForPDF(jsonObj, doc, startY, maxWidth = 400) {
    const jsonStr = JSON.stringify(jsonObj, null, 2);
    const lines = jsonStr.split('\n');
    let currentY = startY;
    const lineHeight = 14;
    const pageHeight = doc.page.height - 100;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check if we need a new page
      if (currentY > pageHeight - 50) {
        doc.addPage();
        currentY = 50;
        
        // Add page header for continuation
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#64748b');
        doc.text('(JSON-LD Schema continued...)', 50, 20);
        currentY = 60;
      }

      // JSON container background for each section
      if (i === 0 || currentY === 60) {
        const remainingLines = Math.min(lines.length - i, Math.floor((pageHeight - currentY - 50) / lineHeight));
        const containerHeight = remainingLines * lineHeight + 20;
        doc.rect(50, currentY - 10, maxWidth + 20, containerHeight).fillAndStroke('#f8fafc', '#e2e8f0');
      }

      // Color coding for JSON syntax
      let lineColor = '#1e293b';
      if (line.includes('"@')) {
        lineColor = '#7c3aed'; // Purple for schema.org properties
      } else if (line.includes(': "') || line.includes('": "')) {
        lineColor = '#059669'; // Green for string values
      } else if (line.includes('{') || line.includes('}') || line.includes('[') || line.includes(']')) {
        lineColor = '#dc2626'; // Red for brackets
      }

      // Always set consistent font and color before rendering
      doc.font('Courier', 9).fillColor(lineColor);

      // Handle long lines by wrapping instead of truncating
      const words = line.split(' ');
      let currentLine = '';
      
      for (const word of words) {
        const testLine = currentLine + (currentLine ? ' ' : '') + word;
        const testWidth = doc.widthOfString(testLine);
        
        if (testWidth <= maxWidth - 20) {
          currentLine = testLine;
        } else {
          if (currentLine) {
            doc.text(currentLine, 60, currentY, { width: maxWidth });
            currentY += lineHeight;
            
            // Check for page break within line wrapping
            if (currentY > pageHeight - 50) {
              doc.addPage();
              doc.fontSize(12).font('Helvetica-Bold').fillColor('#64748b');
              doc.text('(JSON-LD Schema continued...)', 50, 20);
              currentY = 60;
              
              // Re-add container background
              const remainingLinesFromHere = Math.min(lines.length - i, Math.floor((pageHeight - currentY - 50) / lineHeight));
              const newContainerHeight = remainingLinesFromHere * lineHeight + 20;
              doc.rect(50, currentY - 10, maxWidth + 20, newContainerHeight).fillAndStroke('#f8fafc', '#e2e8f0');
              
              // Reset font and color after page break
              doc.font('Courier', 9).fillColor(lineColor);
            }
          }
          currentLine = word;
        }
      }
      
      // Print the remaining part of the line
      if (currentLine) {
        doc.text(currentLine, 60, currentY, { width: maxWidth });
        currentY += lineHeight;
      }
    }

    return currentY + 30; // Add spacing after JSON
  }

  generateIntroPage(doc) {
    const pageWidth = doc.page.width;
    const centerX = pageWidth / 2;

    // Header gradient background
    doc.rect(0, 0, pageWidth, 180).fillAndStroke('#2563eb', '#1e40af');

    // Title
    doc.fontSize(32).font('Helvetica-Bold').fillColor('#ffffff');
    const titleText = 'FAQ JSON-LD Schema Report';
    const titleWidth = doc.widthOfString(titleText);
    doc.text(titleText, centerX - titleWidth / 2, 40);

    // Subtitle
    doc.fontSize(16).font('Helvetica').fillColor('#e0e7ff');
    const subtitleText = 'Generative Engine Optimization Analysis';
    const subtitleWidth = doc.widthOfString(subtitleText);
    doc.text(subtitleText, centerX - subtitleWidth / 2, 85);

    // Date
    const currentDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    doc.fontSize(12).fillColor('#cbd5e1');
    const dateText = `Generated on ${currentDate}`;
    const dateWidth = doc.widthOfString(dateText);
    doc.text(dateText, centerX - dateWidth / 2, 130);

    // Reset fill color for body content
    doc.fillColor('#000000');

    // Section header with accent bar
    doc.rect(50, 220, 4, 30).fill('#2563eb');
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#1e293b');
    doc.text('Why FAQ JSON-LD Schema Matters for GEO', 65, 225);

    // Content with improved styling
    doc.fontSize(11).font('Helvetica').fillColor('#374151').lineGap(8);
    
    const benefits = [
      {
        title: 'Direct Answer Provision',
        desc: 'FAQ schema provides direct, concise answers to common questions, making it easier for AI systems to extract and cite relevant information.'
      },
      {
        title: 'Enhanced Discoverability', 
        desc: 'Search engines and AI models can better understand your content structure, leading to improved visibility in search results and AI-generated responses.'
      },
      {
        title: 'Context and Relevance',
        desc: 'FAQ structured data helps AI understand the context of questions and answers, enabling more accurate and relevant responses to user queries.'
      },
      {
        title: 'Featured Snippet Opportunities',
        desc: 'Properly structured FAQ data increases chances of appearing in featured snippets and voice search results.'
      },
      {
        title: 'Authority Building',
        desc: 'Clear, well-structured FAQ content demonstrates expertise and authority on topics, which AI systems factor into their responses.'
      },
      {
        title: 'User Experience',
        desc: 'FAQ JSON-LD helps create better user experiences by providing quick, direct answers to common questions.'
      }
    ];

    let currentY = 275;
    benefits.forEach((benefit, index) => {
      // Number circle
      doc.circle(60, currentY + 8, 10).fillAndStroke('#2563eb', '#1e40af');
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff');
      doc.text(`${index + 1}`, 56, currentY + 4);

      // Benefit title
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e293b');
      doc.text(benefit.title, 85, currentY);

      // Benefit description
      doc.fontSize(10).font('Helvetica').fillColor('#64748b');
      doc.text(benefit.desc, 85, currentY + 15, { width: 450, lineGap: 2 });

      currentY += 65;
    });

    // Bottom section
    doc.fontSize(11).font('Helvetica').fillColor('#374151');
    const bottomText = 'The following pages show URLs from your website that have been identified as needing FAQ structured data, along with the suggested JSON-LD implementation.';
    doc.text(bottomText, 50, currentY + 20, { width: 500, lineGap: 4 });

    doc.addPage();
  }

  generateFAQPages(doc, faqData) {
    faqData.forEach((item, index) => {
      // Page header
      doc.fontSize(18).font('Helvetica-Bold');
      doc.text(`FAQ Schema #${index + 1}`, 50, 50);

      // URL
      doc.fontSize(12).font('Helvetica-Bold');
      doc.text('URL:', 50, 90);
      doc.fontSize(10).font('Helvetica');
      doc.text(item.url, 50, 110, { width: 500 });

      // FAQ JSON-LD Schema
      doc.fontSize(12).font('Helvetica-Bold');
      doc.text('Suggested FAQ JSON-LD Schema:', 50, 140);

      // Format and display JSON
      const nextY = this.formatJsonForPDF(item.ai.faq_schema.faq_jsonld, doc, 160);

      // Implementation note
      doc.fontSize(10).font('Helvetica-Oblique');
      const implementationNote = `Implementation: Add this JSON-LD script to the <head> section of the page or in the body. This structured data will help search engines and AI systems understand your FAQ content better.`;
      
      if (nextY < doc.page.height - 150) {
        doc.text(implementationNote, 50, nextY, { width: 500 });
      }

      // Add new page unless it's the last item
      if (index < faqData.length - 1) {
        doc.addPage();
      }
    });
  }

  async generatePDFReport(outputPath) {
    try {
      await this.connect();
      
      const faqData = await this.fetchFAQData();
      
      // Create output directory if it doesn't exist
      const outputDir = outputPath.substring(0, outputPath.lastIndexOf('/'));
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      if (faqData.length === 0) {
        console.log('⚠️ No FAQ JSON-LD data found');
        // Create a simple report indicating no data
        const doc = new PDFDocument();
        doc.pipe(fs.createWriteStream(outputPath));
        
        doc.fontSize(20).font('Helvetica-Bold');
        doc.text('FAQ JSON-LD Schema Report', 50, 50);
        doc.fontSize(12).font('Helvetica');
        doc.text('No FAQ JSON-LD data found in the database.', 50, 100);
        doc.end();
        
        await this.disconnect();
        return;
      }

      // Create PDF document
      const doc = new PDFDocument({
        margin: 50,
        info: {
          Title: 'FAQ JSON-LD Schema Report',
          Author: 'SEO Analysis Tool',
          Subject: 'FAQ Structured Data for GEO',
          Keywords: 'FAQ, JSON-LD, SEO, GEO, Structured Data'
        }
      });

      doc.pipe(fs.createWriteStream(outputPath));

      // Generate intro page
      this.generateIntroPage(doc);

      // Generate FAQ pages
      this.generateFAQPages(doc, faqData);

      // Summary page
      doc.addPage();
      const pageWidth = doc.page.width;
      

      
      // Footer
      doc.fontSize(10).font('Helvetica-Oblique').fillColor('#6b7280');
      const footerText = `Report generated on ${new Date().toLocaleString()} | FAQ JSON-LD Schema Analysis`;
      doc.text(footerText, 50, doc.page.height - 40, { width: pageWidth - 100, align: 'center' });

      doc.end();

      console.log(`✅ FAQ JSON-LD report generated successfully: ${outputPath}`);
      
      await this.disconnect();
    } catch (error) {
      console.error('❌ Error generating FAQ JSON-LD report:', error);
      await this.disconnect();
      throw error;
    }
  }
}