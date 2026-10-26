// scripts/init-db.js
// Jalankan sekali: npm run init-db
// Membuat tabel-tabel + seed role & super admin default
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT || 5432),
});

const SQL = `
CREATE TABLE IF NOT EXISTS roles (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    permissions JSONB NOT NULL DEFAULT '["view_dashboard","input_data"]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    username VARCHAR(64) PRIMARY KEY,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    role_id VARCHAR(32) REFERENCES roles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
    id BIGINT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL,
    progress INT NOT NULL CHECK (progress BETWEEN 0 AND 100),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    goals JSONB NOT NULL DEFAULT '[]'::jsonb,
    attachment TEXT,
    created_by VARCHAR(64) REFERENCES users(username) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS project_comments (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
    author VARCHAR(64) REFERENCES users(username) ON DELETE CASCADE,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_log (
    id BIGSERIAL PRIMARY KEY,
    actor VARCHAR(64),
    action VARCHAR(80),
    detail TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);
`;

(async () => {
    try {
        await pool.query(SQL);
        console.log('✅ Tabel dasar dibuat/dipastikan ada.');

        // Seed default role
        await pool.query(`
            INSERT INTO roles (id, name, permissions) VALUES
              ('R01','Software Engineer','["view_dashboard","input_data","manage_users","manage_roles","view_all_projects"]'::jsonb)
            ON CONFLICT (id) DO NOTHING;
        `);

        // Seed super admin default (password: password123) — ganti setelah login!
        const hash = await bcrypt.hash('password123', 10);
        await pool.query(`
            INSERT INTO users (username, password, full_name, role_id)
            VALUES ('emen', $1, 'Emen AI Developer', 'R01')
            ON CONFLICT (username) DO NOTHING;
        `, [hash]);

        console.log('✅ Seed role R01 & user "emen" siap.');
        console.log('   Username: emen');
        console.log('   Password: password123  (SEGERA GANTI!)');
        process.exit(0);
    } catch (err) {
        console.error('❌ Gagal init DB:', err);
        process.exit(1);
    }
})();