import express from 'express';

// Export a function that creates the router with dependencies
export default function createAnalysisRoutes(analysisQueue, ultimateAnalyzer) {
  const router = express.Router();

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
    const { email, url } = req.body;
    
    if (!email || !url) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email and URL are required' 
      });
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

  // Full analysis endpoint (with queue)
  router.post('/analyze', async (req, res) => {
    const { email, url } = req.body;
    
    if (!email || !url) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email and URL are required' 
      });
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
        analysisQueue.addTask(email, url, dummyRes).catch(error => {
          console.error('Background queue error:', error);
        });
        
        // Return immediate success response
        res.json({
          success: true,
          message: 'Analysis queued successfully',
          email,
          url
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

  return router;
}
