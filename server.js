const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'dbsproject';

const pool = new Pool({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'skillexchange_db',
    password: process.env.PGPASSWORD || 'Tisha*2007',
    port: Number(process.env.PGPORT || 5432),
});

function auth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}

pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
        notification_id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        sender_id INT,
        session_id INT,
        type VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
    );
`).catch(() => {});

pool.query(`ALTER TABLE certificates ADD COLUMN IF NOT EXISTS image_url TEXT;`).catch(() => {});
pool.query(`ALTER TABLE profile ADD COLUMN IF NOT EXISTS avatar_url TEXT;`).catch(() => {});
pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(15);`).catch(() => {});

app.post('/api/register', async (req, res) => {
    const { name, email, password, phone, role, offer_skill_name, want_skill_name, experience_level, bio, avatar_url } = req.body;
    if (!name || !email || !password || !role) return res.status(400).json({ error: 'All core fields required' });

    const client = await pool.connect();
    try {
        const hash = await bcrypt.hash(password, 10);
        await client.query('BEGIN');
        
        const u = await client.query(
            `INSERT INTO users (name, email, password, phone, role) VALUES ($1, $2, $3, $4, $5) RETURNING user_id`,
            [name.trim(), email.toLowerCase(), hash, phone ? phone.trim() : null, role]
        );
        const userId = u.rows[0].user_id;
        
        await client.query(
            `INSERT INTO profile (user_id, bio, avatar_url) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET bio = EXCLUDED.bio, avatar_url = EXCLUDED.avatar_url`,
            [userId, bio || null, avatar_url || null]
        );

        async function getOrCreateSkill(skillName) {
            if (!skillName || !skillName.trim()) return null;
            let sRes = await client.query(`SELECT skill_id FROM skill WHERE LOWER(skill_name) = LOWER($1)`, [skillName.trim()]);
            if (sRes.rows.length > 0) return sRes.rows[0].skill_id;
            let newS = await client.query(`INSERT INTO skill (skill_name, category) VALUES ($1, 'General') RETURNING skill_id`, [skillName.trim()]);
            return newS.rows[0].skill_id;
        }

        if (offer_skill_name) {
            let sId = await getOrCreateSkill(offer_skill_name);
            if (sId) {
                await client.query(
                    `INSERT INTO user_skill (user_id, skill_id, skill_type, experience_level) VALUES ($1, $2, 'OFFER', $3) ON CONFLICT DO NOTHING`,
                    [userId, sId, experience_level || 'Intermediate']
                );
            }
        }

        if (want_skill_name) {
            let sId = await getOrCreateSkill(want_skill_name);
            if (sId) {
                await client.query(
                    `INSERT INTO user_skill (user_id, skill_id, skill_type, experience_level) VALUES ($1, $2, 'WANT', 'Beginner') ON CONFLICT DO NOTHING`,
                    [userId, sId]
                );
            }
        }

        await client.query('COMMIT');
        res.status(201).json({ message: 'Registration successful' });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
        const r = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
        const user = r.rows[0];
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign({ user_id: user.user_id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '2h' });
        res.json({ message: 'Login successful', token, user: { user_id: user.user_id, name: user.name, role: user.role } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/account', auth, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT u.user_id, u.name, u.email, u.phone, u.role, p.bio, p.avatar_url 
             FROM users u LEFT JOIN profile p ON u.user_id = p.user_id WHERE u.user_id = $1`,
            [req.user.user_id]
        );
        res.json(r.rows[0] || {});
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/account', auth, async (req, res) => {
    const { name, phone, bio, avatar_url } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (name && name.trim()) {
            await client.query(`UPDATE users SET name = $1, phone = $2 WHERE user_id = $3`, [name.trim(), phone ? phone.trim() : null, req.user.user_id]);
        }
        await client.query(
            `INSERT INTO profile (user_id, bio, avatar_url) VALUES ($1, $2, $3)
             ON CONFLICT (user_id) DO UPDATE SET bio = EXCLUDED.bio, avatar_url = EXCLUDED.avatar_url`,
            [req.user.user_id, bio || null, avatar_url || null]
        );
        await client.query('COMMIT');
        res.json({ message: 'Account updated successfully!' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

app.get('/api/mentors/search', auth, async (req, res) => {
    const { skill } = req.query;
    try {
        const query = `
            SELECT DISTINCT u.user_id, u.name, u.email, u.phone, u.availability, p.avatar_url, p.bio,
                   COALESCE(u.average_rating, 0.0) AS avg_rating
            FROM users u
            JOIN user_skill us ON u.user_id = us.user_id
            JOIN skill s ON us.skill_id = s.skill_id
            LEFT JOIN profile p ON u.user_id = p.user_id
            WHERE LOWER(s.skill_name) LIKE LOWER($1) AND us.skill_type = 'OFFER' AND u.role IN ('Mentor', 'Both')
            ORDER BY avg_rating DESC;
        `;
        const result = await pool.query(query, [`%${skill || ''}%`]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/mentors/:id/profile', auth, async (req, res) => {
    const mentorId = req.params.id;
    try {
        const userRes = await pool.query(
            `SELECT u.user_id, u.name, u.email, u.phone, u.availability, u.average_rating, p.bio, p.avatar_url 
             FROM users u LEFT JOIN profile p ON u.user_id = p.user_id WHERE u.user_id = $1`, [mentorId]
        );
        if (!userRes.rows.length) return res.status(404).json({ error: 'Mentor not found' });

        const offeredSkillsRes = await pool.query(
            `SELECT s.skill_name, s.category, us.experience_level 
             FROM user_skill us JOIN skill s ON s.skill_id = us.skill_id 
             WHERE us.user_id = $1 AND us.skill_type = 'OFFER'`, [mentorId]
        );

        const wantedSkillsRes = await pool.query(
            `SELECT s.skill_name, s.category, us.experience_level 
             FROM user_skill us JOIN skill s ON s.skill_id = us.skill_id 
             WHERE us.user_id = $1 AND us.skill_type = 'WANT'`, [mentorId]
        );

        const certsRes = await pool.query(
            `SELECT certificate_name, certificate_details, issue_date, image_url 
             FROM certificates WHERE mentor_id = $1`, [mentorId]
        );

        const reviewsRes = await pool.query(
            `SELECT r.rating, r.feedback, r.created_date, u.name AS learner_name 
             FROM ratings r JOIN sessions s ON r.session_id = s.session_id 
             JOIN users u ON s.learner_id = u.user_id WHERE r.mentor_id = $1 ORDER BY r.rating_id DESC`, [mentorId]
        );

        res.json({
            mentor: userRes.rows[0],
            offered_skills: offeredSkillsRes.rows,
            wanted_skills: wantedSkillsRes.rows,
            certificates: certsRes.rows,
            reviews: reviewsRes.rows
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sessions/request', auth, async (req, res) => {
    const { mentor_id, session_date, session_time } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const sessRes = await client.query(
            `INSERT INTO sessions (learner_id, mentor_id, session_date, session_time, status)
             VALUES ($1, $2, $3, $4, 'Requested') RETURNING session_id`,
            [req.user.user_id, mentor_id, session_date, session_time]
        );
        const sessionId = sessRes.rows[0].session_id;

        const learnerRes = await client.query(`SELECT name FROM users WHERE user_id = $1`, [req.user.user_id]);
        const learnerName = learnerRes.rows[0].name;

        await client.query(
            `INSERT INTO notifications (user_id, sender_id, session_id, type, message)
             VALUES ($1, $2, $3, 'SESSION_REQUEST', $4)`,
            [mentor_id, req.user.user_id, sessionId, `${learnerName} has requested a session on ${session_date} at ${session_time}.`]
        );

        await client.query('COMMIT');
        res.status(201).json({ message: 'Session request sent to mentor!', session_id: sessionId });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

app.post('/api/sessions/respond', auth, async (req, res) => {
    const { session_id, action, notification_id } = req.body;
    if (!['Approved', 'Rejected'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const sessRes = await client.query(
            `UPDATE sessions SET status = $1 WHERE session_id = $2 RETURNING learner_id, mentor_id, session_date, session_time`,
            [action, session_id]
        );
        if (!sessRes.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Session not found' });
        }
        const session = sessRes.rows[0];

        const mentorRes = await client.query(`SELECT name, email, phone FROM users WHERE user_id = $1`, [session.mentor_id]);
        const mentor = mentorRes.rows[0];
        const mentorName = mentor.name;
        const mentorEmail = mentor.email;
        const mentorPhone = mentor.phone;

        let statusMsg = action === 'Approved' 
            ? `🎉 ${mentorName} accepted your session request for ${session.session_date} at ${session.session_time}!` 
            : `❌ ${mentorName} was unable to accept your session request.`;

        if (action === 'Approved') {
            statusMsg += ` | Contact Details - Email: ${mentorEmail}`;
            if (mentorPhone) {
                statusMsg += `, Phone: ${mentorPhone}`;
            }
        }

        await client.query(
            `INSERT INTO notifications (user_id, sender_id, session_id, type, message)
             VALUES ($1, $2, $3, 'SESSION_RESPONSE', $4)`,
            [session.learner_id, req.user.user_id, session_id, statusMsg]
        );

        if (notification_id) {
            await client.query(`UPDATE notifications SET is_read = TRUE WHERE notification_id = $1`, [notification_id]);
        }

        await client.query('COMMIT');
        res.json({ message: `Session request ${action.toLowerCase()} successfully.` });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

app.get('/api/notifications', auth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT notification_id, session_id, type, message, is_read, created_at 
             FROM notifications WHERE user_id = $1 ORDER BY created_at DESC`,
            [req.user.user_id]
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/notifications/:id/read', auth, async (req, res) => {
    try {
        await pool.query(`UPDATE notifications SET is_read = TRUE WHERE notification_id = $1 AND user_id = $2`, [req.params.id, req.user.user_id]);
        res.json({ message: 'Marked as read' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ratings', auth, async (req, res) => {
    const { mentor_id, rating, feedback } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const sessRes = await client.query(
            `INSERT INTO sessions (learner_id, mentor_id, status) VALUES ($1, $2, 'Completed') RETURNING session_id`,
            [req.user.user_id, mentor_id]
        );
        const sessionId = sessRes.rows[0].session_id;

        await client.query(
            `INSERT INTO ratings (session_id, mentor_id, rating, feedback) VALUES ($1, $2, $3, $4)`,
            [sessionId, mentor_id, rating, feedback]
        );

        await client.query(`
            UPDATE users SET average_rating = (SELECT ROUND(AVG(rating)::numeric, 2) FROM ratings WHERE mentor_id = $1) WHERE user_id = $1
        `, [mentor_id]);

        await client.query('COMMIT');
        res.status(201).json({ message: 'Review submitted successfully!' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

app.post('/api/certificates', auth, async (req, res) => {
    const { certificate_name, certificate_details, image_url } = req.body;
    if (!certificate_name) return res.status(400).json({ error: 'Certificate name required' });

    try {
        const result = await pool.query(
            `INSERT INTO certificates (mentor_id, certificate_name, certificate_details, image_url, verification_status)
             VALUES ($1, $2, $3, $4, 'Verified') RETURNING certificate_id`,
            [req.user.user_id, certificate_name, certificate_details || null, image_url || null]
        );
        res.status(201).json({ message: 'Certificate added!', certificate_id: result.rows[0].certificate_id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));