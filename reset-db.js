const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();
const db = new sqlite3.Database(process.env.DB_PATH || './database.sqlite');

const tables = ['food_log','weight_log','workouts','water_log','sleep_log',
  'steps_log','heart_rate_log','body_measurements'];

db.serialize(() => {
  tables.forEach(t => db.run(`DELETE FROM ${t}`));
  // сбросить автоинкремент id
  db.run(`DELETE FROM sqlite_sequence`);
  // при необходимости — удалить и пользователей:
  // db.run('DELETE FROM users');
  console.log('База очищена');
});
db.close();