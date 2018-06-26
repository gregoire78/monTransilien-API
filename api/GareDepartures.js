const axios = require('axios');
const _ = require('lodash');
const moment = require('moment-timezone');
const cheerio = require('cheerio');
const gares = require('./garesNames.json');

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
	return axios.get(`https://api.sncf.com/v1/coverage/sncf/vehicle_journeys?headsign=${train.number}&since=${moment(train.expectedDepartureTime).format('YYYYMMDD[T000000]')}&until=${moment(train.expectedDepartureTime).format('YYYYMMDD[T235959]')}`, {
		headers: {
			'Authorization': SNCFAPI_KEY
		}
	})
	.then(response => { 
		console.log(`https://api.sncf.com/v1/coverage/sncf/vehicle_journeys?headsign=${train.number}&since=${moment(train.expectedDepartureTime).format('YYYYMMDD[T000000]')}&until=${moment(train.expectedDepartureTime).format('YYYYMMDD[T235959]')}`)		
		return response.data
	})
	.catch(err => {
		return new Promise(resolve => {
			console.log(`https://api.sncf.com/v1/coverage/sncf/vehicle_journeys?headsign=${train.number}`)
			return axios.get(`https://api.sncf.com/v1/coverage/sncf/vehicle_journeys?headsign=${train.number}`, {
				headers: {
					'Authorization': SNCFAPI_KEY
				}
			})
			.then(response => { resolve(response.data) })
			.catch(err => {resolve({})})
		})
	})
}

const getUIC = (tr3a) => {
	const uic7 = _.result(_.find(gares, (obj) => {
		return obj.code === tr3a;
	}), 'uic7');
	return getInfosPointArret(uic7).then(data => {return data.code_uic});
}

const getInfosPointArret = (uic7) => {
	return axios.get(`https://data.sncf.com/api/records/1.0/search/?dataset=sncf-gares-et-arrets-transilien-ile-de-france&q=${uic7}&rows=1`)
	.then(response => {
		return !_.isEmpty(response.data.records) ? response.data.records[0].fields : uic7;
	})
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
		.then(result => {
			if(!_.isEmpty(result)){
				train.journey = result.vehicle_journeys[0].stop_times;
				train.journey_text = train.journey.length == 0 ? "Desserte indisponible" : train.departure == train.terminus ? "terminus" : _.join(_.map(train.journey, (o) => {
					return o.stop_point.name /*+ " ("+moment(o.departure_time, 'HHmmss').format('HH[h]mm')+")"*/;
				}), ' • ');
				train.journey_text_html = _.join(_.map(train.journey, (o) => {
					return o.stop_point.name /*+ " ("+moment(o.departure_time, 'HHmmss').format('HH[h]mm')+")"*/;
				}), ' <span class="dot-separator">•</span> ');
			}
			train.expectedDepartureTime = moment(train.expectedDepartureTime).format('LT');
			return _.pickBy(train, _.identity)
		})
		.then(data => resolve(data))
	})
}

module.exports = Departures = {
	get : (req, res, next) =>  {
		const tr3a = req.query.uic;

		getUIC(tr3a).then(console.log)
		
		const getPassageAPI = getSncfRealTimeApi(tr3a).then(response => {
			const $ = cheerio.load(response.data);
			return $;
		});

		getPassageAPI
		.then($ => { // filtrage des trains autre que rer ou transilien et certains ter (pour paris montparnasse par exemple)
			stationName = $('body').find(".GareDepart > .bluefont").text().trim();
			return JSON.parse($('body').find("#infos").val())
		})
		.then(data => Promise.all(data.slice(0,6).map(train => getService(train))))
		.then(sncf => res.json(sncf))
		.catch(err => {
			res.status(404).end("Il n'y a aucun prochains départs en temps réél pour la gare")
		})
	}
}