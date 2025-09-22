const mongoose = require('mongoose');

const SketchSchema = new mongoose.Schema({
  title: String,
  html: String,
  css: String,
  javascript: String,
  url: String,
  hash: String,
  seed: String,
  tags: { type: [String], default: [] },
  attrs: { type: mongoose.Schema.Types.Mixed },
  layout: { type: mongoose.Schema.Types.Mixed },
  context: String,
  transforms: {
    type: new mongoose.Schema({
      min: new mongoose.Schema({ html: String, css: String, javascript: String }, { _id: false }),
      uglify: new mongoose.Schema({ javascript: String }, { _id: false })
    }, { _id: false })
  },
  enc: {
    type: new mongoose.Schema({ algo: String, salt: String, iv: String, ct: String }, { _id: false })
  },
  shares: [{ token: String, mode: String, expiresAt: Date }],
  parameters: { type: mongoose.Schema.Types.Mixed },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Sketch', SketchSchema);
