const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  _id: String,
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, sparse: true },
  optedIn: { type: Boolean, default: false },
  friend: { type: Boolean, default: false },
  observedAt: { type: Number, default: 0 }
});

module.exports = mongoose.model('LineConnection', schema);
