const db = require("./db");

function initializeDatabase() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS questions (
            id TEXT PRIMARY KEY,
            email_id TEXT NOT NULL,
            officer_id TEXT NOT NULL,
            question TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS answers (
            id TEXT PRIMARY KEY,
            question_id TEXT NOT NULL,
            type TEXT NOT NULL,
            answer TEXT NOT NULL,
            category TEXT NOT NULL,
            confidence REAL,
            claims TEXT NOT NULL,
            sources TEXT NOT NULL,
            FOREIGN KEY (question_id) REFERENCES questions(id)
        );

        CREATE TABLE IF NOT EXISTS reviews (
            id TEXT PRIMARY KEY,
            question_id TEXT NOT NULL,
            answer_id TEXT NOT NULL,
            trigger TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            note TEXT,
            created_at TEXT NOT NULL,
            decision TEXT,
            FOREIGN KEY (question_id) REFERENCES questions(id),
            FOREIGN KEY (answer_id) REFERENCES answers(id)
        );
    `);

    console.log("TrustLens database tables initialized!");
}

module.exports = { initializeDatabase };