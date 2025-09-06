import { Router } from 'express';
import ContactMessage from '../models/ContactMessage.js';
import { authRequired } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';

const router = Router();

// Public endpoint to submit a contact message
router.post('/contact', async (req,res) => {
  try {
    const { name, email, business, message } = req.body || {};
    if(!name || !email || !message) return res.status(400).json({ success:false, error: 'Missing required fields' });
    if(message.length > 5000) return res.status(400).json({ success:false, error: 'Message too long' });

    const doc = await ContactMessage.create({ name, email, business, message });
    res.status(201).json({ success:true, message: 'Message received', id: doc._id });
  } catch(e){
    res.status(500).json({ success:false, error: e.message });
  }
});

// Admin: list messages with optional filters & pagination
router.get('/admin/contact-messages', authRequired, requireAdmin, async (req,res) => {
  try {
    const { status, q, page=1, limit=20 } = req.query;
    const query = {};
    if(status) query.status = status;
    if(q){
      // Basic case-insensitive partial search across name/email/message
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [ { name: regex }, { email: regex }, { message: regex }, { business: regex } ];
    }
    const skip = (parseInt(page)-1) * parseInt(limit);
    const [items, total] = await Promise.all([
      ContactMessage.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      ContactMessage.countDocuments(query)
    ]);
    res.json({ success:true, items, total, page: parseInt(page), pages: Math.ceil(total/parseInt(limit)) });
  } catch(e){ res.status(500).json({ success:false, error: e.message }); }
});

// Admin: update status (viewed/resolved)
router.patch('/admin/contact-messages/:id/status', authRequired, requireAdmin, async (req,res) => {
  try {
    const { status } = req.body || {};
    if(!['new','viewed','resolved'].includes(status)) return res.status(400).json({ success:false, error: 'Invalid status' });
    const patch = { status };
    if(status==='viewed') patch.viewedAt = new Date();
    if(status==='resolved') patch.resolvedAt = new Date();
    const doc = await ContactMessage.findByIdAndUpdate(req.params.id, patch, { new:true });
    if(!doc) return res.status(404).json({ success:false, error: 'Not found' });
    res.json({ success:true, item: doc });
  } catch(e){ res.status(500).json({ success:false, error: e.message }); }
});

// Admin: delete message (optional cleanup)
router.delete('/admin/contact-messages/:id', authRequired, requireAdmin, async (req,res) => {
  try {
    const del = await ContactMessage.findByIdAndDelete(req.params.id);
    if(!del) return res.status(404).json({ success:false, error:'Not found' });
    res.json({ success:true });
  } catch(e){ res.status(500).json({ success:false, error: e.message }); }
});

export default router;
