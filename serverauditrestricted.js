const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(cors());

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://lukejmurphy95_db_user:iIE6ZWZatYaJKWxi@cluster0.tdijzxo.mongodb.net/?appName=Cluster0';

mongoose.connect(MONGO_URI, { dbName: 'qadsiah_inventory' })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const VALID_TEAMS = [
  "Men's First Team",
  "Women's First Team",
  "Men's Academy",
  "Women's Academy"
];

// Schemas
const stateSchema = new mongoose.Schema({
  _id: String, moves: Array, thresh: Number, logo: String, crest: String,
  names: Object, photos: Object, folders: Object, order: Array,
  createdItems: Array, version: Number, updatedAt: { type: Date, default: Date.now }
});

const sessionSchema = new mongoose.Schema({
  token: { type: String, unique: true }, username: String, role: String,
  createdAt: { type: Date, default: Date.now, expires: 604800 }
});

const userSchema = new mongoose.Schema({
  username:  { type: String, unique: true, required: true },
  password:  { type: String, required: true },
  role:      { type: String, default: 'staff' },
  teams:     { type: [String], default: [] },
  permLevel: { type: String, default: 'staff' }
});

const State   = mongoose.model('State',   stateSchema);
const Session = mongoose.model('Session', sessionSchema);
const User    = mongoose.model('User',    userSchema);

const DEFAULT_USERS = [
  { username: 'admin',          password: 'Q4dsiah',   role: 'manager', teams: VALID_TEAMS, permLevel: 'full_admin' },
  { username: 'LukeMurphy',     password: 'Qadsiah',   role: 'manager', teams: VALID_TEAMS, permLevel: 'full_admin' },
  { username: 'LeeRadcliffe',   password: 'Qadsiah',   role: 'manager', teams: ["Women's First Team","Women's Academy"], permLevel: 'supervisor' },
  { username: 'CreagRobertson', password: 'Qadsiah10', role: 'staff',   teams: ["Men's First Team"], permLevel: 'staff' },
  { username: 'Rabbi',          password: 'Qadsiah1',  role: 'staff',   teams: ["Men's First Team"], permLevel: 'staff' },
  { username: 'Sanula',         password: 'Qadsiah2',  role: 'staff',   teams: ["Men's First Team"], permLevel: 'staff' },
  { username: 'LouayBafaqier',  password: 'Qadsiah3',  role: 'staff',   teams: ["Men's First Team"], permLevel: 'staff' },
];

let sessions = {};

function teamStateId(team) {
  if (!team || !VALID_TEAMS.includes(team)) return 'inventory-state-mens-first-team';
  return 'inventory-state-' + team.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

async function loadSessions() {
  try {
    const dbSessions = await Session.find({});
    sessions = {};
    for (const sess of dbSessions) sessions[sess.token] = { username: sess.username, role: sess.role };
    console.log('Loaded ' + Object.keys(sessions).length + ' sessions from MongoDB');
  } catch (e) { console.error('Error loading sessions:', e); sessions = {}; }
}

async function seedUsers() {
  try {
    const count = await User.countDocuments();
    if (count === 0) {
      await User.insertMany(DEFAULT_USERS);
      console.log('Seeded ' + DEFAULT_USERS.length + ' default users');
    } else {
      console.log('Users already in DB (' + count + '), skipping seed');
    }
  } catch (e) { console.error('Error seeding users:', e); }
}

async function saveSession(token, username, role) {
  try { await Session.updateOne({ token }, { token, username, role, createdAt: new Date() }, { upsert: true }); }
  catch (e) { console.error('Error saving session:', e); }
}

async function deleteSession(token) {
  try { await Session.deleteOne({ token }); }
  catch (e) { console.error('Error deleting session:', e); }
}

const stateCache = {};

async function loadState(team) {
  const id = teamStateId(team);
  try {
    let s = await State.findById(id);
    if (!s) {
      s = new State({ _id: id, moves: [], thresh: 25, logo: null, crest: null, names: {}, photos: {}, folders: {}, order: [], createdItems: [], version: 0 });
      await s.save();
    }
    return s.toObject();
  } catch (e) { console.error('Error loading state for team ' + team + ':', e); return null; }
}

async function saveState(stateData, team) {
  const id = teamStateId(team);
  try { await State.updateOne({ _id: id }, { ...stateData, _id: id, updatedAt: new Date() }, { upsert: true }); }
  catch (e) { console.error('Error saving state for team ' + team + ':', e); }
}

async function getState(team) {
  const id = teamStateId(team);
  if (!stateCache[id]) stateCache[id] = await loadState(team);
  return stateCache[id];
}

loadSessions();
mongoose.connection.once('open', () => { seedUsers(); });

function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token || !sessions[token]) return res.status(401).json({ error: 'Unauthorized' });
  req.userId = sessions[token].username;
  req.userRole = sessions[token].role;
  next();
}

async function requireFullAdmin(req, res, next) {
  const user = await User.findOne({ username: req.userId });
  if (!user || user.permLevel !== 'full_admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ── Auth ────────────────────────────────────────────────────────────────────

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = await User.findOne({ username });
  if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
  const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  sessions[token] = { username, role: user.role };
  saveSession(token, username, user.role);
  res.json({ ok: true, token, username, role: user.role, teams: user.teams, permLevel: user.permLevel });
});

app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) { delete sessions[token]; deleteSession(token); }
  res.json({ ok: true });
});

// ── Admin: User Management (full_admin only) ────────────────────────────────

app.get('/api/admin/users', verifyToken, requireFullAdmin, async (req, res) => {
  const users = await User.find({}, { password: 0, __v: 0 });
  res.json({ users });
});

app.post('/api/admin/add-user', verifyToken, requireFullAdmin, async (req, res) => {
  const { username, password, role, teams, permLevel } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const existing = await User.findOne({ username });
  if (existing) return res.status(400).json({ error: 'Username already exists' });
  const newUser = new User({ username, password, role: role || 'staff', teams: teams || [], permLevel: permLevel || 'staff' });
  await newUser.save();
  res.json({ ok: true, user: { username, role: newUser.role, teams: newUser.teams, permLevel: newUser.permLevel } });
});

app.post('/api/admin/change-password', verifyToken, requireFullAdmin, async (req, res) => {
  const { username, newPassword } = req.body;
  if (!username || !newPassword) return res.status(400).json({ error: 'Username and new password required' });
  const result = await User.updateOne({ username }, { password: newPassword });
  if (result.matchedCount === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

app.post('/api/admin/update-user', verifyToken, requireFullAdmin, async (req, res) => {
  const { username, role, teams, permLevel } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  const update = {};
  if (role !== undefined) update.role = role;
  if (teams !== undefined) update.teams = teams;
  if (permLevel !== undefined) update.permLevel = permLevel;
  const result = await User.updateOne({ username }, update);
  if (result.matchedCount === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

app.post('/api/admin/delete-user', verifyToken, requireFullAdmin, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  if (username === req.userId) return res.status(400).json({ error: 'Cannot delete your own account' });
  const result = await User.deleteOne({ username });
  if (result.deletedCount === 0) return res.status(404).json({ error: 'User not found' });
  for (const [token, sess] of Object.entries(sessions)) {
    if (sess.username === username) { delete sessions[token]; deleteSession(token); }
  }
  res.json({ ok: true });
});

// ── Inventory endpoints ─────────────────────────────────────────────────────

app.get('/api/state', verifyToken, async (req, res) => {
  const state = await getState(req.query.team);
  if (!state) return res.status(500).json({ error: 'State not loaded' });
  res.json(state);
});

app.post('/api/sync', verifyToken, async (req, res) => {
  const team = req.query.team;
  const state = await getState(team);
  if (!state) return res.status(500).json({ error: 'State not loaded' });
  const { moves, thresh, logo, crest, names, photos, folders, order } = req.body;
  const username = req.userId;
  if (moves !== undefined) state.moves = moves.map(m => ({ ...m, user: m.user || username }));
  if (thresh !== undefined) state.thresh = thresh;
  if (logo !== undefined) state.logo = logo;
  if (crest !== undefined) state.crest = crest;
  if (names !== undefined) state.names = names;
  if (photos !== undefined) state.photos = photos;
  if (folders !== undefined) state.folders = folders;
  if (order !== undefined) state.order = order;
  state.version++;
  await saveState(state, team);
  res.json({ ok: true, version: state.version });
});

app.get('/api/movements', verifyToken, async (req, res) => {
  if (req.userRole !== 'manager') return res.status(403).json({ error: 'Access denied' });
  const state = await getState(req.query.team);
  if (!state) return res.status(500).json({ error: 'State not loaded' });
  res.json({ audit: state.moves.map(m => ({ time: m.t, user: m.user || 'unknown', action: m.d, quantity: m.q, item: m.id, issuedTo: m.w })) });
});

app.get('/api/audit', verifyToken, async (req, res) => {
  const state = await getState(req.query.team);
  if (!state) return res.status(500).json({ error: 'State not loaded' });
  res.json({ audit: state.moves.map(m => ({ time: m.t, user: m.user || 'unknown', action: m.d, quantity: m.q, item: m.id, issuedTo: m.w })) });
});

app.post('/api/create-item', verifyToken, async (req, res) => {
  if (req.userRole !== 'manager') return res.status(403).json({ error: 'Only managers can create items' });
  const team = req.query.team;
  const state = await getState(team);
  if (!state) return res.status(500).json({ error: 'State not loaded' });
  const { name, code, price, folder, sizes, photo } = req.body;
  if (!name || !price || !folder || !sizes || sizes.length === 0) return res.status(400).json({ error: 'Missing required fields' });
  const baseKey = name.toLowerCase().replace(/\s+/g, '-') + '~' + (code || 'custom');
  const newItem = { k: baseKey, n: name.toUpperCase(), c: code || '', p: parseFloat(price), g: folder, i: photo ? 'photo-' + baseKey + '.png' : 'image-placeholder.png', s: sizes.map(([size, qty]) => [size, parseInt(qty)]) };
  if (!state.createdItems) state.createdItems = [];
  state.createdItems.push(newItem);
  if (photo) { state.photos = state.photos || {}; state.photos[baseKey] = photo; }
  state.folders = state.folders || {};
  state.folders[baseKey] = folder;
  state.version++;
  await saveState(state, team);
  res.json({ ok: true, item: newItem, version: state.version });
});

app.post('/api/delete-item', verifyToken, async (req, res) => {
  if (req.userRole !== 'manager') return res.status(403).json({ error: 'Only managers can delete items' });
  const team = req.query.team;
  const state = await getState(team);
  if (!state) return res.status(500).json({ error: 'State not loaded' });
  const { itemKey } = req.body;
  if (!itemKey) return res.status(400).json({ error: 'Item key required' });
  if (state.createdItems) state.createdItems = state.createdItems.filter(item => item.k !== itemKey);
  if (state.folders) delete state.folders[itemKey];
  if (state.photos) delete state.photos[itemKey];
  state.version++;
  await saveState(state, team);
  console.log('Item deleted: ' + itemKey + ' by ' + req.userId);
  res.json({ ok: true, version: state.version });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', dbConnected: mongoose.connection.readyState === 1 });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log('Qadsiah Kit Room backend running on port ' + PORT); });
