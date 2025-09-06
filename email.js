import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT || 587,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendScanResultsEmail({ to, score, recommendations, pdfPath }) {
  const subject = `Your AI Visibility Score & Next Steps from BePrompted.io`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #222;">
      <h2>Hi there,</h2>
      <p>Thank you for using BePrompted.io's Free Quick AI GEO Scan!</p>
      <p>Your AI Findability Score: <strong style="font-size: 1.5em; color: #2563eb;">${score}/100</strong></p>
      <p>Here's what we found and your next steps:</p>
      <ul>
        ${recommendations.map(rec => `<li>${rec}</li>`).join('')}
      </ul>
      <p>A full PDF report is attached for your records.</p>
      <hr>
      <p style="color: #555; font-size: 0.95em;">Our experts can help turn a score of ${score} into 90+. Pick a plan here to get started.</p>
      <p style="color: #888; font-size: 0.85em;">We only use your URL for this one-time analysis. Unsubscribe anytime.</p>
      <p style="margin-top: 2em; font-size: 0.9em;">Best regards,<br>BePrompted.io</p>
    </div>
  `;

  const mailOptions = {
    from: `noreply @ BePrompted.io <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
    attachments: pdfPath ? [{ filename: 'AI_Visibility_Report.pdf', path: pdfPath }] : [],
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Email sent to ${to}: ${info.messageId}`);
    if (info.accepted && info.accepted.length > 0) {
      console.log(`✅ Email accepted by: ${info.accepted.join(', ')}`);
    }
    if (info.rejected && info.rejected.length > 0) {
      console.warn(`⚠️ Email rejected by: ${info.rejected.join(', ')}`);
    }
    return info;
  } catch (err) {
    console.error(`❌ Failed to send email to ${to}:`, err.message);
    throw err;
  }
}

// Enhanced email function for full analysis results (paid service)
export async function sendFullAnalysisEmail({ to, url, reportDirectory, analysisResults }) {
  const subject = `Your Complete AI GEO Visibility Report is Ready! - BePrompted.io`;
  
  // Extract key metrics from analysis results
  const finalScore = analysisResults?.steps?.scoring?.overallScore;
  const hasValidScore = finalScore && finalScore !== 'N/A' && !isNaN(finalScore);
  const websiteAnalysis = analysisResults?.steps?.website?.success ? '✅ Complete' : '❌ Failed';
  const geoAnalysis = analysisResults?.steps?.geo?.overallSuccess ? '✅ Complete' : '❌ Failed';
  
  // Get generated reports and collect PDF attachments
  const reports = [];
  const attachments = [];

  // Helper: push attachment only if the file exists
  const safePushAttachment = (filename, filePath) => {
    if (!filePath) return;
    try {
      const fullPath = path.resolve(filePath);
      if (fs.existsSync(fullPath)) {
        attachments.push({ filename, path: fullPath });
      } else {
        console.warn(`⚠️ Attachment missing, skipping: ${filename} at ${fullPath}`);
      }
    } catch (e) {
      console.warn(`⚠️ Could not verify attachment ${filename}: ${filePath} (${e.message})`);
    }
  };
  
  if (analysisResults?.steps?.professionalReport?.success) {
    reports.push(`📄 Professional Content Analysis Report`);
  safePushAttachment('WebsiteContent_report.pdf', analysisResults.steps.professionalReport.path);
  }
  if (analysisResults?.steps?.crawlabilityReport?.success) {
    reports.push(`🔍 Crawlability & Technical Report`);
  safePushAttachment('llm_Crawlability_Report.pdf', analysisResults.steps.crawlabilityReport.path);
  }
  if (analysisResults?.steps?.geoReport?.success) {
    reports.push(`🏷️ Meta Tags & GEO Report`);
  safePushAttachment('metaTags_analysis.pdf', analysisResults.steps.geoReport.path);
  }
  if (analysisResults?.steps?.structuredDataReport?.success) {
    reports.push(`📊 Structured Data Report`);
  safePushAttachment('structuredDataAudit_report.pdf', analysisResults.steps.structuredDataReport.path);
  }
  if (analysisResults?.steps?.faqReport?.success) {
    reports.push(`❓ FAQ Schema Report`);
  safePushAttachment('faq_jsonld_report.pdf', analysisResults.steps.faqReport.path);
  }

  const html = `
    <div style="font-family: Arial, sans-serif; color: #222; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; padding: 2rem; border-radius: 10px 10px 0 0;">
        <h1 style="margin: 0; font-size: 1.5rem;">🎉 Your AI GEO Visibility Report is Ready!</h1>
        <p style="margin: 0.5rem 0 0 0; opacity: 0.9;">Complete analysis for: ${url}</p>
      </div>
      
      <div style="background: #f8fafc; padding: 2rem; border-radius: 0 0 10px 10px;">
        <h2 style="color: #1e293b; margin-top: 0;">Analysis Summary</h2>
        
        ${hasValidScore ? `
        <div style="background: white; padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem; border-left: 4px solid #6366f1;">
          <h3 style="margin: 0 0 1rem 0; color: #6366f1;">📊 Overall AI Findability Score</h3>
          <p style="font-size: 2rem; font-weight: bold; color: #1e293b; margin: 0;">${finalScore}/100</p>
        </div>
        ` : ''}

        <div style="background: white; padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem;">
          <h3 style="margin: 0 0 1rem 0; color: #1e293b;">🔍 Analysis Components</h3>
          <ul style="list-style: none; padding: 0; margin: 0;">
            <li style="padding: 0.5rem 0; border-bottom: 1px solid #e2e8f0;">Website Structure Analysis: ${websiteAnalysis}</li>
            <li style="padding: 0.5rem 0; border-bottom: 1px solid #e2e8f0;">GEO Schema Analysis: ${geoAnalysis}</li>
            <li style="padding: 0.5rem 0;">AI Scoring & Recommendations: ✅ Complete</li>
          </ul>
        </div>

        <div style="background: white; padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem;">
          <h3 style="margin: 0 0 1rem 0; color: #1e293b;">📄 Generated Reports</h3>
          ${reports.length > 0 ? `
            <ul style="margin: 0; padding-left: 1rem;">
              ${reports.map(report => `<li style="margin-bottom: 0.5rem;">${report}</li>`).join('')}
            </ul>
            <p style="color: #64748b; font-size: 0.9rem; margin-top: 1rem;">
              <strong>Note:</strong> ${attachments.length > 0 ? 
                `All ${attachments.length} reports are attached as PDF files to this email.` : 
                'Reports are being prepared and will be delivered shortly.'}
            </p>
          ` : `
            <p style="color: #ef4444;">Reports are being generated and will be delivered shortly.</p>
          `}
        </div>

        <div style="background: #e0e7ff; padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem;">
          <h3 style="margin: 0 0 1rem 0; color: #3730a3;">🚀 What's Next?</h3>
          <ol style="margin: 0; padding-left: 1.5rem; color: #1e293b;">
            <li style="margin-bottom: 0.8rem;"><strong>Review Your Reports:</strong> Each PDF contains detailed analysis and actionable recommendations</li>
            <li style="margin-bottom: 0.8rem;"><strong>Implement Recommendations:</strong> Follow the step-by-step guidance to improve your AI visibility</li>
            <li style="margin-bottom: 0.8rem;"><strong>Monitor Progress:</strong> Track improvements over time as you implement changes</li>
            <li><strong>Need Help?</strong> Our team is available for implementation support and consultations</li>
          </ol>
        </div>

        <div style="text-align: center; margin-top: 2rem;">
          <p style="color: #64748b; font-size: 0.9rem;">
            Questions? Reply to this email or contact us at support@beprompted.io
          </p>
          <p style="color: #64748b; font-size: 0.8rem; margin-top: 1.5rem;">
            This analysis was completed on ${new Date().toLocaleDateString()} for ${url}
          </p>
        </div>

        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 2rem 0;">
        
        <div style="text-align: center;">
          <p style="margin: 0; font-size: 0.9rem; color: #64748b;">
            Best regards,<br>
            <strong style="color: #6366f1;">The BePrompted.io Team</strong>
          </p>
        </div>
      </div>
    </div>
  `;

  const mailOptions = {
    from: `BePrompted.io Reports <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
    attachments: attachments // Attach all generated PDF reports
  };

  try {
    console.log(`📧 Preparing to send full analysis email to ${to} with ${attachments.length} attachments`);
    if (attachments.length > 0) {
      console.log('📎 Attachments:', attachments.map(att => att.filename).join(', '));
    }
    
  const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Full analysis email sent to ${to}: ${info.messageId}`);
    if (info.accepted && info.accepted.length > 0) {
      console.log(`✅ Email accepted by: ${info.accepted.join(', ')}`);
    }
    if (info.rejected && info.rejected.length > 0) {
      console.warn(`⚠️ Email rejected by: ${info.rejected.join(', ')}`);
    }
    return info;
  } catch (err) {
    console.error(`❌ Failed to send full analysis email to ${to}:`, err.message);
    if (err.code) {
      console.error(`   Error code: ${err.code}`);
    }
    throw err;
  }
}
