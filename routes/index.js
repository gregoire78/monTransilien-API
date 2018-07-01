var express = require('express');
var router = express.Router();

var Trains = require('../api/Trains');
var TrainsMobi = require('../api/TrainsMobiSncf');
var TrainsDepartures = require('../api/GareDepartures');
var live = require('../api/livemap')();

router.get('/', Trains.get);
router.get('/mobi', TrainsMobi.get);
router.get('/departures', TrainsDepartures.get);
router.get('/live/:filter?', live.get);

module.exports = router;
