const axios = require('axios');
const _ = require('lodash');
const moment = require('moment-timezone');

moment.locale('fr');

module.exports = Departures = {
	get : (req, res, next) =>  {
		const uic = req.query.uic;

		res.end(uic);
	}
}