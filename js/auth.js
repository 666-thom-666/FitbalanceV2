const API_URL = location.origin + '/api';
const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

function showRegister() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    clearAlerts();
}
function showLogin() {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
    clearAlerts();
}
function clearAlerts() {
    document.getElementById('loginAlert').innerHTML = '';
    document.getElementById('registerAlert').innerHTML = '';
}
function showAlert(id, msg, type) {
    const el = document.getElementById(id);
    el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
    setTimeout(() => { el.innerHTML = ''; }, 5000);
}
async function login() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    if (!username || !password) return showAlert('loginAlert', 'Заполните все поля', 'error');
    try {
        const r = await fetch(`${API_URL}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        const data = await r.json();
        if (r.ok) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            location.href = '/dashboard';
        } else showAlert('loginAlert', data.error || 'Ошибка входа', 'error');
    } catch { showAlert('loginAlert', 'Ошибка соединения с сервером', 'error'); }
}
async function register() {
    const full_name = document.getElementById('regFullName').value;
    const username = document.getElementById('regUsername').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    if (!username || !email || !password) return showAlert('registerAlert', 'Заполните обязательные поля', 'error');
    try {
        const r = await fetch(`${API_URL}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email, password, full_name }) });
        const data = await r.json();
        if (r.ok) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            location.href = '/dashboard';
        } else showAlert('registerAlert', data.error || 'Ошибка регистрации', 'error');
    } catch { showAlert('registerAlert', 'Ошибка соединения с сервером', 'error'); }
}
if (localStorage.getItem('token')) location.href = '/dashboard';
