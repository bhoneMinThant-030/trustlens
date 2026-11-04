const express = require("express");
const router = express.Router();

const { askQuestion } = require("../controllers/askController");

router.post("/", askQuestion);

module.exports = router;