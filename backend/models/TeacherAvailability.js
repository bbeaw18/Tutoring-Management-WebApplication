const mongoose = require('mongoose');

const SlotSchema = new mongoose.Schema({
  day: { type: Number, required: true, min: 0, max: 6 },
  start: { type: Number, required: true, min: 0, max: 1439 },
  end: { type: Number, required: true, min: 1, max: 1440 }
}, { _id: false });

const TeacherAvailabilitySchema = new mongoose.Schema({
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weekStart: { type: String, required: true },
  slots: { type: [SlotSchema], default: [] }
}, { timestamps: true });

TeacherAvailabilitySchema.index({ teacher: 1, weekStart: 1 }, { unique: true });

module.exports = mongoose.model('TeacherAvailability', TeacherAvailabilitySchema);
