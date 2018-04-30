var express = require('express');
var router = express.Router();

var Trains = require('../api/Trains');

router.get('/', Trains.get);

module.exports = router;
