const Database = require("better-sqlite3");
const path = require("path");

require("dotenv").config();

const databaseFile =
    process.env.DATABASE_FILE || "./trustlens.sqlite";

const db = new Database(path.resolve(databaseFile));

db.pragma("foreign_keys = ON");

module.exports = db;
