const gtfs = require('gtfs');
const mongoose = require('mongoose');
const _ = require('lodash');
const axios = require('axios');
const parseString = require('xml2js').parseString;
const moment = require('moment-timezone');

moment.tz.setDefault("Europe/Paris");
moment.locale('fr');

const gares = require('./gares.json');
const lignes = require('./lignes.json');
require('./const');
mongoose.connect(`mongodb://${MONGO_USERNAME}:${MONGO_PWD}@${MONGO_IP}/gtfs?authSource=admin`);

function getSncfRealTimeApi(uic) {
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
}

function getColorLigne(q) {
	return axios.get(`https://data.sncf.com/api/records/1.0/search/?dataset=codes-couleur-des-lignes-transilien&q="${q}"&rows=1`)
	.then(result => {
		return !_.isEmpty(result.data.records) ? result.data.records[0].fields : q;
	});
}

function getResultRER(sid, t, train, tripId) {
	let dessertes = [];
	let trip_infos;
	let route_infos;
	let line_infos;

	return new Promise((resolve, reject) => {
		const line = _.result(_.find(lignes, function(obj) {
			return obj.uic === parseInt(t.term.toString().slice(0, -1));
		}), 'line');

		gtfs.getTrips({
			agency_key: 'sncf-routes',
			trip_id: tripId
		})
		.then(trip => {trip_infos = trip[0]})
		.then(() => gtfs.getStoptimes({
			agency_key: 'sncf-routes',
			trip_id: tripId
		}))
		.then(stopTimes => {
			dessertes = [];
			_.forEach(stopTimes, (v, k) => {
				const gareName = _.result(_.find(gares, function(obj) {
					return obj.uic7 === parseInt(v.stop_id.replace("StopPoint:DUA",""));
				}), 'nom_gare_sncf');
				dessertes.push({uic7: parseInt(v.stop_id.replace("StopPoint:DUA","")), name: gareName, dep_time: moment(v.departure_time, "kk:mm:ss").format('LT')});
			});
		})
		.then(() => gtfs.getRoutes({
			agency_key: 'sncf-routes',
			route_id: trip_infos.route_id
		}))
		.then(routes => route_infos = routes[0], () => resolve(['error route id']))
		//.then(() => getColorLigne(route_infos.route_short_name))		//Get ligne color via url API https://data.sncf.com/api/records/1.0/search/?dataset=codes-couleur-des-lignes-transilien
		//.then(toto => line_infos = toto )
		.then(() => {
			if(_.isEmpty(dessertes))
				resolve(['error get desserte'])
			else {
				train.journey = dessertes;
				train.route = {
					id: route_infos.route_id,
					line: route_infos.route_short_name,
					long_name: route_infos.route_long_name,
					color: "#"+route_infos.route_color
				};
				//train.line = line_infos;
				resolve(train);
			}
		})
	});
}

function getResultTrain(sid, t, train, service) {
	let dessertes = [];
	let trip_infos;
	let route_infos;
	let line_infos;

	return new Promise((resolve, reject) => {

		if (_.isEmpty(service)) {

			const line = _.result(_.find(lignes, function(obj) {
				return obj.uic === parseInt(t.term.toString().slice(0, -1));
			}), 'line');

			//getColorLigne(line)
			//.then(toto => {
				train.journey = 'no service for : '+ train.number;
				train.route = {line: line};
				//train.line = toto;
				resolve(train);
			//})

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
					} else {
						resolve(stopTimes);
					}
				});
			})
			.then(stopTimes => {
				train.aimedDepartureTime = moment(stopTimes[0].departure_time, "kk:mm:ss"); //kk heure format 01-24 à la plce de HH 00-23
				if(moment(train.aimedDepartureTime).diff(moment(train.expectedDepartureTime), 'd') > 0){ // verifications horaires chevauchement entre deux jours
					train.aimedDepartureTime = moment(stopTimes[0].departure_time, "kk:mm:ss").add(1, 'd');
				}
			})
			.then(() => gtfs.getStoptimes({
				agency_key: 'sncf-routes',
				trip_id: trip_infos.trip_id
			}))
			.then(stopTimes => {
				dessertes = [];
				_.forEach(stopTimes, (v, k) => {
					const gareName = _.result(_.find(gares, function(obj) {
						return obj.uic7 === parseInt(v.stop_id.replace("StopPoint:DUA",""));
					}), 'nom_gare_sncf');
					dessertes.push({uic7: parseInt(v.stop_id.replace("StopPoint:DUA","")), name: gareName, dep_time: moment(v.departure_time, "kk:mm:ss").format('LT')});
				});
			}, () => resolve(trip_infos))
			.then(() => gtfs.getRoutes({
				agency_key: 'sncf-routes',
				route_id: trip_infos.route_id
			}))
			.then(routes => route_infos = routes[0], () => resolve(['error route id']))
			//.then(() => getColorLigne(route_infos.route_short_name))		//Get ligne color via url API https://data.sncf.com/api/records/1.0/search/?dataset=codes-couleur-des-lignes-transilien
			//.then(toto => line_infos = toto )
			.then(() => {
				if(_.isEmpty(dessertes))
					resolve(['error get desserte'])
				else {
					train.journey = dessertes;
					train.route = {
						id: route_infos.route_id,
						line: route_infos.route_short_name,
						long_name: route_infos.route_long_name,
						color: "#"+route_infos.route_color
					};
					//train.line = line_infos;
					resolve(train);
				}
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
	const train = {
		name: t.miss.toString(),
		number: t.num.toString(),
		terminus: _.result(_.find(gares, function (obj) {
			return obj.uic7 === parseInt(t.term.toString().slice(0, -1));
		}), 'nom_gare_sncf'),
		expectedDepartureTime: moment(t.date[0]._, "DD/MM/YYYY HH:mm"),
		state: (t.etat) ? t.etat.toString() : null
	};
	
	return new Promise((resolve, reject) => {
		let services = [];
		let services_i = [];

		gtfs.getTrips(_.pickBy({
			agency_key: 'sncf-routes',
			trip_headsign: isNaN(train.number) ? train.name : null,
			trip_id: !isNaN(train.number) ? {$regex: new RegExp(`DUASN${('0' + train.number).slice(-6)}`)} : null
		}, _.identity))
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
			//if(_.isEmpty(calendars) && !_.isEmpty(services))
			//	services_i = _.uniqWith(services, _.isEqual);
			//else {
				services_i = [];
				_.forEach(calendars, (v,k) => {
					services_i.push(v.service_id);
				});
			//}
		})
		.then(() => gtfs.getCalendarDates({
			agency_key: 'sncf-routes',
			service_id: {$in: services},
			date: parseInt(moment(train.expectedDepartureTime).format('YYYYMMDD'))
		}))
		.then(results => {
			_.forEach(results, (v,k) => {
				if (v.exception_type === 1) {
					if (!isNaN(train.number)) {
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
			return services_i;
		})
		.then(service => new Promise(resolve => {
				if(isNaN(train.number)){
					gtfs.getStoptimes({
						agency_key: 'sncf-routes',
						stop_id: "StopPoint:DUA"+sid,
						service_id: {$in: service},
						departure_time: {
							$lte: moment(train.expectedDepartureTime).format("HH:mm:ss"),
							$gte: moment(train.expectedDepartureTime).subtract(5, 'm').format("HH:mm:ss")
						}
					})
					.then(stoptimes => {
						if(!_.isEmpty(stoptimes)){
							train.aimedDepartureTime = moment(stoptimes[0].departure_time, "kk:mm:ss"); //kk heure format 01-24 à la plce de HH 00-23
							if(moment(train.aimedDepartureTime).diff(moment(train.expectedDepartureTime), 'd') > 0){ // verifications horaires chevauchement entre deux jours
								train.aimedDepartureTime = moment(stoptimes[0].departure_time, "kk:mm:ss").add(1, 'd');
							}
							console.log(train.number, stoptimes[0].trip_id);
							resolve(getResultRER(sid, t, train, stoptimes[0].trip_id))
						}
					})
				} else {
					console.log(train.number, service)
					resolve(getResultTrain(sid, t, train, service))
				}
			})
		)
		.then(resp => resolve(resp))
	});
};

module.exports = Trains = {
	get: function (req, res, next) {
		
		let sncfPassages;
		const idStation = req.query.code_uic;

		// Recupère le resultat de l'API SNCF temps Réel
		const getPassageAPI = getSncfRealTimeApi(idStation).then(response => {
			parseString(response.data, function (err, result) {
				sncfPassages = result.passages;
			});
			return sncfPassages;
		}, () => res.end('error get api'));

		// test multiple promise result
		getPassageAPI
		.then(() => Promise.all(sncfPassages.train.slice(0,4).map(train => getService(train, parseInt(sncfPassages.$.gare.slice(0, -1))))))
		.then(services => {
			const station_name = _.result(_.find(gares, function (obj) {
				return obj.uic7 === parseInt(sncfPassages.$.gare.slice(0, -1));
			}), 'nom_gare_sncf');
			const sncf = {
				station: station_name,
				trains: services.map((t, k) => {
					if(_.isArray(t.journey)){ // si il y a un service
						const late = moment(t.expectedDepartureTime).diff(moment(t.aimedDepartureTime), "m");
						let ok = false;
						t.late = (late !== 0 ? `${(late<0?"":"+") + late} min` : "à l'heure" );
						t.journey = _.compact(_.map(t.journey, (o) => {		// recevoir seulement la suite
							if (ok) {
								if (o.name == t.terminus) {
									ok = false;
								}
								return o;
							}
							ok = (o.uic7 == sncfPassages.$.gare.slice(0, -1) || (sncfPassages.$.gare.slice(0, -1) == "8727605" && o.uic7 == "8753413"));
						}));
						t.journey_text = _.join(_.map(t.journey, (o) => {
							return o.name;
						}), ' • ');
						t.text_monitor = `Le train ${t.name} n°${t.number} prévu à ${moment(t.expectedDepartureTime).format("HH[h]mm")} et à destination de ${t.terminus} ${t.state ? `est ${t.state.toLowerCase()}` : `partira de la gare de ${station_name} ${moment(t.aimedDepartureTime).fromNow()}`}`;
						t.aimedDepartureTime = moment(t.aimedDepartureTime).format('LT');
					} else {
						t.text_monitor = `Le train ${t.name} n°${t.number} prévu à ${moment(t.expectedDepartureTime).format("HH[h]mm")} et à destination de ${t.terminus} ${t.state ? `est ${t.state.toLowerCase()}` : `partira de la gare de ${station_name} ${moment(t.expectedDepartureTime).fromNow()}`}`;
					}
					t.expectedDepartureTime = moment(t.expectedDepartureTime).format('LT');
					//remove null item
					return _.pickBy(t, _.identity);
				})
			};
			
			return sncf;
		})
		.then(sncf => res.json(sncf))
		.catch(err => {
			res.end()
		})
	}
};