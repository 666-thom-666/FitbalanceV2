const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const JWT_SECRET = (process.env.JWT_SECRET || 'fitbalance_dev_secret').trim();

// Текущая дата в формате YYYY-MM-DD (локальная). Используется как значение
// по умолчанию для всех записей, если клиент не передал дату.
function today() {
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

// ───────────────────────── Middleware ─────────────────────────
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Базовые security-заголовки (без доп. зависимостей)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
    next();
});

// Кэширование статики (оптимизация загрузки на телефоне)
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1d',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    }
}));

app.use(session({
    secret: process.env.SESSION_SECRET || 'fitbalance_session',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// ───────────────────────── База данных ─────────────────────────
const db = new sqlite3.Database(process.env.DB_PATH || './database.sqlite');

db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON');

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        full_name TEXT,
        age INTEGER,
        weight REAL,
        height REAL,
        gender TEXT,
        activity_level TEXT,
        goal TEXT,
        daily_calorie_goal REAL DEFAULT 2000,
        step_goal INTEGER DEFAULT 10000,
        water_goal INTEGER DEFAULT 2000,
        sleep_goal REAL DEFAULT 8,
        active_minutes_goal INTEGER DEFAULT 30,
        theme TEXT DEFAULT 'dark',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS food_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        food_name TEXT NOT NULL,
        calories REAL NOT NULL,
        protein REAL, carbs REAL, fats REAL,
        meal_type TEXT,
        date DATE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS weight_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        weight REAL NOT NULL,
        date DATE NOT NULL,
        notes TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Тренировки / активность
    db.run(`CREATE TABLE IF NOT EXISTS workouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        type TEXT NOT NULL,
        duration_min REAL NOT NULL,
        distance_km REAL DEFAULT 0,
        calories_burned REAL DEFAULT 0,
        avg_heart_rate INTEGER,
        notes TEXT,
        date DATE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Вода
    db.run(`CREATE TABLE IF NOT EXISTS water_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount_ml INTEGER NOT NULL,
        date DATE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Сон
    db.run(`CREATE TABLE IF NOT EXISTS sleep_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        hours REAL NOT NULL,
        quality INTEGER,
        bedtime TEXT,
        waketime TEXT,
        date DATE NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Шаги (одна запись на день — upsert)
    db.run(`CREATE TABLE IF NOT EXISTS steps_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        steps INTEGER NOT NULL DEFAULT 0,
        distance_km REAL DEFAULT 0,
        calories REAL DEFAULT 0,
        date DATE NOT NULL,
        UNIQUE(user_id, date),
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Пульс
    db.run(`CREATE TABLE IF NOT EXISTS heart_rate_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        bpm INTEGER NOT NULL,
        context TEXT,
        date DATE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Замеры тела
    db.run(`CREATE TABLE IF NOT EXISTS body_measurements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        chest REAL, waist REAL, hips REAL, arms REAL, thighs REAL, body_fat REAL,
        date DATE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Индексы для ускорения выборок (оптимизация)
    db.run('CREATE INDEX IF NOT EXISTS idx_food_user_date ON food_log(user_id, date)');
    db.run('CREATE INDEX IF NOT EXISTS idx_workout_user_date ON workouts(user_id, date)');
    db.run('CREATE INDEX IF NOT EXISTS idx_water_user_date ON water_log(user_id, date)');
    db.run('CREATE INDEX IF NOT EXISTS idx_sleep_user_date ON sleep_log(user_id, date)');
    db.run('CREATE INDEX IF NOT EXISTS idx_steps_user_date ON steps_log(user_id, date)');
    db.run('CREATE INDEX IF NOT EXISTS idx_weight_user_date ON weight_log(user_id, date)');
});

// ───────────────────────── Авторизация ─────────────────────────
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный токен' });
        req.user = user;
        next();
    });
};

// ───────────────────────── Страницы ─────────────────────────
const pages = ['dashboard', 'calculator', 'activity', 'food', 'water', 'sleep',
               'measurements', 'progress', 'history', 'profile', 'about'];
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
pages.forEach(p => {
    app.get('/' + p, (req, res) =>
        res.sendFile(path.join(__dirname, 'public', 'pages', p + '.html')));
});

// ───────────────────────── Auth API ─────────────────────────
app.post('/api/register', async (req, res) => {
    const { username, email, password, full_name } = req.body;
    if (!username || !email || !password)
        return res.status(400).json({ error: 'Заполните имя пользователя, email и пароль' });
    if (String(password).length < 6)
        return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' });
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run('INSERT INTO users (username, email, password, full_name) VALUES (?, ?, ?, ?)',
            [username, email, hashedPassword, full_name],
            function (err) {
                if (err) return res.status(400).json({ error: 'Пользователь уже существует' });
                const token = jwt.sign({ id: this.lastID, username, email }, JWT_SECRET, { expiresIn: '24h' });
                res.status(201).json({ message: 'Аккаунт создан', token,
                    user: { id: this.lastID, username, email, full_name } });
            });
    } catch (e) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, username], async (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'Пользователь не найден' });
        const ok = await bcrypt.compare(password, user.password);
        if (!ok) return res.status(400).json({ error: 'Неверный пароль' });
        const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ message: 'Вход выполнен', token,
            user: { id: user.id, username: user.username, email: user.email, full_name: user.full_name } });
    });
});

// ───────────────────────── Профиль ─────────────────────────
app.get('/api/profile', authenticateToken, (req, res) => {
    db.get(`SELECT id, username, email, full_name, age, weight, height, gender,
            activity_level, goal, daily_calorie_goal, step_goal, water_goal,
            sleep_goal, active_minutes_goal, theme FROM users WHERE id = ?`,
        [req.user.id], (err, user) => {
            if (err || !user) return res.status(404).json({ error: 'Пользователь не найден' });
            res.json(user);
        });
});

app.put('/api/profile', authenticateToken, (req, res) => {
    const f = req.body;
    // Собираем динамический UPDATE только из переданных полей
    const allowed = ['full_name','age','weight','height','gender','activity_level','goal',
                     'daily_calorie_goal','step_goal','water_goal','sleep_goal','active_minutes_goal','theme'];
    const keys = allowed.filter(k => f[k] !== undefined);
    if (keys.length === 0) return res.json({ message: 'Нет изменений' });
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => f[k]);
    values.push(req.user.id);
    db.run(`UPDATE users SET ${setClause} WHERE id = ?`, values, (err) => {
        if (err) return res.status(400).json({ error: 'Не удалось сохранить' });
        res.json({ message: 'Профиль обновлён' });
    });
});

// ───────────────────────── Питание ─────────────────────────
app.post('/api/food', authenticateToken, (req, res) => {
    const { food_name, calories, protein, carbs, fats, meal_type, date } = req.body;
    const d = date || today();
    if (!food_name || calories == null) return res.status(400).json({ error: 'Укажите продукт и калории' });
    db.run(`INSERT INTO food_log (user_id, food_name, calories, protein, carbs, fats, meal_type, date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, food_name, calories, protein || 0, carbs || 0, fats || 0, meal_type || 'other', d],
        function (err) {
            if (err) return res.status(400).json({ error: 'Не удалось добавить продукт' });
            res.status(201).json({ message: 'Продукт добавлен', id: this.lastID });
        });
});

app.get('/api/food', authenticateToken, (req, res) => {
    const { date } = req.query;
    let q = 'SELECT * FROM food_log WHERE user_id = ?';
    const p = [req.user.id];
    if (date) { q += ' AND date = ?'; p.push(date); }
    q += ' ORDER BY created_at DESC';
    db.all(q, p, (err, rows) => err ? res.status(400).json({ error: 'Ошибка' }) : res.json(rows));
});

app.delete('/api/food/:id', authenticateToken, (req, res) => {
    db.run('DELETE FROM food_log WHERE id = ? AND user_id = ?', [req.params.id, req.user.id],
        (err) => err ? res.status(400).json({ error: 'Ошибка' }) : res.json({ message: 'Удалено' }));
});

// ───────────────────────── Вес ─────────────────────────
app.post('/api/weight', authenticateToken, (req, res) => {
    const { weight, date, notes } = req.body;
    const d = date || today();
    if (!weight) return res.status(400).json({ error: 'Укажите вес' });
    db.run('INSERT INTO weight_log (user_id, weight, date, notes) VALUES (?, ?, ?, ?)',
        [req.user.id, weight, d, notes || null],
        function (err) {
            if (err) return res.status(400).json({ error: 'Ошибка' });
            // Дублируем актуальный вес в профиль
            db.run('UPDATE users SET weight = ? WHERE id = ?', [weight, req.user.id]);
            res.status(201).json({ message: 'Вес записан', id: this.lastID });
        });
});

app.get('/api/weight', authenticateToken, (req, res) => {
    db.all('SELECT * FROM weight_log WHERE user_id = ? ORDER BY date DESC LIMIT 60',
        [req.user.id], (err, rows) => err ? res.status(400).json({ error: 'Ошибка' }) : res.json(rows));
});

app.delete('/api/weight/:id', authenticateToken, (req, res) => {
    db.run('DELETE FROM weight_log WHERE id = ? AND user_id = ?', [req.params.id, req.user.id],
        (err) => err ? res.status(400).json({ error: 'Ошибка' }) : res.json({ message: 'Удалено' }));
});

// ───────────────────────── Тренировки ─────────────────────────
app.post('/api/workouts', authenticateToken, (req, res) => {
    const { type, duration_min, distance_km, calories_burned, avg_heart_rate, notes, date } = req.body;
    const d = date || today();
    if (!type || !duration_min) return res.status(400).json({ error: 'Укажите тип и длительность' });
    db.run(`INSERT INTO workouts (user_id, type, duration_min, distance_km, calories_burned, avg_heart_rate, notes, date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, type, duration_min, distance_km || 0, calories_burned || 0, avg_heart_rate || null, notes || '', d],
        function (err) {
            if (err) return res.status(400).json({ error: 'Ошибка' });
            res.status(201).json({ message: 'Тренировка сохранена', id: this.lastID });
        });
});

app.get('/api/workouts', authenticateToken, (req, res) => {
    const { date } = req.query;
    let q = 'SELECT * FROM workouts WHERE user_id = ?';
    const p = [req.user.id];
    if (date) { q += ' AND date = ?'; p.push(date); }
    q += ' ORDER BY created_at DESC LIMIT 100';
    db.all(q, p, (err, rows) => err ? res.status(400).json({ error: 'Ошибка' }) : res.json(rows));
});

app.delete('/api/workouts/:id', authenticateToken, (req, res) => {
    db.run('DELETE FROM workouts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id],
        (err) => err ? res.status(400).json({ error: 'Ошибка' }) : res.json({ message: 'Удалено' }));
});

// ───────────────────────── Вода ─────────────────────────
app.post('/api/water', authenticateToken, (req, res) => {
    const { amount_ml, date } = req.body;
    const d = date || today();
    if (!amount_ml) return res.status(400).json({ error: 'Укажите объём' });
    db.run('INSERT INTO water_log (user_id, amount_ml, date) VALUES (?, ?, ?)',
        [req.user.id, amount_ml, d],
        function (err) {
            if (err) return res.status(400).json({ error: 'Ошибка' });
            res.status(201).json({ message: 'Записано', id: this.lastID });
        });
});

app.get('/api/water', authenticateToken, (req, res) => {
    const { date } = req.query;
    db.all('SELECT * FROM water_log WHERE user_id = ? AND date = ? ORDER BY created_at DESC',
        [req.user.id, date], (err, rows) => {
            if (err) return res.status(400).json({ error: 'Ошибка' });
            const total = rows.reduce((s, r) => s + r.amount_ml, 0);
            res.json({ entries: rows, total });
        });
});

app.delete('/api/water/:id', authenticateToken, (req, res) => {
    db.run('DELETE FROM water_log WHERE id = ? AND user_id = ?', [req.params.id, req.user.id],
        (err) => err ? res.status(400).json({ error: 'Ошибка' }) : res.json({ message: 'Удалено' }));
});

// ───────────────────────── Сон ─────────────────────────
app.post('/api/sleep', authenticateToken, (req, res) => {
    const { hours, quality, bedtime, waketime, date } = req.body;
    const d = date || today();
    if (hours == null) return res.status(400).json({ error: 'Укажите длительность сна' });
    db.run(`INSERT INTO sleep_log (user_id, hours, quality, bedtime, waketime, date)
            VALUES (?, ?, ?, ?, ?, ?)`,
        [req.user.id, hours, quality || null, bedtime || '', waketime || '', d],
        function (err) {
            if (err) return res.status(400).json({ error: 'Ошибка' });
            res.status(201).json({ message: 'Сон записан', id: this.lastID });
        });
});

app.get('/api/sleep', authenticateToken, (req, res) => {
    db.all('SELECT * FROM sleep_log WHERE user_id = ? ORDER BY date DESC LIMIT 30',
        [req.user.id], (err, rows) => err ? res.status(400).json({ error: 'Ошибка' }) : res.json(rows));
});

app.delete('/api/sleep/:id', authenticateToken, (req, res) => {
    db.run('DELETE FROM sleep_log WHERE id = ? AND user_id = ?', [req.params.id, req.user.id],
        (err) => err ? res.status(400).json({ error: 'Ошибка' }) : res.json({ message: 'Удалено' }));
});

// ───────────────────────── Шаги (upsert по дню) ─────────────────────────
app.post('/api/steps', authenticateToken, (req, res) => {
    const { steps, distance_km, calories, date } = req.body;
    const d = date || today();
    db.run(`INSERT INTO steps_log (user_id, steps, distance_km, calories, date)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, date) DO UPDATE SET
              steps = excluded.steps,
              distance_km = excluded.distance_km,
              calories = excluded.calories`,
        [req.user.id, steps || 0, distance_km || 0, calories || 0, d],
        function (err) {
            if (err) return res.status(400).json({ error: 'Ошибка' });
            res.status(201).json({ message: 'Шаги сохранены' });
        });
});

app.get('/api/steps', authenticateToken, (req, res) => {
    const { date } = req.query;
    if (date) {
        db.get('SELECT * FROM steps_log WHERE user_id = ? AND date = ?', [req.user.id, date],
            (err, row) => err ? res.status(400).json({ error: 'Ошибка' })
                : res.json(row || { steps: 0, distance_km: 0, calories: 0, date }));
    } else {
        db.all('SELECT * FROM steps_log WHERE user_id = ? ORDER BY date DESC LIMIT 30',
            [req.user.id], (err, rows) => err ? res.status(400).json({ error: 'Ошибка' }) : res.json(rows));
    }
});

// ───────────────────────── Пульс ─────────────────────────
app.post('/api/heartrate', authenticateToken, (req, res) => {
    const { bpm, context, date } = req.body;
    const d = date || today();
    if (!bpm) return res.status(400).json({ error: 'Укажите пульс' });
    db.run('INSERT INTO heart_rate_log (user_id, bpm, context, date) VALUES (?, ?, ?, ?)',
        [req.user.id, bpm, context || 'rest', d],
        function (err) {
            if (err) return res.status(400).json({ error: 'Ошибка' });
            res.status(201).json({ message: 'Записано', id: this.lastID });
        });
});

app.get('/api/heartrate', authenticateToken, (req, res) => {
    db.all('SELECT * FROM heart_rate_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 30',
        [req.user.id], (err, rows) => err ? res.status(400).json({ error: 'Ошибка' }) : res.json(rows));
});

// ───────────────────────── Замеры тела ─────────────────────────
app.post('/api/measurements', authenticateToken, (req, res) => {
    const { chest, waist, hips, arms, thighs, body_fat, date } = req.body;
    const d = date || today();
    db.run(`INSERT INTO body_measurements (user_id, chest, waist, hips, arms, thighs, body_fat, date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, chest || null, waist || null, hips || null, arms || null, thighs || null, body_fat || null, d],
        function (err) {
            if (err) return res.status(400).json({ error: 'Ошибка' });
            res.status(201).json({ message: 'Замеры сохранены', id: this.lastID });
        });
});

app.get('/api/measurements', authenticateToken, (req, res) => {
    db.all('SELECT * FROM body_measurements WHERE user_id = ? ORDER BY date DESC LIMIT 30',
        [req.user.id], (err, rows) => err ? res.status(400).json({ error: 'Ошибка' }) : res.json(rows));
});

app.delete('/api/measurements/:id', authenticateToken, (req, res) => {
    db.run('DELETE FROM body_measurements WHERE id = ? AND user_id = ?', [req.params.id, req.user.id],
        (err) => err ? res.status(400).json({ error: 'Ошибка' }) : res.json({ message: 'Удалено' }));
});

// ───────────────────────── Сводка дня (dashboard) ─────────────────────────
app.get('/api/dashboard/:date', authenticateToken, (req, res) => {
    const { date } = req.params;
    const uid = req.user.id;
    const result = {};
    db.get('SELECT daily_calorie_goal, step_goal, water_goal, sleep_goal, active_minutes_goal FROM users WHERE id = ?',
        [uid], (e1, goals) => {
        result.goals = goals || {};
        db.get(`SELECT COALESCE(SUM(calories),0) c, COALESCE(SUM(protein),0) p,
                COALESCE(SUM(carbs),0) cb, COALESCE(SUM(fats),0) f
                FROM food_log WHERE user_id = ? AND date = ?`, [uid, date], (e2, food) => {
            result.food = food;
            db.get(`SELECT COALESCE(SUM(calories_burned),0) burned, COALESCE(SUM(duration_min),0) minutes,
                    COUNT(*) cnt FROM workouts WHERE user_id = ? AND date = ?`, [uid, date], (e3, w) => {
                result.workouts = w;
                db.get('SELECT * FROM steps_log WHERE user_id = ? AND date = ?', [uid, date], (e4, st) => {
                    result.steps = st || { steps: 0, distance_km: 0, calories: 0 };
                    db.get('SELECT COALESCE(SUM(amount_ml),0) total FROM water_log WHERE user_id = ? AND date = ?',
                        [uid, date], (e5, water) => {
                        result.water = water.total;
                        db.get('SELECT hours, quality FROM sleep_log WHERE user_id = ? AND date = ? ORDER BY id DESC LIMIT 1',
                            [uid, date], (e6, sleep) => {
                            result.sleep = sleep || null;
                            res.json(result);
                        });
                    });
                });
            });
        });
    });
});

// ───────────────────────── Статистика для графиков ─────────────────────────
app.get('/api/stats/:metric', authenticateToken, (req, res) => {
    const uid = req.user.id;
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const since = new Date(); since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split('T')[0];
    const m = req.params.metric;

    const queries = {
        weight:   ['SELECT date, weight AS value FROM weight_log WHERE user_id = ? AND date >= ? ORDER BY date ASC'],
        steps:    ['SELECT date, steps AS value FROM steps_log WHERE user_id = ? AND date >= ? ORDER BY date ASC'],
        water:    ['SELECT date, SUM(amount_ml) AS value FROM water_log WHERE user_id = ? AND date >= ? GROUP BY date ORDER BY date ASC'],
        sleep:    ['SELECT date, hours AS value FROM sleep_log WHERE user_id = ? AND date >= ? ORDER BY date ASC'],
        calories: ['SELECT date, SUM(calories) AS value FROM food_log WHERE user_id = ? AND date >= ? GROUP BY date ORDER BY date ASC'],
        burned:   ['SELECT date, SUM(calories_burned) AS value FROM workouts WHERE user_id = ? AND date >= ? GROUP BY date ORDER BY date ASC']
    };
    if (!queries[m]) return res.status(400).json({ error: 'Неизвестная метрика' });
    db.all(queries[m][0], [uid, sinceStr], (err, rows) =>
        err ? res.status(400).json({ error: 'Ошибка' }) : res.json(rows));
});

// ───────────────────────── Достижения ─────────────────────────
app.get('/api/achievements', authenticateToken, (req, res) => {
    const uid = req.user.id;
    const stats = {};
    db.get('SELECT COUNT(*) n FROM workouts WHERE user_id = ?', [uid], (e1, a) => {
        stats.workouts = a.n;
        db.get('SELECT MAX(steps) m FROM steps_log WHERE user_id = ?', [uid], (e2, b) => {
            stats.maxSteps = b.m || 0;
            db.get('SELECT COUNT(*) n FROM food_log WHERE user_id = ?', [uid], (e3, c) => {
                stats.foodEntries = c.n;
                db.get('SELECT COUNT(DISTINCT date) n FROM steps_log WHERE user_id = ? AND steps >= 10000', [uid], (e4, d) => {
                    stats.days10k = d.n;
                    db.get('SELECT COALESCE(SUM(distance_km),0) d FROM workouts WHERE user_id = ?', [uid], (e5, f) => {
                        stats.totalDistance = f.d;
                        db.get('SELECT COUNT(*) n FROM weight_log WHERE user_id = ?', [uid], (e6, g) => {
                            stats.weighIns = g.n;
                            res.json(stats);
                        });
                    });
                });
            });
        });
    });
});

// Сводка за день (совместимость со старым фронтом)
app.get('/api/summary/:date', authenticateToken, (req, res) => {
    const { date } = req.params;
    db.get(`SELECT COALESCE(SUM(calories),0) total_calories, COALESCE(SUM(protein),0) total_protein,
            COALESCE(SUM(carbs),0) total_carbs, COALESCE(SUM(fats),0) total_fats
            FROM food_log WHERE user_id = ? AND date = ?`, [req.user.id, date], (err, summary) => {
        if (err) return res.status(400).json({ error: 'Ошибка' });
        db.get('SELECT daily_calorie_goal FROM users WHERE id = ?', [req.user.id], (e, user) => {
            const goal = user?.daily_calorie_goal || 2000;
            res.json({ ...summary, calorie_goal: goal, remaining: goal - summary.total_calories });
        });
    });
});

app.listen(PORT, () => console.log(`FITBALANCE server running on http://localhost:${PORT}`));
