// server.js — Enterprise RBAC Job Dashboard v2
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'insecure-dev-secret-change-me';

// ==================== POSTGRES ====================
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT || 5432),
});

// ==================== MIDDLEWARE ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static: index.html di public/, css/js/uploads di subfolder
app.use(express.static(path.join(__dirname, 'public')));

const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ==================== HELPERS ====================
function signToken(user) {
    return jwt.sign({ username: user.username, roleId: user.role_id }, JWT_SECRET, { expiresIn: '8h' });
}

function authRequired(req, res, next) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, message: 'Token diperlukan' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ success: false, message: 'Token tidak valid/kadaluarsa' });
    }
}

function requireRole(...allowed) {
    return (req, res, next) =>
        allowed.includes(req.user.roleId)
            ? next()
            : res.status(403).json({ success: false, message: 'Akses ditolak' });
}

async function logActivity(actor, action, detail = '') {
    try { await pool.query('INSERT INTO activity_log(actor,action,detail) VALUES($1,$2,$3)', [actor, action, detail]); }
    catch (e) { console.error('logActivity error:', e.message); }
}

// ==================== RATE LIMIT LOGIN ====================
const loginLimiter = rateLimit({
    windowMs: Number(process.env.LOGIN_RATE_WINDOW_MIN || 15) * 60 * 1000,
    max: Number(process.env.LOGIN_RATE_MAX || 8),
    standardHeaders: true, legacyHeaders: false,
    message: { success: false, message: 'Terlalu banyak percobaan login. Coba lagi nanti.' },
});

// ==================== AUTH ====================
app.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) return res.status(400).json({ success: false, message: 'Username & password wajib' });

        const r = await pool.query(
            `SELECT u.*, r.name AS role_name, r.permissions
             FROM users u LEFT JOIN roles r ON u.role_id = r.id
             WHERE u.username = $1`, [username]);

        if (!r.rows.length) return res.status(401).json({ success: false, message: 'Kredensial salah' });
        const u = r.rows[0];
        const ok = await bcrypt.compare(password, u.password);
        if (!ok) return res.status(401).json({ success: false, message: 'Kredensial salah' });

        await logActivity(u.username, 'LOGIN', req.ip);
        res.json({
            success: true,
            token: signToken(u),
            user: {
                username: u.username, fullName: u.full_name, roleId: u.role_id,
                roleName: u.role_name, permissions: u.permissions
            }
        });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'Server error' }); }
});

// Ganti password sendiri
app.post('/api/auth/change-password', authRequired, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body || {};
        if (!oldPassword || !newPassword) return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
        if (newPassword.length < 6) return res.status(400).json({ success: false, message: 'Password minimal 6 karakter' });

        const r = await pool.query('SELECT password FROM users WHERE username=$1', [req.user.username]);
        const ok = await bcrypt.compare(oldPassword, r.rows[0].password);
        if (!ok) return res.status(400).json({ success: false, message: 'Password lama salah' });

        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password=$1 WHERE username=$2', [hash, req.user.username]);
        await logActivity(req.user.username, 'CHANGE_PASSWORD', '');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// Endpoint Update Profil Mandiri
app.put('/api/auth/profile', authRequired, async (req, res) => {
    try {
        const { fullName } = req.body;
        if (!fullName) return res.status(400).json({ success: false, message: 'Nama lengkap wajib diisi' });
        
        await pool.query('UPDATE users SET full_name=$1 WHERE username=$2', [fullName, req.user.username]);
        await logActivity(req.user.username, 'UPDATE_PROFILE', `Mengubah nama menjadi ${fullName}`);
        
        // Ambil data terbaru
        const r = await pool.query('SELECT username, full_name, role_id FROM users WHERE username=$1', [req.user.username]);
        const user = r.rows[0];

        res.json({ 
            success: true, 
            user: { username: user.username, fullName: user.full_name, roleId: user.role_id } 
        });
    } catch (err) { 
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' }); 
    }
});

// ==================== ROLES ====================
app.get('/api/roles', authRequired, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, permissions FROM roles ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json(err); }
});

app.post('/api/roles', authRequired, requireRole('R01'), async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Nama jabatan wajib' });
        const id = 'R-' + Date.now();
        await pool.query(
            'INSERT INTO roles (id, name, permissions) VALUES ($1,$2,$3)',
            [id, name, JSON.stringify(['view_dashboard', 'input_data'])]
        );
        await logActivity(req.user.username, 'CREATE_ROLE', name);
        res.json({ success: true });
    } catch (err) { res.status(500).json(err); }
});

app.put('/api/roles/:id', authRequired, requireRole('R01'), async (req, res) => {
    try {
        const { name } = req.body;
        await pool.query('UPDATE roles SET name=$1 WHERE id=$2', [name, req.params.id]);
        await logActivity(req.user.username, 'UPDATE_ROLE', `${req.params.id} → ${name}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json(err); }
});

app.delete('/api/roles/:id', authRequired, requireRole('R01'), async (req, res) => {
    try {
        const check = await pool.query('SELECT username FROM users WHERE role_id=$1 LIMIT 1', [req.params.id]);
        if (check.rows.length) return res.status(400).json({ success: false, message: 'Jabatan masih dipakai pegawai!' });
        await pool.query('DELETE FROM roles WHERE id=$1', [req.params.id]);
        await logActivity(req.user.username, 'DELETE_ROLE', req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json(err); }
});

// ==================== USERS ====================
app.get('/api/users', authRequired, requireRole('R01'), async (req, res) => {
    try {
        const q = `
            SELECT u.username, u.full_name AS "fullName", u.role_id AS "roleId", r.name AS "roleName"
            FROM users u LEFT JOIN roles r ON u.role_id = r.id ORDER BY u.username ASC
        `;
        const result = await pool.query(q);
        res.json(result.rows);
    } catch (err) { res.status(500).json(err); }
});

app.post('/api/users', authRequired, requireRole('R01'), async (req, res) => {
    try {
        const { username, password, fullName, roleId } = req.body || {};
        if (!username || !password || !fullName || !roleId)
            return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
        if (password.length < 6) return res.status(400).json({ success: false, message: 'Password min 6 karakter' });

        const check = await pool.query('SELECT username FROM users WHERE username=$1', [username]);
        if (check.rows.length) return res.status(400).json({ success: false, message: 'Username telah terdaftar!' });

        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username,password,full_name,role_id) VALUES ($1,$2,$3,$4)',
            [username, hash, fullName, roleId]);
        await logActivity(req.user.username, 'CREATE_USER', username);
        res.json({ success: true });
    } catch (err) { res.status(500).json(err); }
});

app.delete('/api/users/:username', authRequired, requireRole('R01'), async (req, res) => {
    try {
        if (req.params.username === req.user.username)
            return res.status(400).json({ success: false, message: 'Tidak bisa menghapus akun sendiri' });
        await pool.query('DELETE FROM users WHERE username=$1', [req.params.username]);
        await logActivity(req.user.username, 'DELETE_USER', req.params.username);
        res.json({ success: true });
    } catch (err) { res.status(500).json(err); }
});

// ==================== PROJECTS ====================
app.get('/api/projects', authRequired, async (req, res) => {
    try {
        const { username, search, from, to, page = 1, limit = 100 } = req.query;
        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
        const scoped = req.user.roleId === 'R01' ? username : req.user.username;

        const conds = []; const params = [];
        let i = 1;
        if (scoped) { conds.push(`created_by = $${i++}`); params.push(scoped); }
        if (search) { conds.push(`name ILIKE $${i++}`); params.push(`%${search}%`); }
        if (from)   { conds.push(`start_date >= $${i++}`); params.push(from); }
        if (to)     { conds.push(`end_date <= $${i++}`); params.push(to); }

        const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
        const q = `
            SELECT id, name, status, progress,
                   to_char(start_date,'YYYY-MM-DD') AS "startDate",
                   to_char(end_date,'YYYY-MM-DD') AS "endDate",
                   goals, attachment, created_by AS "createdBy",
                   to_char(created_at,'YYYY-MM-DD HH24:MI') AS "createdAt"
            FROM projects ${where}
            ORDER BY id DESC
            LIMIT $${i++} OFFSET $${i++}
        `;
        params.push(parseInt(limit), offset);
        const result = await pool.query(q, params);

        const cnt = await pool.query(`SELECT COUNT(*)::int AS c FROM projects ${where}`, params.slice(0, params.length - 2));
        res.json({ data: result.rows, total: cnt.rows[0].c, page: parseInt(page), limit: parseInt(limit) });
    } catch (err) { console.error(err); res.status(500).json(err); }
});

app.get('/api/projects/:id', authRequired, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT id, name, status, progress,
                    to_char(start_date,'YYYY-MM-DD') AS "startDate",
                    to_char(end_date,'YYYY-MM-DD') AS "endDate",
                    goals, attachment, created_by AS "createdBy"
             FROM projects WHERE id=$1`, [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ success: false, message: 'Tidak ditemukan' });
        const p = r.rows[0];
        if (req.user.roleId !== 'R01' && p.createdBy !== req.user.username)
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        res.json(p);
    } catch (err) { res.status(500).json(err); }
});

app.post('/api/projects', authRequired, async (req, res) => {
    try {
        const { name, status, progress, startDate, endDate, goals, fileData, fileName, latitude, longitude } = req.body;
        if (!name || progress == null || !startDate || !endDate)
            return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
        const prog = parseInt(progress, 10);
        if (isNaN(prog) || prog < 0 || prog > 100)
            return res.status(400).json({ success: false, message: 'Progress 0–100' });
        if (new Date(endDate) < new Date(startDate))
            return res.status(400).json({ success: false, message: 'Tanggal selesai < mulai' });

        let savedFilePath = null;
        if (fileData && fileName) {
            const buf = Buffer.from(fileData.split(',')[1], 'base64');
            if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ success: false, message: 'File max 8MB' });
            const uniqueFileName = Date.now() + '-' + fileName.replace(/\s+/g, '-');
            fs.writeFileSync(path.join(UPLOADS_DIR, uniqueFileName), buf);
            savedFilePath = 'uploads/' + uniqueFileName;
        }

        const id = Date.now();
        const goalsArray = Array.isArray(goals) ? goals : [goals].filter(Boolean);
        await pool.query(
            `INSERT INTO projects (id,name,status,progress,start_date,end_date,goals,attachment,created_by,latitude,longitude)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [id, name, status, prog, startDate, endDate, JSON.stringify(goalsArray), savedFilePath, req.user.username, latitude || null, longitude || null]
        );
        await logActivity(req.user.username, 'CREATE_PROJECT', name);
        res.json({ success: true, id });
    } catch (err) { console.error(err); res.status(500).json(err); }
});

app.put('/api/projects/:id', authRequired, async (req, res) => {
    try {
        const own = await pool.query('SELECT created_by FROM projects WHERE id=$1', [req.params.id]);
        if (!own.rows.length) return res.status(404).json({ success: false, message: 'Tidak ditemukan' });
        if (req.user.roleId !== 'R01' && own.rows[0].created_by !== req.user.username)
            return res.status(403).json({ success: false, message: 'Akses ditolak' });

        const { name, status, progress, startDate, endDate, goals } = req.body;
        await pool.query(
            `UPDATE projects SET name=$1,status=$2,progress=$3,start_date=$4,end_date=$5,goals=$6,updated_at=now()
             WHERE id=$7`,
            [name, status, parseInt(progress, 10), startDate, endDate, JSON.stringify(goals || []), req.params.id]
        );
        await logActivity(req.user.username, 'UPDATE_PROJECT', `${req.params.id}: ${name}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json(err); }
});

app.delete('/api/projects/:id', authRequired, async (req, res) => {
    try {
        const own = await pool.query('SELECT created_by, name FROM projects WHERE id=$1', [req.params.id]);
        if (!own.rows.length) return res.status(404).json({ success: false, message: 'Tidak ditemukan' });
        if (req.user.roleId !== 'R01' && own.rows[0].created_by !== req.user.username)
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        await pool.query('DELETE FROM projects WHERE id=$1', [req.params.id]);
        await logActivity(req.user.username, 'DELETE_PROJECT', own.rows[0].name);
        res.json({ success: true });
    } catch (err) { res.status(500).json(err); }
});

// ==================== KOMENTAR ====================
app.get('/api/projects/:id/comments', authRequired, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT c.id, c.author, c.message, to_char(c.created_at,'YYYY-MM-DD HH24:MI') AS "createdAt",
                    u.full_name AS "authorName"
             FROM project_comments c LEFT JOIN users u ON c.author = u.username
             WHERE c.project_id=$1 ORDER BY c.id ASC`, [req.params.id]);
        res.json(r.rows);
    } catch (err) { res.status(500).json(err); }
});

app.post('/api/projects/:id/comments', authRequired, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ success: false, message: 'Komentar kosong' });
        await pool.query(
            'INSERT INTO project_comments (project_id, author, message) VALUES ($1,$2,$3)',
            [req.params.id, req.user.username, message]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json(err); }
});

// ==================== STATISTIK / LEADERBOARD ====================
app.get('/api/stats/leaderboard', authRequired, async (req, res) => {
    try {
        if (req.user.roleId !== 'R01') return res.status(403).json({ success: false, message: 'Akses ditolak' });
        const r = await pool.query(`
            SELECT u.username, u.full_name AS "fullName", r.name AS "roleName",
                   COUNT(p.id)::int AS total,
                   COALESCE(ROUND(AVG(p.progress))::int, 0) AS avgProgress,
                   SUM(CASE WHEN p.progress = 100 THEN 1 ELSE 0 END)::int AS selesai
            FROM users u
            LEFT JOIN projects p ON p.created_by = u.username
            LEFT JOIN roles r ON u.role_id = r.id
            GROUP BY u.username, u.full_name, r.name
            ORDER BY avgProgress DESC, total DESC
        `);
        res.json(r.rows);
    } catch (err) { res.status(500).json(err); }
});

// ==================== AUDIT LOG ====================
app.get('/api/activity', authRequired, requireRole('R01'), async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT id, actor, action, detail, to_char(created_at,'YYYY-MM-DD HH24:MI') AS "createdAt"
             FROM activity_log ORDER BY id DESC LIMIT 200`
        );
        res.json(r.rows);
    } catch (err) { res.status(500).json(err); }
});

// ==================== SETTINGS THEME ====================
app.get('/api/settings', authRequired, async (req, res) => {
    try {
        const r = await pool.query('SELECT theme FROM user_settings WHERE username=$1', [req.user.username]);
        res.json(r.rows[0] || { theme: 'dark' });
    } catch { res.json({ theme: 'dark' }); }
});

app.put('/api/settings', authRequired, async (req, res) => {
    try {
        const { theme } = req.body;
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_settings (
                username VARCHAR(64) PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
                theme VARCHAR(20) DEFAULT 'dark'
            );
        `);
        await pool.query(`
            INSERT INTO user_settings (username, theme) VALUES ($1, $2)
            ON CONFLICT (username) DO UPDATE SET theme = EXCLUDED.theme
        `, [req.user.username, theme || 'dark']);
        res.json({ success: true });
    } catch (err) { res.status(500).json(err); }
});

// ==================== STATIC FALLBACK & ERRORS ====================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/*splat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use('/api', (req, res) => res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan' }));

app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
});

app.listen(PORT, () => {
    console.log(`\n==================================================================`);
    console.log(`🚀 Server aktif: http://localhost:${PORT}`);
    console.log(`   JWT_SECRET: ${JWT_SECRET === 'insecure-dev-secret-change-me' ? '⚠️  DEFAULT (ubah .env!)' : '✅'}`);
    console.log(`==================================================================\n`);
});