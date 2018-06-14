const gtfs = require('gtfs');
const mongoose = require('mongoose');
const _ = require('lodash');
const axios = require('axios');
const moment = require('moment-timezone');
const cheerio = require('cheerio');

const gares = require('./gares.json');

moment.tz.setDefault("Europe/Paris");
moment.locale('fr');
require('./const');
mongoose.connect(`mongodb://${MONGO_USERNAME}:${MONGO_PWD}@${MONGO_IP}/gtfs?authSource=admin`);

function getSncfRealTimeApi(codeTR3A) {
	return axios.get(`https://transilien.mobi/train/result?idOrigin=${codeTR3A}&idDest=`);
}

function getColorLigne(q) {
	return axios.get(`https://data.sncf.com/api/records/1.0/search/?dataset=codes-couleur-des-lignes-transilien&q="${q}"&rows=1`)
	.then(result => {
		return !_.isEmpty(result.data.records) ? result.data.records[0].fields : q;
	});
}

function getInfosPointArret(uic8) {
	return axios.get(`https://data.sncf.com/api/records/1.0/search/?dataset=sncf-gares-et-arrets-transilien-ile-de-france&q=${uic8}&rows=1`)
	.then(response => {
		return !_.isEmpty(response.data.records) ? response.data.records[0].fields : uic8;
	})
}

function getMoreInformations(uic) {
	return axios.get(`https://www.sncf.com/api/iv/1.0/infoVoy/rechercherProchainsDeparts?codeZoneArret=OCE${uic}&indicateurReponseGaresSecondaires=true&format=html`)
	.then(result => {
		let lastRes  = _.last(result.data.reponseRechercherProchainsDeparts.reponse.listeResultats.resultat).donnees;
		if(lastRes.listeHoraires)
			return lastRes;
		else
			return result.data.reponseRechercherProchainsDeparts.reponse.listeResultats.resultat[0].donnees;
	});
}

function rechercherListeCirculations(numero, date) {
	return axios.get(`https://www.sncf.com/api/iv/1.0/infoVoy/rechercherListeCirculations?numero=${numero}&dateCirculation=${date}&codeZoneArret&typeHoraire=TEMPS_REEL&codeZoneArretDepart&codeZoneArretArrivee&compositions=0&codeCirculation&format=html`)
	.then(response => {
		return response.data.reponseRechercherListeCirculations.reponse.listeResultats.resultat[0].donnees.listeCirculations.circulation[0]
	})
}

function getListPassage(url) {
	return axios.get(url)
	.then(response => { return response.data })
	.then(response => {
		response.listPassage.shift(); // extract first element of the array
		return response.listPassage.map((list, k) => {
			return {
				time : list.time,
				gare : list.gare.name
			}
		})
	});
}

function getResultRER (sid, t, train, stoptimes) {
	let trip_infos;

	return new Promise((resolve, reject) => {

		if (_.isEmpty(stoptimes)) {
			resolve(train);
		} else {
			train.aimedDepartureTime = moment(stoptimes[0].departure_time, "kk:mm:ss"); //kk heure format 01-24 à la plce de HH 00-23
			if (moment(train.aimedDepartureTime).diff(moment(train.expectedDepartureTime), 'd') > 0 || moment(train.expectedDepartureTime) > moment().endOf('day')) { // verifications horaires chevauchement entre deux jours
				train.aimedDepartureTime = moment(stoptimes[0].departure_time, "kk:mm:ss").add(1, 'd');
			}
			gtfs.getTrips({
				agency_key: 'sncf-routes',
				trip_id: stoptimes[0].trip_id
			})
			.then(trip => { trip_infos = trip[0] })
			.then(() => gtfs.getRoutes({
				agency_key: 'sncf-routes',
				route_id: trip_infos.route_id
			}))
			.then(routes => route_infos = routes[0], () => resolve(['error route id']))
			.then(() => {
				train.route.long_name = route_infos.route_long_name;
				train.route.color = "#"+route_infos.route_color;
				//train.route.infos = _.first(route_infos.route_long_name.match(/via .*/gmi));
				resolve(train);
			})
		}
	});
}

function getResultTrain (sid, t, train, service) {
	let trip_infos;

	return new Promise((resolve, reject) => {

		if (_.isEmpty(service)) {
				resolve(train);
		} else {
			gtfs.getTrips({
				agency_key: 'sncf-routes',
				service_id: service.toString(),
				trip_id: {$regex: new RegExp(`DUASN${('0' + train.number).slice(-6)}`)}
			})
			.then(results => paireVSimpaire(results, train, service))
			.then(trip => {trip_infos = trip[0]}, () => resolve(['error trip id']))
			.then(() => gtfs.getStoptimes({
				agency_key: 'sncf-routes',
				trip_id: trip_infos.trip_id,
				stop_id: "StopPoint:DUA"+sid
			}))
			.then(stopTimes => {
				return new Promise((resolve)=>{
					if(_.isEmpty(stopTimes) && sid == "8727605") { // Hack spécifique aux gares ayant deux numéros UIC identiques
						gtfs.getStoptimes({
							agency_key: 'sncf-routes',
							trip_id: trip_infos.trip_id,
							stop_id: "StopPoint:DUA8753413"
						})
						.then(response => {resolve(response)});
					} else if(_.isEmpty(stopTimes)) { // si arrêt pas prévus
						gtfs.getStoptimes({
							agency_key: 'sncf-routes',
							trip_id: trip_infos.trip_id
						})
						.then(response => {resolve({unexpected: 1, response})});
					} else {
						resolve(stopTimes);
					}
				});
			})
			.then(stopTimes => {
				if(!stopTimes.unexpected) {
					train.aimedDepartureTime = moment(stopTimes[0].departure_time, "kk:mm:ss"); //kk heure format 01-24 à la plce de HH 00-23
					if(moment(train.aimedDepartureTime).diff(moment(train.expectedDepartureTime), 'd') > 0 || moment(train.expectedDepartureTime) > moment().endOf('day')){ // verifications horaires chevauchement entre deux jours
						train.aimedDepartureTime = moment(stopTimes[0].departure_time, "kk:mm:ss").add(1, 'd');
					}
				} else train.aimedDepartureTime = train.expectedDepartureTime
				//console.log(train.number, stopTimes[0].trip_id);
			})
			.then(() => gtfs.getRoutes({
				agency_key: 'sncf-routes',
				route_id: trip_infos.route_id
			}))
			.then(routes => route_infos = routes[0], () => resolve(['error route id']))
			.then(() => {
				train.route.long_name = route_infos.route_long_name;
				train.route.color = "#"+route_infos.route_color;
				//train.route.infos = _.first(route_infos.route_long_name.match(/via .*/gmi));
				resolve(train);
			})
		}
	});
}

function paireVSimpaire (results, train, service = null){
	return new Promise((resolve) => {
		if(_.isEmpty(results)){
			gtfs.getTrips(_.pickBy({
				agency_key: 'sncf-routes',
				service_id: service ? service.toString() : null,
				trip_id: {$regex: new RegExp(`DUASN${('0' + (train.number % 2 == 1 ? train.number - 1 : train.number)).slice(-6)}`)}
			}, _.identity))
			.then(response => resolve(response))
		} else {
			resolve(results)
		}
	});
}

function getService(t, sid) {
	let services = [];
	let services_i = [];
	const train = {
		name: t.trainMissionCode,
		number: t.trainNumber,
		terminus: t.gareArrivee.name,
		departure: t.gareDepart.name,
		expectedDepartureTime: moment(t.trainDate + " " + t.trainHour, "DD/MM/YYYY HH:mm"),
		aimedDepartureTime: null,
		state: null,
		nature: null,
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
		SncfMore: t.SncfMore
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

	if(train.SncfMore) {
		switch(train.SncfMore.circulation.natureTrain) {
			case 'L':
				train.nature = "long";
				break;
			case 'C':
				train.nature = "court";
				break;
		};
	}
	
	return new Promise((resolve, reject) => {
		getListPassage("https://transilien.mobi/getDetailForTrain?idTrain="+encodeURI(t.trainNumber)+"&theoric="+encodeURI(t.theorique)+"&origine="+t.gareDepart.codeTR3A+"&destination="+t.gareArrivee.codeTR3A+"&now="+encodeURI(t.trainNumber ? true : false))
		.then(result => {train.journey = result})
		/*.then(() => getColorLigne(t.ligne.idLigne))
		.then(toto => {
			train.route.color = toto.code_hexadecimal;
		})*/
		.then(()=>gtfs.getTrips(_.pickBy({
			agency_key: 'sncf-routes',
			trip_headsign: (isNaN(train.number) || (train.number >= 140000 && train.number <= 149999)) ? train.name : null, //RER
			trip_id: !isNaN(train.number) ? {$regex: new RegExp(`DUASN${('0' + train.number).slice(-6)}`)} : null
		}, _.identity)))
		.then(results => paireVSimpaire(results, train))
		.then(results => {
			services = [];
			_.forEach(results, (v,k) => {
				services.push(v.service_id);
			});
			const opt = {
				agency_key: 'sncf-routes',
				start_date: {$lte: parseInt(moment(train.expectedDepartureTime).format('YYYYMMDD'))},
				end_date: {$gte: parseInt(moment(train.expectedDepartureTime).format('YYYYMMDD'))},
				service_id: {$in: services}
			};
			opt[moment(train.expectedDepartureTime).locale('en').format('dddd').toLowerCase()] = 1;
			return opt;
		})
		.then(opt => gtfs.getCalendars(opt))
		.then(calendars => {
			services_i = [];
			_.forEach(calendars, (v,k) => {
				services_i.push(v.service_id);
			});
		})
		.then(() => gtfs.getCalendarDates({
			agency_key: 'sncf-routes',
			service_id: {$in: services},
			date: parseInt(moment(train.expectedDepartureTime).format('YYYYMMDD'))
		}))
		.then(results => {
			return new Promise((resolve, reject) => {
				_.forEach(results, (v, k) => {
					if (v.exception_type === 1) {
						if (train.number <= 169999) { //pas RER
							services_i = [v.service_id];
							return false;
						} else {
							services_i = _.uniqWith(services_i.concat(v.service_id), _.isEqual);
						}
					} else if (v.exception_type === 2) {
						var index = services_i.indexOf(v.service_id);
						if (index > -1) {
							services_i.splice(index, 1);
						}
					}
				});
				resolve(services_i);
			});
		})
		.then(service => new Promise(resolve => {
			if(!(train.number <= 169999) && isNaN(train.number)){
				gtfs.getRoutes({
					agency_key: 'sncf-routes',
					route_long_name: {$regex: " - " + train.terminus, $options: '-i'},
					route_type: 2
				})
				.then(routes=>{
					let routees = [];
					_.forEach(routes, (v,k) => {
						routees.push(v.route_id);
					});
					return routees;
				})
				.then(routes => gtfs.getStoptimes({
					agency_key: 'sncf-routes',
					stop_id: "StopPoint:DUA"+sid,
					service_id: {$in: service},
					departure_time: {
						$lte: moment(train.expectedDepartureTime).format("HH:mm:ss"),
					},
					route_id: {$in: routes}
				},{},{
					sort: {departure_time: -1}  
				}))
				.then(stoptimes => {
					resolve(getResultRER(sid, t, train, stoptimes))
				})
			} else {
				resolve(getResultTrain(sid, t, train, service))
			}
		}))
		.then(() => resolve(train))
	});
}

module.exports = Trains = {
	get: function (req, res, next) {
		
		const idStation = req.query.code_tr3a;
		let stationName;
		let codeUic;

		const sid = _.result(_.find(gares, function (obj) {
			return obj.code === idStation;
		}), 'uic7');

		// Recupère le resultat de la page html mobi SNCF
		const getPassageAPI = getSncfRealTimeApi(idStation).then(response => {
			const $ = cheerio.load(response.data);
			return $;
		}, () => res.end('error get api'));

		getPassageAPI
		.then($ => { // filtrage des trains autre que rer ou transilien et certains ter (pour paris montparnasse par exemple)
			stationName = $('body').find(".GareDepart > .bluefont").text().trim();
			return _.filter(JSON.parse($('body').find("#infos").val()), function(t) {
				return (t.trainNumber >= 110000 && t.trainNumber <= 169999) || t.trainNumber >= 830000 || (t.trainNumber >= 16750 && t.trainNumber <= 168749) || t.ligne.type == "RER"; 
			});
		})
		// plus d'infos générales avec le site de las sncf -- https://www.sncf.com/fr/gares/
		.then(datu => {
			return new Promise((resolve, reject) => {
				getInfosPointArret(sid)
				.then(data => {
					return codeUic = data.code_uic;
				}).then(uic => getMoreInformations(uic))
				.then(data => {
					return datu.map(obj => {
						return _.assign(obj, {SncfMore : _.find(data.listeHoraires.horaire, {circulation:{numero: obj.trainNumber}}), uic: codeUic});
					})
				})
				.then(lol => resolve(lol))
			})
		})
		.then(data => Promise.all(data.slice(0,7).map(train => getService(train, sid))))
		.then(services => {
			const station_name = stationName;
			const sncf = {
				station: {
					name : station_name,
					uic: codeUic
				},
				trains: services.map((t, k) => {
					// desserte en string
					t.journey_text = t.journey.length == 0 ? (station_name == t.terminus ? "terminus" : "Desserte indisponible") : _.join(_.map(t.journey, (o) => {
						return o.gare /*+ " ("+moment(o.dep_time, 'kk:mm').format('HH[h]mm')+")"*/;
					}), ' • '); //·
					t.journey_text_html = _.join(_.map(t.journey, (o) => {
						return o.gare;
					}), ' <span class="dot-separator">•</span> ');
					
					const late =t.aimedDepartureTime ? moment(t.expectedDepartureTime).diff(moment(t.aimedDepartureTime), "m") : null;
					t.state = (late !== null ? (late !== 0 ? `${(late<0?"":"+") + late} min` : t.state) : null);
					t.aimedDepartureTime = t.aimedDepartureTime ? moment(t.aimedDepartureTime).format('LT'): null;
					t.expectedDepartureTime = moment(t.expectedDepartureTime).format('LT');
					//remove null item
					return _.pickBy(t, _.identity);
				})
			}
			return sncf
		})
		.then(sncf => res.json(sncf))
		.catch(err => {
			res.status(404).end("Il n'y a aucun prochains départs en temps réél pour la gare")
		})
	}
};