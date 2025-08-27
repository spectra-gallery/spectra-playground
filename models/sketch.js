const mongoose = require('mongoose');

const SketchSchema = new mongoose.Schema({
  html: String,
  css: String,
  javascript: String,
  url: String,
  hash: String,
  date: { type: Date, default: new Date().toISOString() }
});

module.exports = mongoose.model('Sketch', SketchSchema);
