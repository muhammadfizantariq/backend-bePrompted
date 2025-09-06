import { Router } from 'express';
import BlogPost from '../models/BlogPost.js';
import FAQItem from '../models/FAQItem.js';

const router = Router();

// Public published blog posts
router.get('/blogs', async (req,res) => {
  try {
    const posts = await BlogPost.find({ published: true }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, posts });
  } catch(e){ res.status(500).json({ success:false, error: e.message }); }
});

router.get('/blogs/:slug', async (req,res) => {
  try {
    const post = await BlogPost.findOne({ slug: req.params.slug, published: true }).lean();
    if(!post) return res.status(404).json({ success:false, error: 'Not found'});
    res.json({ success: true, post });
  } catch(e){ res.status(500).json({ success:false, error: e.message }); }
});

// Public published FAQs
router.get('/faqs', async (req,res) => {
  try {
    const faqs = await FAQItem.find({ published: true }).sort({ order: 1, createdAt: -1 }).lean();
    res.json({ success: true, faqs });
  } catch(e){ res.status(500).json({ success:false, error: e.message }); }
});

export default router;
