import mongoose from 'mongoose';

const ContactMessageSchema = new mongoose.Schema({
	name: { type: String, required: true, trim: true, maxlength: 120 },
	email: { type: String, required: true, lowercase: true, trim: true, maxlength: 180 },
	business: { type: String, trim: true, maxlength: 160 },
	message: { type: String, required: true, maxlength: 5000 },
	status: { type: String, enum: ['new','viewed','resolved'], default: 'new', index: true },
	viewedAt: { type: Date },
	resolvedAt: { type: Date }
}, { timestamps: true });

// Lightweight text index for searching by name/email/message
try {
	ContactMessageSchema.index({ name: 'text', email: 'text', message: 'text' });
} catch {}

const ContactMessage = mongoose.models.ContactMessage || mongoose.model('ContactMessage', ContactMessageSchema);
export default ContactMessage;

