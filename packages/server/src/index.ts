import { config } from './config.js';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { seedAdmin, seedSampleData } from './seed.js';

const db = openDb(config.dbPath);
seedAdmin(db, config.adminUser, config.adminPass);
seedSampleData(db);

const app = createApp(db);
app.listen(config.port, () => {
  console.log(`DUTOAN-AI đang chạy tại http://localhost:${config.port}`);
});
