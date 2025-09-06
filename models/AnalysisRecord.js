import mongoose from 'mongoose';

const analysisRecordSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  email: { type: String, index: true },
  url: { type: String, required: true },
  taskId: { type: String, index: true },
  status: { type: String, enum: ['queued','processing','completed','failed'], default: 'queued' },
  emailStatus: { type: String, enum: ['pending','sending','sent','failed'], default: 'pending' },
  reportDirectory: { type: String },
  emailError: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

analysisRecordSchema.index({ email: 1, createdAt: -1 });
analysisRecordSchema.index({ taskId: 1 });
// Efficient pagination per user
analysisRecordSchema.index({ user: 1, createdAt: -1 });

analysisRecordSchema.pre('save', function(next){
  this.updatedAt = new Date();
  next();
});

export default mongoose.model('AnalysisRecord', analysisRecordSchema);
