const mongoose = require('mongoose');

// Signed success callback whose bank reference could not be settled automatically.
const schema = new mongoose.Schema({
  _id: String,
  kbankTransactionId: String,
  amount: { type: Number, required: true },
  paidAt: Date,
  receivedAt: { type: Date, default: Date.now },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

module.exports = mongoose.model('KBankReconciliation', schema);
