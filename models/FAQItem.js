import mongoose from 'mongoose';

const faqItemSchema = new mongoose.Schema({
  question: { type: String, required: true },
  answer: { type: String, required: true },
  category: { type: String, index: true },
  order: { type: Number, default: 0 },
  published: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

faqItemSchema.pre('save', function(next){ this.updatedAt = new Date(); next(); });

export default mongoose.model('FAQItem', faqItemSchema);
