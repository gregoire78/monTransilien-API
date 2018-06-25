const axios = require('axios');
const _ = require('lodash');
const moment = require('moment-timezone');
const cheerio = require('cheerio');

moment.tz.setDefault("Europe/Paris");
moment.locale('fr');

require('./const');

const getSncfRealTimeApi = (codeTR3A) => {
	return axios.get(`https://transilien.mobi/train/result?idOrigin=${codeTR3A}&idDest=`);
}
/*const getSncfRealTimeApi = (uic) => {
	return axios.get(`http://api.transilien.com/gare/${uic}/depart/`, {
		auth: {
			username: SNCFAPI_USERNAME,
			password: SNCFAPI_PWD
		},
		headers: {
			'Accept': 'application/vnd.sncf.transilien.od.depart+xml;vers=1'
		},
		responseType: 'text'
	});
}*/

const getLine = (headsign) => {
	return axios.get(`https://api.sncf.com/v1/coverage/sncf/lines?headsign=${headsign}&`)
	.then(response => { return response.data })
}

const getVehiculeJourney = (train) => {
	console.log(`https://api.sncf.com/v1/coverage/sncf/vehicle_journeys?headsign=${train.number}&since=${moment(train.expectedDepartureTime).format('YYYYMMDD[T000000]')}&until=${moment(train.expectedDepartureTime).format('YYYYMMDD[T235959]')}`)
	return axios.get(`https://api.sncf.com/v1/coverage/sncf/vehicle_journeys?headsign=${train.number}&since=${moment(train.expectedDepartureTime).format('YYYYMMDD[T000000]')}&until=${moment(train.expectedDepartureTime).format('YYYYMMDD[T235959]')}`, {
		headers: {
			'Authorization': SNCFAPI_KEY
		}
	})
	.then(response => { return response.data })
	.catch(err => console.log( train.number, err.response.data))
}

const getService = (t) => {
	const train = {
		name: t.trainMissionCode,
		number: t.trainNumber,
		terminus: t.gareArrivee.name,
		departure: t.gareDepart.name,
		expectedDepartureTime: moment(t.trainDate + " " + t.trainHour, "DD/MM/YYYY HH:mm"),
		aimedDepartureTime: null,
		state: null,
		lane: t.trainLane,
		route: {
			line: null,
			type: (t.ligne.type == "RER") ? "rer" : 
			((t.trainNumber >= 110000 && t.trainNumber <= 169999 && t.ligne.type == "TRAIN") ? "transilien" : 
			(((t.trainNumber >= 830000 || (t.trainNumber >= 16750 && t.trainNumber <= 168749)) && t.ligne.type == "TRAIN") ? "ter" : "TRAIN")),
		},
		journey: null,
		journey_text: null,
		journey_text_html: null,
	}
	train.route.line = train.route.type !== "ter" ? t.ligne.idLigne : null;
	train.route = _.pickBy(train.route, _.identity);
	switch(t.codeMention) {
		case 'N':
			train.state = "à l'heure";
			break;
		case 'S':
			train.state = "supprimé";
			break;
		case 'T':
			train.state = "retardé";
			break;
		default:
			train.state = "à l'heure";
			break;
	};
	return new Promise((resolve, reject) => {
		getVehiculeJourney(train)
		.then(data => resolve(train))
	})
}

module.exports = Departures = {
	get : (req, res, next) =>  {
		const uic = req.query.uic;
		
		const getPassageAPI = getSncfRealTimeApi(uic).then(response => {
			const $ = cheerio.load(response.data);
			return $;
		});

		getPassageAPI
		.then($ => { // filtrage des trains autre que rer ou transilien et certains ter (pour paris montparnasse par exemple)
			stationName = $('body').find(".GareDepart > .bluefont").text().trim();
			return JSON.parse($('body').find("#infos").val())
		})
		.then(data => Promise.all(data.slice(0,7).map(train => getService(train))))
		.then(sncf => res.json(sncf))
		.catch(err => {
			res.status(404).end("Il n'y a aucun prochains départs en temps réél pour la gare")
		})
	}
}