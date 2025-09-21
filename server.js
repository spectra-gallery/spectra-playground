const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const { Sketch } = require('./models');
const dbConfig = { HOST: '127.0.0.1', PORT: 27017, DB: 'spectra_db' };

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// connect to Mongo using backend config
mongoose.connect(`mongodb://${dbConfig.HOST}:${dbConfig.PORT}/${dbConfig.DB}`, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function autoSaveSketch(req, res) {
  let sketch = null;
  const id = req.body.id;
  if (id && id !== 'undefined' && mongoose.Types.ObjectId.isValid(id)) {
    sketch = await Sketch.findById(id);
  }
  if (!sketch) {
    sketch = new Sketch({
      html: req.body.html,
      css: req.body.css,
      javascript: req.body.javascript,
      hash: req.body.hash,
    });
  } else {
    if (req.body.html) sketch.html = req.body.html;
    if (req.body.css) sketch.css = req.body.css;
    if (req.body.javascript) sketch.javascript = req.body.javascript;
    if (req.body.hash) sketch.hash = req.body.hash;
  }
  await sketch.save();
  res.send({ id: sketch._id });
}

async function getSketchById(req, res) {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).send({ message: 'Invalid id' });
  }
  const sketch = await Sketch.findById(id);
  if (!sketch) {
    return res.status(404).send({ message: 'Sketch Not found.' });
  }
  res.status(200).send({
    id: sketch._id,
    html: sketch.html,
    css: sketch.css,
    javascript: sketch.javascript,
    hash: sketch.hash,
  });
}

app.get('/', async (req, res) => {
  let sketch = { html: '', css: '', javascript: '', hash: '' };
  if (req.query.id) {
    const found = await Sketch.findById(req.query.id);
    if (found) {
      sketch = {
        html: found.html,
        css: found.css,
        javascript: found.javascript,
        hash: found.hash,
      };
    }
  }
  // Read and sanitize iframe template so </script> inside it doesn't break the outer script tag
  const rawIframeTemplate = require('fs').readFileSync(
    path.join(__dirname, 'views', 'iframe.html'),
    'utf8'
  );
  const iframeTemplate = rawIframeTemplate.replace(/<\/script>/g, '<\\/script>');
  res.render('playground', {
    sketchId: req.query.id || '',
    html: sketch.html || '',
    css: sketch.css || '',
    javascript: sketch.javascript || '',
    hash: sketch.hash || '',
    iframeTemplate,
  });
});

app.post('/autosave', autoSaveSketch);

app.get('/sketch/:id', getSketchById);

// --- Lab service integration ---
const axios = require('axios');
const API_URL = process.env.API_URL || 'http://localhost:8000/api';

function forward(method, url) {
  return async (req, res) => {
    try {
      const response = await axios({
        method,
        url: `${API_URL}${url(req.params)}`,
        data: req.body,
      });
      res.json(response.data);
    } catch (err) {
      const status = err.response ? err.response.status : 500;
      res.status(status).json({ error: err.message });
    }
  };
}

app.post('/lab/neuralmap/create', forward('post', () => '/lab/neuralmap/create'));
app.post('/lab/node/create/:id', forward('post', (p) => `/lab/node/create/${p.id}`));
app.post('/lab/link/create/:id', forward('post', (p) => `/lab/link/create/${p.id}`));

const PORT = process.env.PORT || 6002;
app.listen(PORT, () => {
  console.log(`Playground server running on port ${PORT}`);
});
