import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String }, // optional for social accounts
  createdAt: { type: Date, default: Date.now },
  verified: { type: Boolean, default: false },
  verificationTokenHash: { type: String, index: true },
  verificationExpires: { type: Date },
  resetTokenHash: { type: String, index: true },
  resetExpires: { type: Date },
  provider: { type: String, default: 'local' },
  googleId: { type: String, index: true },
  role: { type: String, enum: ['user','admin'], default: 'user', index: true }
});

userSchema.index({ email: 1 }, { unique: true });

export default mongoose.model('User', userSchema);
