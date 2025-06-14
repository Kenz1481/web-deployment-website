const Database = require('better-sqlite3');
const db = new Database('wanzofc_deploy.sqlite');
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    github_url TEXT,
    vercel_url TEXT,
    status TEXT DEFAULT 'pending_github', -- pending_github, pending_deploy, deployed, error
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    reviewer_name TEXT, -- Opsional, bisa anonim
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
  );
`);

module.exports = db;