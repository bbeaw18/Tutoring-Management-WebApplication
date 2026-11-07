const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema({
  schedule: { type: mongoose.Schema.Types.ObjectId, ref: 'Schedule', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
  comment: { type: String, trim: true, maxlength: 500, default: '' }
}, { timestamps: true });

ReviewSchema.index({ schedule: 1, student: 1 }, { unique: true });
ReviewSchema.index({ student: 1 });
ReviewSchema.index({ teacher: 1 });
ReviewSchema.index({ createdAt: 1 });

module.exports = mongoose.model('Review', ReviewSchema);
