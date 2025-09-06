import { Router } from 'express';
import BlogPost from '../models/BlogPost.js';
import FAQItem from '../models/FAQItem.js';
import AnalysisRecord from '../models/AnalysisRecord.js';
import { authRequired } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
// Lightweight slugify helper (avoids external dependency)
function slugify(str){
  return (str||'')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .substring(0,120);
}

const router = Router();

// --- Blog Posts CRUD ---
router.get('/blogs', async (req,res)=>{
  const posts = await BlogPost.find().sort({ createdAt: -1 }).lean();
  res.json({ success: true, posts });
});

router.get('/blogs/:slug', async (req,res)=>{
  const post = await BlogPost.findOne({ slug: req.params.slug });
  if(!post) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true, post });
});

router.post('/blogs', authRequired, requireAdmin, async (req,res)=>{
  try {
    const { title, content, excerpt, category, author, readTime, featured, published } = req.body;
    if(!title || !content || !excerpt) return res.status(400).json({ error: 'Missing fields' });
    const slug = slugify(title, { lower: true, strict: true });
    const exists = await BlogPost.findOne({ slug });
    if(exists) return res.status(409).json({ error: 'Slug exists' });
    if(featured){ await BlogPost.updateMany({ featured: true }, { $set: { featured: false } }); }
    const post = await BlogPost.create({ title, content, excerpt, category, author, readTime, featured: !!featured, published: published!==false, slug });
    res.status(201).json({ success: true, post });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

router.put('/blogs/:id', authRequired, requireAdmin, async (req,res)=>{
  try {
    const { title, content, excerpt, category, author, readTime, featured, published } = req.body;
    const update = { title, content, excerpt, category, author, readTime, published };
    if(featured){
      await BlogPost.updateMany({ featured: true }, { $set: { featured: false } });
      update.featured = true;
    } else if (featured === false) {
      update.featured = false;
    }
    if(title){ update.slug = slugify(title, { lower: true, strict: true }); }
    const post = await BlogPost.findByIdAndUpdate(req.params.id, update, { new: true });
    if(!post) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, post });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

router.delete('/blogs/:id', authRequired, requireAdmin, async (req,res)=>{
  try { const del = await BlogPost.findByIdAndDelete(req.params.id); if(!del) return res.status(404).json({ error: 'Not found' }); res.json({ success: true }); } catch(e){ res.status(500).json({ error: e.message }); }
});

// --- FAQ CRUD ---
router.get('/faqs', async (req,res)=>{
  const faqs = await FAQItem.find().sort({ order: 1, createdAt: -1 }).lean();
  res.json({ success: true, faqs });
});

router.post('/faqs', authRequired, requireAdmin, async (req,res)=>{
  try { const { question, answer, category, order, published } = req.body; if(!question || !answer) return res.status(400).json({ error: 'Missing fields' }); const faq = await FAQItem.create({ question, answer, category, order, published }); res.status(201).json({ success: true, faq }); } catch(e){ res.status(500).json({ error: e.message }); }
});

router.put('/faqs/:id', authRequired, requireAdmin, async (req,res)=>{
  try { const { question, answer, category, order, published } = req.body; const faq = await FAQItem.findByIdAndUpdate(req.params.id, { question, answer, category, order, published }, { new: true }); if(!faq) return res.status(404).json({ error: 'Not found' }); res.json({ success: true, faq }); } catch(e){ res.status(500).json({ error: e.message }); }
});

router.delete('/faqs/:id', authRequired, requireAdmin, async (req,res)=>{
  try { const del = await FAQItem.findByIdAndDelete(req.params.id); if(!del) return res.status(404).json({ error: 'Not found' }); res.json({ success: true }); } catch(e){ res.status(500).json({ error: e.message }); }
});

// --- Analysis Records (admin) ---
router.get('/analysis-records', authRequired, requireAdmin, async (req,res)=>{
  try {
    const { status, email, q, page=1, limit=25 } = req.query;
    const query = {};
    if(status) query.status = status;
    if(email) query.email = email;
    if(q){
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'i');
      query.$or = [ { url: regex }, { email: regex }, { taskId: regex } ];
    }
    const skip = (parseInt(page)-1) * parseInt(limit);
    const [items,total] = await Promise.all([
      AnalysisRecord.find(query).sort({ createdAt:-1 }).skip(skip).limit(parseInt(limit)).lean(),
      AnalysisRecord.countDocuments(query)
    ]);
    res.json({ success:true, items, total, page: parseInt(page), pages: Math.ceil(total/parseInt(limit)) });
  } catch(e){ res.status(500).json({ success:false, error: e.message }); }
});

export default router;
