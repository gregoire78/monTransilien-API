var express = require('express');
var router = express.Router();

var Trains = require('../api/Trains');
var TrainsMobi = require('../api/TrainsMobiSncf');

router.get('/', Trains.get);
router.get('/mobi', TrainsMobi.get);

module.exports = router;
