import express from 'express';
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';

// Helper: normalize URL (prefer https). Returns {candidateUrls, input}
function buildCandidateUrls(input) {
  const raw = (input || '').trim();
  if (!raw) return { input: raw, candidateUrls: [] };
  // If already has protocol, use as-is only
  if (/^https?:\/\//i.test(raw)) {
    return { input: raw, candidateUrls: [raw] };
  }
  // Strip leading protocol-like text if malformed
  const cleaned = raw.replace(/^\w+:\/\//, '');
  // Prefer https first, then http
  return {
    input: raw,
    candidateUrls: [
      `https://${cleaned}`,
      `http://${cleaned}`
    ]
  };
}

async function tryFetch(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Try HEAD first
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    if (!res.ok || res.status === 405) {
      // Some servers don't support HEAD well; try GET lightweight
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    }
    const finalUrl = res.url || url;
    return { ok: true, status: res.status, finalUrl, redirected: res.redirected };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    clearTimeout(t);
  }
}

// Export a function that creates the router with dependencies
export default function createAnalysisRoutes(analysisQueue, ultimateAnalyzer) {
  const router = express.Router();

  // Helper: extract email from body or JWT (if user is authenticated)
  function extractEmail(req, bodyEmail) {
    if (bodyEmail) return bodyEmail;
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) {
      const token = auth.slice(7);
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
        // common payload key names
        return decoded.email || decoded.userEmail || decoded.user || null;
      } catch { /* ignore decode errors */ }
    }
    return null;
  }

  // Queue status endpoint
  router.get('/queue-status', (req, res) => {
    if (analysisQueue) {
      const queueStatus = analysisQueue.getStatus();
      res.json(queueStatus);
    } else {
      res.json({ error: 'Queue not available' });
    }
  });

  // Health check endpoint
  router.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: {
        mongodb: !!process.env.MONGODB_URI,
        openai: !!process.env.OPENAI_API_KEY,
        jina: !!process.env.JINA_API_KEY
      },
      config: {
        database: process.env.DB_NAME || 'webdata',
        collection: process.env.COLLECTION_NAME || 'extractions_3'
      }
    });
  });

  // Quick scan endpoint
  router.post('/quick-scan', async (req, res) => {
    const { email: bodyEmail, url } = req.body || {};
    const email = extractEmail(req, bodyEmail);
    if (!email || !url) {
      return res.status(400).json({ success: false, error: 'Email and URL are required' });
    }

    try {
      if (ultimateAnalyzer) {
        const result = await ultimateAnalyzer.runQuickScan(url, email);
        res.json(result);
      } else {
        res.status(500).json({
          success: false,
          error: 'Analyzer not available'
        });
      }
    } catch (error) {
      console.error('💥 Quick scan server error:', error);
      res.status(500).json({ 
        success: false, 
        error: `Server error: ${error.message}` 
      });
    }
  });

  // URL precheck (normalize + reachability)
  router.post('/precheck-url', async (req, res) => {
    const { url } = req.body || {};
    const { candidateUrls, input } = buildCandidateUrls(url);
    if (!candidateUrls.length) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    for (const candidate of candidateUrls) {
      const result = await tryFetch(candidate, 8000);
      if (result.ok) {
        return res.json({
          success: true,
          input,
          normalizedUrl: candidate,
          finalUrl: result.finalUrl,
          status: result.status,
          redirected: !!result.redirected
        });
      }
    }

    // If all variants failed, return the last error
    return res.status(400).json({
      success: false,
      input,
      error: 'URL not reachable. Please check the domain and try again.'
    });
  });

  // Full analysis endpoint (with queue)
  router.post('/analyze', async (req, res) => {
    const { email: bodyEmail, url } = req.body || {};
    const email = extractEmail(req, bodyEmail);
    if (!email || !url) {
      return res.status(400).json({ success: false, error: 'Email and URL are required' });
    }

    try {
      if (analysisQueue) {
        // For payment success flow, return immediate response and queue in background
        console.log(`📋 Queueing analysis for ${url} by ${email}`);
        
        // Create a dummy response object for the queue
        const dummyRes = {
          status: () => ({ json: () => {} }),
          json: () => {},
          headersSent: false
        };
        
        // Add task to queue in background
        const { duplicate, taskId } = await analysisQueue.addTask(email, url, dummyRes);
        if (duplicate) {
          return; // addTask already responded in duplicate case
        }
        // Return immediate success response with taskId
        res.json({
          success: true,
          message: 'Analysis queued successfully',
          email,
          url,
          taskId,
          status: analysisQueue.getTaskStatus(taskId)
        });
        
      } else {
        res.status(500).json({
          success: false,
          error: 'Analysis queue not available'
        });
      }
    } catch (error) {
      console.error('Analysis queue error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Failed to queue analysis request',
          details: error.message
        });
      }
    }
  });

  // Get status for a specific taskId
  router.get('/analysis-status/:taskId', (req, res) => {
    if (!analysisQueue) return res.status(500).json({ error: 'Queue not available' });
    const status = analysisQueue.getTaskStatus(req.params.taskId);
    if (!status) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true, status });
  });

  // Get statuses for all tasks for a given email (query param)
  router.get('/analysis-status', (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email query param required' });
    if (!analysisQueue) return res.status(500).json({ error: 'Queue not available' });
    const statuses = analysisQueue.getStatusesForEmail(email);
    res.json({ success: true, tasks: statuses });
  });

  return router;
}
