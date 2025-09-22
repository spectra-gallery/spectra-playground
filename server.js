const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const { Sketch, User } = require('./models');
const crypto = require('crypto');
const dbConfig = {
  HOST: process.env.DB_HOST || '127.0.0.1',
  PORT: parseInt(process.env.DB_PORT || '27017', 10),
  DB: process.env.DB_NAME || 'spectra_db'
};

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
// Serve licensor tool under /licensor-tools
app.use('/licensor-tools', express.static(path.join(__dirname, 'spectra-licensor')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// connect to Mongo using backend config
mongoose.connect(`mongodb://${dbConfig.HOST}:${dbConfig.PORT}/${dbConfig.DB}`, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// --- Palette tag derivation (server-side) -----------------------
function hexToRgb(hex){
  const h = hex.replace('#','');
  const s = h.length === 3 ? h.split('').map(c=>c+c).join('') : h;
  const int = parseInt(s, 16);
  return { r:(int>>16)&255, g:(int>>8)&255, b:int&255 };
}
function rgbToHsl(r,g,b){
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b); let h,s; const l=(max+min)/2;
  if (max===min){ h=s=0; }
  else {
    const d=max-min; s = l>0.5 ? d/(2-max-min) : d/(max+min);
    switch(max){ case r: h=(g-b)/d + (g<b?6:0); break; case g: h=(b-r)/d + 2; break; default: h=(r-g)/d + 4; }
    h*=60;
  }
  return { h, s, l };
}
function relativeLuminance(r,g,b){
  const srgb=[r,g,b].map(v=>{ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
  return 0.2126*srgb[0]+0.7152*srgb[1]+0.0722*srgb[2];
}
function extractColorsFromText(text){
  const counts = new Map();
  const push = (hex)=>{ if(!hex) return; const h = hex.toLowerCase(); counts.set(h, (counts.get(h)||0)+1); };
  // hex colors (#fff, #ffffff)
  const hexRe = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g; let m;
  while ((m = hexRe.exec(text))){
    const raw = m[0];
    const h = raw.length===4 ? ('#'+raw[1]+raw[1]+raw[2]+raw[2]+raw[3]+raw[3]) : raw;
    push(h);
  }
  // rgb/rgba
  const rgbRe = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)/gi; let r;
  while ((r = rgbRe.exec(text))){
    const a = r[4]!==undefined ? parseFloat(r[4]) : 1; if (a < 0.2) continue;
    const rr = Math.max(0,Math.min(255, parseInt(r[1])));
    const gg = Math.max(0,Math.min(255, parseInt(r[2])));
    const bb = Math.max(0,Math.min(255, parseInt(r[3])));
    const hex = '#'+[rr,gg,bb].map(x=>x.toString(16).padStart(2,'0')).join('');
    push(hex);
  }
  const sorted = [...counts.entries()].sort((a,b)=>b[1]-a[1]).map(([h])=>h);
  const uniq = [];
  const dist = (h1,h2)=>{ const a=parseInt(h1.slice(1),16), b=parseInt(h2.slice(1),16); const r1=(a>>16)&255,g1=(a>>8)&255,b1=a&255; const r2=(b>>16)&255,g2=(b>>8)&255,b2=b&255; const dr=r1-r2,dg=g1-g2,db=b1-b2; return Math.sqrt(dr*dr+dg*dg+db*db); };
  for (const h of sorted){ if (!uniq.some(u=> dist(u,h)<30)) uniq.push(h); if (uniq.length>=6) break; }
  return uniq;
}
function derivePaletteTagsFromHexes(hexes){
  if (!hexes || !hexes.length) return [];
  const cols = hexes.map(h=>{ const {r,g,b}=hexToRgb(h); const hsl=rgbToHsl(r,g,b); const lum=relativeLuminance(r,g,b); const warmth=180-Math.min(Math.abs(hsl.h-60), 360-Math.abs(hsl.h-60)); return {hsl, lum, warmth}; });
  const clamp01 = (v)=> Math.max(0, Math.min(1, v));
  // hue span
  const hs = cols.map(c=>c.hsl.h).sort((a,b)=>a-b);
  const gaps = hs.map((h,i)=> i===0 ? h + 360 - hs[hs.length-1] : h - hs[i-1]);
  const hueSpanScore = clamp01((360 - Math.max(...gaps)) / 360);
  const lumRange = Math.max(...cols.map(c=>c.lum)) - Math.min(...cols.map(c=>c.lum));
  const satRange = Math.max(...cols.map(c=>c.hsl.s)) - Math.min(...cols.map(c=>c.hsl.s));
  const warmthSpread = Math.max(...cols.map(c=>c.warmth)) - Math.min(...cols.map(c=>c.warmth));
  // complementary proximity
  let compBest = 0; for (let i=0;i<cols.length-1;i++){ for (let j=i+1;j<cols.length;j++){ const d = Math.abs(cols[i].hsl.h - cols[j].hsl.h); const diff = Math.min(d, 360-d); const closeness = 1 - Math.abs(diff - 180)/180; compBest = Math.max(compBest, closeness); } }
  // simultaneous light-dark
  const lights = cols.filter(c=> c.hsl.l >= 0.6).length;
  const darks = cols.filter(c=> c.hsl.l <= 0.4).length;
  const simultaneousScore = clamp01(Math.min(lights, darks) / 3);
  // decide tags
  const tags = [];
  const push = (t)=>{ if(!tags.includes(t)) tags.push(t); };
  const entries = [
    ['hue', hueSpanScore],
    ['light-dark', clamp01(lumRange)],
    ['warm-cool', clamp01(warmthSpread/180)],
    ['saturation', clamp01(satRange)],
    ['complementary', compBest],
    ['simultaneous', simultaneousScore],
  ].sort((a,b)=> b[1]-a[1]).slice(0,3);
  for (const [name] of entries) push(name);
  if (satRange >= 0.5) push('high-saturation');
  if (lumRange >= 0.5) push('high-contrast');
  return tags;
}
function derivePaletteTagsServer(html, css){
  try {
    const hexes = extractColorsFromText((css||'') + '\n' + (html||''));
    return derivePaletteTagsFromHexes(hexes);
  } catch { return []; }
}
function derivePaletteMetrics(html, css){
  try {
    const hexes = extractColorsFromText((css||'') + '\n' + (html||''));
    const rgb = hexes.map(h=>{ const {r,g,b}=hexToRgb(h); const {h:hue,s,l}=rgbToHsl(r,g,b); const lum=relativeLuminance(r,g,b); return { hex:h, rgb:{r,g,b}, hsl:{h:hue,s,l}, lum }; });
    // Compute same metrics as in tag derivation
    const cols = rgb;
    const clamp01 = (v)=> Math.max(0, Math.min(1, v));
    const hs = cols.map(c=>c.hsl.h).sort((a,b)=>a-b);
    const gaps = hs.map((h,i)=> i===0 ? h + 360 - hs[hs.length-1] : h - hs[i-1]);
    const hueSpan = (360 - Math.max(...gaps));
    const lumRange = Math.max(...cols.map(c=>c.lum)) - Math.min(...cols.map(c=>c.lum));
    const satRange = Math.max(...cols.map(c=>c.hsl.s)) - Math.min(...cols.map(c=>c.hsl.s));
    const warmth = cols.map(c=> 180 - Math.min(Math.abs(c.hsl.h-60), 360-Math.abs(c.hsl.h-60)));
    const warmthSpread = Math.max(...warmth) - Math.min(...warmth);
    let maxComplement = 0; for (let i=0;i<cols.length-1;i++){ for (let j=i+1;j<cols.length;j++){ const d=Math.abs(cols[i].hsl.h - cols[j].hsl.h); const diff = Math.min(d, 360-d); const closeness = 1 - Math.abs(diff - 180)/180; maxComplement = Math.max(maxComplement, closeness); } }
    const lights = cols.filter(c=> c.hsl.l >= 0.6).length; const darks = cols.filter(c=> c.hsl.l <= 0.4).length; const simultaneous = clamp01(Math.min(lights, darks)/3);
    return {
      colors: hexes,
      metrics: {
        hueSpan,
        lightDark: lumRange,
        saturation: satRange,
        warmCool: warmthSpread/180,
        complementary: maxComplement,
        simultaneous,
      }
    };
  } catch { return { colors: [], metrics: {} }; }
}

// --- Auth utils (no external deps) ---
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function signJWT(payload, secret, expiresInSec = 60 * 60 * 24 * 7) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSec };
  const head = base64url(JSON.stringify(header));
  const pay = base64url(JSON.stringify(body));
  const data = `${head}.${pay}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${data}.${sig}`;
}
function verifyJWT(token, secret) {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const data = `${h}.${p}`;
    const sig = crypto.createHmac('sha256', secret).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    if (sig !== s) return null;
    const payload = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch { return null; }
}
function authMiddleware(req, res, next) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'Unauthorized' });
  const payload = verifyJWT(m[1], JWT_SECRET);
  if (!payload) return res.status(401).json({ error: 'Invalid token' });
  req.user = payload; // { id, username }
  next();
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const key = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

async function autoSaveSketch(req, res) {
  let sketch = null;
  const id = req.body.id;
  if (id && id !== 'undefined' && mongoose.Types.ObjectId.isValid(id)) {
    sketch = await Sketch.findById(id);
  }
  if (!sketch) {
    sketch = new Sketch({
      title: req.body.title,
      html: req.body.html,
      css: req.body.css,
      javascript: req.body.javascript,
      hash: req.body.hash,
      seed: req.body.seed,
      tags: Array.isArray(req.body.tags) ? req.body.tags : (typeof req.body.tags === 'string' ? req.body.tags.split(',').map(t=>t.trim()).filter(Boolean) : []),
      attrs: req.body.attrs || undefined,
      userId: req.user ? req.user.id : undefined,
    });
  } else {
    if (req.body.title !== undefined) sketch.title = req.body.title;
    if (req.body.html !== undefined) sketch.html = req.body.html;
    if (req.body.css !== undefined) sketch.css = req.body.css;
    if (req.body.javascript !== undefined) sketch.javascript = req.body.javascript;
    if (req.body.hash !== undefined) sketch.hash = req.body.hash;
    if (req.body.seed !== undefined) sketch.seed = req.body.seed;
    if (req.body.tags !== undefined) {
      sketch.tags = Array.isArray(req.body.tags) ? req.body.tags : (typeof req.body.tags === 'string' ? req.body.tags.split(',').map(t=>t.trim()).filter(Boolean) : []);
    }
    if (req.body.attrs !== undefined) sketch.attrs = req.body.attrs;
    if (req.body.context !== undefined) sketch.context = req.body.context;
  }
  // Derive palette tags from CSS/HTML and merge into tags set
  try {
    const derived = derivePaletteTagsServer(sketch.html, sketch.css);
    if (derived && derived.length){
      const set = new Set(sketch.tags || []);
      derived.forEach(t=> set.add(t));
      sketch.tags = Array.from(set);
    }
    // Store palette colors and metrics
    const pal = derivePaletteMetrics(sketch.html, sketch.css);
    if (!sketch.attrs) sketch.attrs = {};
    sketch.attrs.palette = pal;
  } catch {}
  await sketch.save();
  res.send({ id: sketch._id });
}

// Simple proxy to allow client templates to fetch external APIs via same-origin
app.all('/proxy', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error:'Invalid url' });
    // Whitelist check
    const wl = (process.env.PROXY_WHITELIST || '').split(',').map(s=>s.trim()).filter(Boolean);
    if (wl.length){
      try { const u = new URL(url); const host = u.hostname; if (!wl.some(domain => host===domain || host.endsWith('.'+domain))) { return res.status(403).json({ error:'Proxy domain not allowed' }); } } catch { return res.status(400).json({ error:'Invalid url' }); }
    }
    // Basic size safeguards
    const method = (req.method || 'GET').toUpperCase();
    const axios = require('axios');
    const resp = await axios({ url, method, data: req.body, headers: { 'Accept': '*/*' } , timeout: 15000 });
    const ct = resp.headers['content-type'] || 'application/octet-stream';
    res.set('content-type', ct);
    // Optional CORS allowlist response
    const allow = (process.env.PROXY_CORS_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
    if (allow.length){ res.set('Access-Control-Allow-Origin', allow.join(',')); }
    res.status(resp.status).send(resp.data);
  } catch (e) {
    res.status(502).json({ error: 'Proxy failed', details: e.message });
  }
});

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
    seed: sketch.seed,
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
    title: sketch.title || '',
    html: sketch.html || '',
    css: sketch.css || '',
    javascript: sketch.javascript || '',
    hash: sketch.hash || '',
    seed: sketch.seed || '',
    tags: (sketch.tags || []).join(', '),
    attrs: sketch.attrs ? JSON.stringify(sketch.attrs, null, 2) : '',
    traits: sketch.attrs && sketch.attrs.traits ? JSON.stringify(sketch.attrs.traits, null, 2) : '',
    context: sketch.context || '# Notes\n',
    iframeTemplate,
  });
});

// Autosave can be anonymous; if Authorization header is present and valid, associate user
app.post('/autosave', (req, res, next) => {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const payload = verifyJWT(m[1], JWT_SECRET);
    if (payload) req.user = payload;
  }
  return autoSaveSketch(req, res, next);
});

app.get('/sketch/:id', getSketchById);

// Tag and attribute updates (owner-only)
app.post('/sketch/:id/tags', authMiddleware, async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
  const sketch = await Sketch.findById(id);
  if (!sketch) return res.status(404).json({ error: 'Not found' });
  if (sketch.userId && sketch.userId.toString() !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  sketch.tags = Array.isArray(req.body.tags) ? req.body.tags : (typeof req.body.tags === 'string' ? req.body.tags.split(',').map(t=>t.trim()).filter(Boolean) : []);
  await sketch.save();
  res.json({ ok: true, tags: sketch.tags });
});
app.post('/sketch/:id/attrs', authMiddleware, async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
  const sketch = await Sketch.findById(id);
  if (!sketch) return res.status(404).json({ error: 'Not found' });
  if (sketch.userId && sketch.userId.toString() !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  sketch.attrs = req.body.attrs || {};
  await sketch.save();
  res.json({ ok: true, attrs: sketch.attrs });
});

// Sketch layout (owner-only for write, public read)
app.get('/sketch/:id/layout', async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
  const sketch = await Sketch.findById(id).lean();
  if (!sketch) return res.status(404).json({ error: 'Not found' });
  res.json({ layout: sketch.layout || null });
});
app.post('/sketch/:id/layout', authMiddleware, async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
  const sketch = await Sketch.findById(id);
  if (!sketch) return res.status(404).json({ error: 'Not found' });
  if (sketch.userId && sketch.userId.toString() !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  sketch.layout = req.body.layout || null;
  await sketch.save();
  res.json({ ok: true });
});

// Licensor view for a sketch
app.get('/licensor/:id', async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).send('Invalid id');
  const sketch = await Sketch.findById(id).lean();
  if (!sketch) return res.status(404).send('Not found');
  const attrs = sketch.attrs || {};
  res.render('licensor', {
    id,
    attrs,
    namespace: attrs.namespace || '',
    authority: attrs.authority || '',
    properties: Array.isArray(attrs.properties) ? attrs.properties.join(', ') : ''
  });
});

app.post('/sketch/:id/title', authMiddleware, async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
  const sketch = await Sketch.findById(id);
  if (!sketch) return res.status(404).json({ error: 'Not found' });
  if (sketch.userId && sketch.userId.toString() !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  sketch.title = req.body.title || '';
  await sketch.save();
  res.json({ ok: true, title: sketch.title });
});

// Build full HTML for download
app.get('/sketch/:id/download', async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).send('Invalid id');
  const sketch = await Sketch.findById(id);
  if (!sketch) return res.status(404).send('Not found');
  const format = (req.query.format || '').toLowerCase();
  const variant = (req.query.variant || 'orig').toLowerCase();
  let doc = '';
  if (format === 'yugen') {
    // Use license_wrapper template modeled after yugen for seeded output
    const ejs = require('ejs');
    const tpl = require('fs').readFileSync(path.join(__dirname, 'views', 'license_wrapper.html'), 'utf8');
    const attrs = sketch.attrs || {};
    const license = (attrs.licenses && (attrs.licenses.software || attrs.licenses.art || attrs.licenses.data || attrs.licenses.hardware)) || attrs.license || '';
    const namespace = attrs.namespace || '';
    const authority = attrs.authority || '';
    const properties = (attrs.properties && Array.isArray(attrs.properties)) ? attrs.properties.join(', ') : '';
    // choose sources based on variant
    const choose = (orig, kind)=>{
      if (variant === 'min'){
        if (kind==='html') return (sketch.transforms && sketch.transforms.min && sketch.transforms.min.html) || orig;
        if (kind==='css') return (sketch.transforms && sketch.transforms.min && sketch.transforms.min.css) || orig;
        if (kind==='js') return (sketch.transforms && sketch.transforms.min && sketch.transforms.min.javascript) || orig;
      }
      if (variant === 'uglify' && kind==='js'){
        try{ const b64 = sketch.transforms && sketch.transforms.uglify && sketch.transforms.uglify.javascript; if (b64) return Buffer.from(b64,'base64').toString('utf8'); }catch{}
      }
      return orig;
    };
    doc = ejs.render(tpl, {
      title: sketch.title || 'Spectra Sketch',
      id: sketch._id.toString(),
      hash: sketch.hash || '',
      seed: sketch.seed || '',
      namespace,
      authority,
      properties,
      tags: (sketch.tags||[]).join(', '),
      license,
      date: (sketch.date||new Date()).toISOString(),
      html: choose(sketch.html||'','html'),
      css: choose(sketch.css||'','css'),
      javascript: choose(sketch.javascript||'','js'),
    });
  } else {
    const rawIframeTemplate = require('fs').readFileSync(
      path.join(__dirname, 'views', 'iframe.html'),
      'utf8'
    );
    const choose = (orig, kind)=>{
      if (variant === 'min'){
        if (kind==='html') return (sketch.transforms && sketch.transforms.min && sketch.transforms.min.html) || orig;
        if (kind==='css') return (sketch.transforms && sketch.transforms.min && sketch.transforms.min.css) || orig;
        if (kind==='js') return (sketch.transforms && sketch.transforms.min && sketch.transforms.min.javascript) || orig;
      }
      if (variant === 'uglify' && kind==='js'){
        try{ const b64 = sketch.transforms && sketch.transforms.uglify && sketch.transforms.uglify.javascript; if (b64) return Buffer.from(b64,'base64').toString('utf8'); }catch{}
      }
      return orig;
    };
    doc = rawIframeTemplate
      .replace('___FIDDLER__HTML___', choose(sketch.html || '','html'))
      .replace('___FIDDLER__STYLES___', choose(sketch.css || '','css'))
      .replace('___FIDDLER__JAVASCRIPT___', choose(sketch.javascript || '','js'));
  }
  const name = (sketch.title || sketch.hash || id).toString().replace(/[^a-z0-9_-]+/ig, '-');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.html"`);
  res.send(doc);
});

// JSON APIs for client-side gallery
app.get('/api/sketches', async (req, res) => {
  const { tag, q, sort = 'date_desc', mine } = req.query;
  const skip = Math.max(0, parseInt(req.query.skip || '0', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '30', 10)));
  const filter = {};
  if (tag) filter.tags = tag;
  if (mine === '1' || mine === 'true') {
    const h = req.headers['authorization'] || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (m) {
      const payload = verifyJWT(m[1], JWT_SECRET);
      if (payload) filter.userId = payload.id;
    }
  }
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [ { title: rx }, { hash: rx }, { html: rx }, { css: rx }, { javascript: rx } ];
  }
  let sortObj = { date: -1 };
  if (sort === 'date_asc') sortObj = { date: 1 };
  if (sort === 'title_asc') sortObj = { title: 1 };
  if (sort === 'title_desc') sortObj = { title: -1 };
  const items = await Sketch.find(filter).sort(sortObj).skip(skip).limit(limit + 1).lean();
  const hasMore = items.length > limit;
  const list = items.slice(0, limit).map(s => ({
    _id: s._id,
    userId: s.userId || null,
    title: s.title || '',
    hash: s.hash || '',
    seed: s.seed || '',
    tags: s.tags || [],
    attrs: s.attrs || null,
    date: s.date,
    html: s.html || '',
    css: s.css || '',
    javascript: s.javascript || ''
  }));
  res.json({ items: list, nextSkip: skip + list.length, hasMore });
});

// Tag counts for tag cloud
app.get('/api/tags', async (req, res) => {
  const { mine } = req.query;
  const match = {};
  if (mine === '1' || mine === 'true') {
    const h = req.headers['authorization'] || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (m) {
      const payload = verifyJWT(m[1], JWT_SECRET);
      if (payload) match.userId = mongoose.Types.ObjectId(payload.id);
    }
  }
  const agg = await Sketch.aggregate([
    { $match: match },
    { $unwind: { path: '$tags', preserveNullAndEmptyArrays: false } },
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 200 }
  ]);
  res.json(agg.map(x => ({ tag: x._id, count: x.count })));
});

// Art Book: showcase recent sketches with live previews
app.get('/artbook', async (req, res) => {
  const { tag, q, sort = 'date_desc', user } = req.query;
  const filter = {};
  if (tag) filter.tags = tag;
  if (user === 'me') {
    const h = req.headers['authorization'] || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (m) {
      const payload = verifyJWT(m[1], JWT_SECRET);
      if (payload) filter.userId = payload.id;
    }
  }
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { title: rx },
      { hash: rx },
      { html: rx },
      { css: rx },
      { javascript: rx }
    ];
  }
  let sortObj = { date: -1 };
  if (sort === 'date_asc') sortObj = { date: 1 };
  if (sort === 'title_asc') sortObj = { title: 1 };
  if (sort === 'title_desc') sortObj = { title: -1 };
  const sketches = await Sketch.find(filter).sort(sortObj).limit(24).lean();
  // Prepare iframe template (escape closing script)
  const rawIframeTemplate = require('fs').readFileSync(
    path.join(__dirname, 'views', 'iframe.html'),
    'utf8'
  );
  const iframeTemplate = rawIframeTemplate.replace(/<\/script>/g, '<\\/script>');
  res.render('artbook', {
    sketches: sketches || [],
    tag: tag || '',
    q: q || '',
    sort,
    iframeTemplate,
  });
});

// Metrics dashboard for a sketch
app.get('/metrics/:id', async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).send('Invalid id');
  const sketch = await Sketch.findById(id).lean();
  if (!sketch) return res.status(404).send('Not found');
  // Prepare iframe template (escape closing script)
  const rawIframeTemplate = require('fs').readFileSync(
    path.join(__dirname, 'views', 'iframe.html'),
    'utf8'
  );
  const iframeTemplate = rawIframeTemplate.replace(/<\/script>/g, '<\\/script>');
  res.render('metrics', { sketch, iframeTemplate });
});

// --- Auth routes ---
app.post('/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const exists = await User.findOne({ username });
  if (exists) return res.status(400).json({ error: 'username taken' });
  const user = new User({ username, password: hashPassword(password) });
  await user.save();
  const token = signJWT({ id: user._id.toString(), username }, JWT_SECRET);
  res.json({ token, user: { id: user._id, username } });
});
app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  if (!verifyPassword(password, user.password)) return res.status(401).json({ error: 'invalid credentials' });
  const token = signJWT({ id: user._id.toString(), username }, JWT_SECRET);
  res.json({ token, user: { id: user._id, username } });
});
app.get('/me', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json({ id: user._id, username: user.username, layout: user.layout||null, preferences: user.preferences||null });
});

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

// --------- Minify/Uglify/Encrypt/Share -------------------------
function minifyJS(src=''){
  try{
    let s = src;
    s = s.replace(/\/\*[\s\S]*?\*\//g, ''); // block comments
    s = s.replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments not part of protocol
    s = s.replace(/\s+/g, ' ');
    s = s.replace(/\s*([{}();,:=+\-*/<>\[\]])\s*/g, '$1');
    return s.trim();
  }catch{return src}
}
function minifyCSS(src=''){
  try{
    let s = src;
    s = s.replace(/\/\*[\s\S]*?\*\//g,'');
    s = s.replace(/\s+/g,' ');
    s = s.replace(/\s*([{}:;,>])\s*/g,'$1');
    s = s.replace(/;}/g,'}');
    return s.trim();
  }catch{return src}
}
function minifyHTML(src=''){
  try{
    let s = src;
    s = s.replace(/<!--([\s\S]*?)-->/g, '');
    s = s.replace(/>\s+</g, '><');
    s = s.replace(/\s{2,}/g, ' ');
    return s.trim();
  }catch{return src}
}
function uglifyJS(src=''){
  // Light obfuscation: minify then base64 encode
  try{ const min = minifyJS(src); return Buffer.from(min, 'utf8').toString('base64'); }catch{return src}
}

app.post('/sketch/:id/minify', authMiddleware, async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error:'Invalid id' });
  const sketch = await Sketch.findById(id);
  if (!sketch) return res.status(404).json({ error:'Not found' });
  if (sketch.userId && sketch.userId.toString() !== req.user.id) return res.status(403).json({ error:'Forbidden' });
  const min = {
    html: minifyHTML(sketch.html||''),
    css: minifyCSS(sketch.css||''),
    javascript: minifyJS(sketch.javascript||''),
  };
  const uglify = { javascript: uglifyJS(sketch.javascript||'') };
  sketch.transforms = { ...(sketch.transforms||{}), min, uglify };
  await sketch.save();
  res.json({ ok:true, transforms: sketch.transforms });
});

app.post('/sketch/:id/encrypt', authMiddleware, async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error:'Invalid id' });
  const sketch = await Sketch.findById(id);
  if (!sketch) return res.status(404).json({ error:'Not found' });
  if (sketch.userId && sketch.userId.toString() !== req.user.id) return res.status(403).json({ error:'Forbidden' });
  const password = req.body.password || '';
  if (!password) return res.status(400).json({ error:'Password required' });
  const algo = 'aes-256-gcm';
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32);
  const iv = crypto.randomBytes(12);
  const plain = JSON.stringify({ html: sketch.html||'', css: sketch.css||'', javascript: sketch.javascript||'' });
  const cipher = crypto.createCipheriv(algo, key, iv);
  const ctBuf = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ct = Buffer.concat([ctBuf, tag]).toString('base64');
  sketch.enc = { algo, salt: salt.toString('base64'), iv: iv.toString('base64'), ct };
  await sketch.save();
  res.json({ ok:true });
});

function makeToken(){ return crypto.randomBytes(16).toString('hex'); }
app.post('/share/:id', authMiddleware, async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error:'Invalid id' });
  const sketch = await Sketch.findById(id);
  if (!sketch) return res.status(404).json({ error:'Not found' });
  if (sketch.userId && sketch.userId.toString() !== req.user.id) return res.status(403).json({ error:'Forbidden' });
  const mode = (req.body.mode||'viewer');
  const ttl = Math.max(60, Math.min(60*60*24*7, parseInt(req.body.ttl|| (60*60*24),10))); // 1 day default
  const token = makeToken();
  const exp = new Date(Date.now()+ ttl*1000);
  sketch.shares = sketch.shares || [];
  sketch.shares.push({ token, mode, expiresAt: exp });
  await sketch.save();
  res.json({ token, viewerUrl: `${req.protocol}://${req.get('host')}/s/${token}`, editorUrl: `${req.protocol}://${req.get('host')}/?id=${id}&share=${token}` });
});

async function findShare(token){
  const s = await Sketch.findOne({ 'shares.token': token });
  if (!s) return null;
  const sh = (s.shares||[]).find(x=> x.token === token);
  if (!sh || (sh.expiresAt && new Date(sh.expiresAt).getTime() < Date.now())) return null;
  return { sketch: s, share: sh };
}
app.get('/api/share/:token', async (req, res) => {
  const t = req.params.token;
  const found = await findShare(t);
  if (!found) return res.status(404).json({ error:'Invalid or expired' });
  const { sketch } = found;
  res.json({ id: sketch._id, title: sketch.title, seed: sketch.seed, tags: sketch.tags||[], attrs: sketch.attrs||{}, enc: !!sketch.enc });
});
app.post('/api/share/:token/decrypt', async (req, res) => {
  const t = req.params.token;
  const password = req.body.password || '';
  const found = await findShare(t);
  if (!found) return res.status(404).json({ error:'Invalid or expired' });
  const { sketch } = found;
  if (!sketch.enc) return res.status(400).json({ error:'Not encrypted' });
  try{
    const algo = sketch.enc.algo;
    const salt = Buffer.from(sketch.enc.salt, 'base64');
    const iv = Buffer.from(sketch.enc.iv, 'base64');
    const raw = Buffer.from(sketch.enc.ct, 'base64');
    const ct = raw.slice(0, raw.length-16); const tag = raw.slice(raw.length-16);
    const key = crypto.scryptSync(password, salt, 32);
    const decipher = crypto.createDecipheriv(algo, key, iv); decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    const j = JSON.parse(pt);
    res.json({ html:j.html||'', css:j.css||'', javascript:j.javascript||'' });
  }catch(e){ res.status(400).json({ error:'Decrypt failed' }); }
});

app.get('/s/:token', async (req, res) => {
  const t = req.params.token;
  const found = await findShare(t);
  if (!found) return res.status(404).send('Invalid or expired');
  // Serve a lightweight page that fetches (and decrypts if needed) then renders fullscreen
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Share</title>
<style>html,body,iframe{margin:0;height:100%;width:100%;background:#05070a} body{display:flex}</style>
<iframe id="f"></iframe>
<div id="pw" style="position:fixed;top:10px;left:10px;color:white;font:14px system-ui;display:none"><input id="pwi" type="password" placeholder="Password"/><button id="pwb">Unlock</button></div>
<script>
const T = ${JSON.stringify(t)};
const tpl = ${JSON.stringify(require('fs').readFileSync(path.join(__dirname,'views','iframe.html'),'utf8').replace(/<\/script>/g,'<\\/script>'))};
const IFRAME_TEMPLATE = tpl;
function seedPreamble(seed){ const pre = \`(function(){function cyrb128(str){let h1=1779033703,h2=3144134277,h3=1013904242,h4=2773480762;for(let i=0,k;i<str.length;i++){k=str.charCodeAt(i);h1=h2^Math.imul(h1^k,597399067);h2=h3^Math.imul(h2^k,2869860233);h3=h4^Math.imul(h3^k,951274213);h4=h1^Math.imul(h4^k,2716044179);}h1=Math.imul(h3^(h1>>>18),597399067);h2=Math.imul(h4^(h2>>>22),2869860233);h3=Math.imul(h1^(h3>>>17),951274213);h4=Math.imul(h2^(h4>>>19),2716044179);return [(h1^h2^h3^h4)>>>0,(h2^h1)>>>0,(h3^h1)>>>0,(h4^h1)>>>0];}function sfc32(a,b,c,d){return function(){a>>>=0;b>>>=0;c>>>=0;d>>>=0;let t=(a+b)|0;a=b^(b>>>9);b=(c+(c<<3))|0;c=((c<<21)|(c>>>11)) + (t=(t+(d=(d+1)|0))|0) | 0;return (t>>>0)/4294967296;}};var __SEED__=%SEED%;window.SPECTRA_SEED=__SEED__;window.SPECTRA_RANDOM=sfc32(...cyrb128(__SEED__));})();\`; return pre.replace('%SEED%', JSON.stringify(seed||'')); }
function buildDoc(h,c,j,s){ const js = seedPreamble(s) + (j||''); return IFRAME_TEMPLATE.replace('___FIDDLER__HTML___',h||'').replace('___FIDDLER__STYLES___',c||'').replace('___FIDDLER__JAVASCRIPT___',js); }
async function main(){
  const r = await fetch('/api/share/'+encodeURIComponent(T));
  const j = await r.json();
  if (!r.ok) { document.body.textContent = 'Invalid or expired'; return; }
  if (!j.enc){ // not encrypted
    const r2 = await fetch('/sketch/'+j.id); const s = await r2.json();
    const doc = buildDoc(s.html, s.css, s.javascript, j.seed);
    document.getElementById('f').src = 'data:text/html;charset=utf-8,'+encodeURIComponent(doc);
  } else {
    const pw = document.getElementById('pw'); pw.style.display='block';
    document.getElementById('pwb').onclick = async ()=>{
      const p = document.getElementById('pwi').value;
      const rd = await fetch('/api/share/'+encodeURIComponent(T)+'/decrypt', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: p }) });
      const d = await rd.json(); if (!rd.ok){ alert(d.error||'Failed'); return; }
      const doc = buildDoc(d.html, d.css, d.javascript, j.seed);
      document.getElementById('f').src = 'data:text/html;charset=utf-8,'+encodeURIComponent(doc); pw.style.display='none';
    };
  }
}
main();
</script>`;
  res.set('content-type','text/html; charset=utf-8');
  res.send(page);
});
const PORT = process.env.PORT || 6002;
app.listen(PORT, () => {
  console.log(`Playground server running on port ${PORT}`);
});

// Preferences endpoints (user & sketch)
app.get('/user/params', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json({ preferences: user.preferences || null });
});
app.post('/user/params', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'not found' });
  user.preferences = req.body.preferences || null;
  await user.save();
  res.json({ ok: true });
});
app.get('/sketch/:id/params', async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
  const sketch = await Sketch.findById(id).lean();
  if (!sketch) return res.status(404).json({ error: 'Not found' });
  res.json({ parameters: sketch.parameters || null });
});
app.post('/sketch/:id/params', authMiddleware, async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
  const sketch = await Sketch.findById(id);
  if (!sketch) return res.status(404).json({ error: 'Not found' });
  if (sketch.userId && sketch.userId.toString() !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  sketch.parameters = req.body.parameters || null;
  await sketch.save();
  res.json({ ok: true });
});
