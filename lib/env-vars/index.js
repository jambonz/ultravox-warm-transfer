const router = require('express').Router();

router.use('/gemini', require('./options-handler'));
router.use('/ultravox', require('./options-handler'));
module.exports = router;
