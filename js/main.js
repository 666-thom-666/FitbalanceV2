// ===================== FITBALANCE — общий модуль =====================
const API_URL = location.origin + '/api';   // работает и с телефона по локальной сети

/* ---------- Авторизация ---------- */
function getToken() { return localStorage.getItem('token'); }
function getUser() { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } }
function logout() { localStorage.removeItem('token'); localStorage.removeItem('user'); location.href = '/'; }
function checkAuth() { if (!getToken()) location.href = '/'; }
function getHeaders() { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` }; }

/* ---------- Дата ---------- */
function formatDate(d) { return new Date(d).toISOString().split('T')[0]; }
function getCurrentDate() { return formatDate(new Date()); }
function ruDate(s) {
    const d = new Date(s);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/* ---------- Тема ---------- */
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme || 'dark');
    localStorage.setItem('theme', theme || 'dark');
    const ic = document.getElementById('themeIcon');
    if (ic) ic.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
}
function toggleTheme() {
    const next = (localStorage.getItem('theme') === 'light') ? 'dark' : 'light';
    applyTheme(next);
    if (getToken()) fetch(`${API_URL}/profile`, { method: 'PUT', headers: getHeaders(), body: JSON.stringify({ theme: next }) }).catch(() => {});
}
applyTheme(localStorage.getItem('theme') || 'dark');

/* ---------- Уведомления ---------- */
function showNotification(message, type = 'success') {
    const n = document.createElement('div');
    n.className = `alert alert-${type}`;
    n.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;max-width:90%;box-shadow:0 6px 24px rgba(0,0,0,.4)';
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 2800);
}

/* ---------- Расчёты ---------- */
function calculateBMR(weight, height, age, gender) {
    // Формула Миффлина — Сан Жеора
    const base = 10 * weight + 6.25 * height - 5 * age;
    return gender === 'male' ? base + 5 : base - 161;
}
function calculateTDEE(bmr, level) {
    const k = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
    return bmr * (k[level] || 1.2);
}
// MET-значения для расчёта сожжённых калорий
const MET = {
    walking: 3.5, running: 9.8, cycling: 7.5, swimming: 8.0, gym: 6.0,
    yoga: 3.0, hiit: 10.0, dancing: 5.0, football: 8.0, basketball: 8.0,
    tennis: 7.3, hiking: 6.0, rowing: 7.0, jumping_rope: 12.0, other: 5.0
};
function workoutCalories(type, minutes, weightKg) {
    const met = MET[type] || 5;
    const w = weightKg || 70;
    return Math.round(met * 3.5 * w / 200 * minutes);
}
const WORKOUT_LABELS = {
    walking: 'Ходьба', running: 'Бег', cycling: 'Велосипед', swimming: 'Плавание',
    gym: 'Тренажёрный зал', yoga: 'Йога', hiit: 'HIIT', dancing: 'Танцы',
    football: 'Футбол', basketball: 'Баскетбол', tennis: 'Теннис', hiking: 'Поход',
    rowing: 'Гребля', jumping_rope: 'Скакалка', other: 'Другое'
};
const WORKOUT_ICONS = {
    walking: 'fa-person-walking', running: 'fa-person-running', cycling: 'fa-bicycle',
    swimming: 'fa-person-swimming', gym: 'fa-dumbbell', yoga: 'fa-spa', hiit: 'fa-fire',
    dancing: 'fa-music', football: 'fa-futbol', basketball: 'fa-basketball',
    tennis: 'fa-table-tennis-paddle-ball', hiking: 'fa-mountain', rowing: 'fa-water',
    jumping_rope: 'fa-bolt', other: 'fa-heart-pulse'
};

/* ---------- Профиль ---------- */
async function loadUserProfile() {
    try {
        const r = await fetch(`${API_URL}/profile`, { headers: getHeaders() });
        if (r.ok) { const u = await r.json(); localStorage.setItem('user', JSON.stringify(u)); if (u.theme) applyTheme(u.theme); return u; }
    } catch (e) { console.error(e); }
    return null;
}
async function updateProfile(data) {
    try {
        const r = await fetch(`${API_URL}/profile`, { method: 'PUT', headers: getHeaders(), body: JSON.stringify(data) });
        if (r.ok) { await loadUserProfile(); showNotification('Сохранено'); return true; }
    } catch (e) { showNotification('Ошибка сохранения', 'error'); }
    return false;
}

/* ---------- Кольцо активности (SVG) ---------- */
function buildRing(value, goal, color, radius) {
    const pct = Math.min(value / (goal || 1), 1);
    const circ = 2 * Math.PI * radius;
    const offset = circ * (1 - pct);
    return { circ, offset, color, radius };
}

/* ---------- Навигация ---------- */
const NAV = [
    { href: '/dashboard',    icon: 'fa-house',          label: 'Главная' },
    { href: '/activity',     icon: 'fa-person-running', label: 'Активность' },
    { href: '/food',         icon: 'fa-utensils',       label: 'Питание' },
    { href: '/progress',     icon: 'fa-chart-line',     label: 'Прогресс' },
    { href: '/profile',      icon: 'fa-user',           label: 'Профиль' }
];
const NAV_MORE = [
    { href: '/calculator',   icon: 'fa-calculator',  label: 'Калькулятор' },
    { href: '/water',        icon: 'fa-droplet',     label: 'Вода' },
    { href: '/sleep',        icon: 'fa-bed',         label: 'Сон' },
    { href: '/measurements', icon: 'fa-ruler',       label: 'Замеры' },
    { href: '/history',      icon: 'fa-clock-rotate-left', label: 'История' },
    { href: '/about',        icon: 'fa-circle-info', label: 'О проекте' }
];
function renderNav(active) {
    const all = [...NAV, ...NAV_MORE];
    // Верхняя панель (десктоп)
    const top = document.getElementById('topNav');
    if (top) {
        top.innerHTML = all.map(n =>
            `<a href="${n.href}" class="nav-link ${n.href === active ? 'active' : ''}"><i class="fas ${n.icon}"></i>${n.label}</a>`
        ).join('') +
        `<button class="theme-toggle" onclick="toggleTheme()" title="Тема"><i id="themeIcon" class="fas fa-sun"></i></button>` +
        `<a href="#" class="nav-link" onclick="logout()"><i class="fas fa-right-from-bracket"></i>Выход</a>`;
    }
    // Нижняя панель (телефон)
    const bottom = document.getElementById('bottomNav');
    if (bottom) {
        bottom.innerHTML = NAV.map(n =>
            `<a href="${n.href}" class="${n.href === active ? 'active' : ''}"><i class="fas ${n.icon}"></i><span>${n.label}</span></a>`
        ).join('');
    }
    applyTheme(localStorage.getItem('theme') || 'dark');
}

/* ---------- Регистрация service worker (PWA) ---------- */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
