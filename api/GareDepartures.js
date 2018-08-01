const Promise = require("bluebird");
const axios = Promise.promisifyAll(require('axios'));
const _ = Promise.promisifyAll(require('lodash'));
const moment = Promise.promisifyAll(require('moment-timezone'));
const storage = Promise.promisifyAll(require('node-persist'));
const cheerio = Promise.promisifyAll(require('cheerio'));
const LiveMap = Promise.promisifyAll(require('./livemap')().livemap);
const fs = Promise.promisifyAll(require('fs'));

const gares = require('./garesNames.json');
const lignes = require('./lignes.json');

moment.tz.setDefault("Europe/Paris");
moment.locale('fr');
storage.init();

require('./const');

const getSNCFRealTimeApi = (codeTR3A) => {
	return axios.get(`https://transilien.mobi/train/result?idOrigin=${codeTR3A}&idDest=`)
	.then(response => {
		const $ = cheerio.load(response.data);
		const originElem = $('body').find("#origine");
		const brutElem = $('body').find("#infos");
		if(originElem.val() && brutElem.val()){
			return {origine: originElem.val(), brut: JSON.parse(brutElem.val())}
		}
		else return {}
	})
	// log ERROR
	.catch(err => logWritter(err));
}
const getSncfRealTimeApi = (uic) => {
	return axios.get(`http://api.transilien.com/gare/${uic}/depart/`, {
		auth: {
			username: SNCFAPI_USERNAME,
			password: SNCFAPI_PWD
		},
		headers: {
			'Accept': 'application/vnd.sncf.transilien.od.depart+xml;vers=1'
		},
		responseType: 'text'
	})
	// log ERROR
	.catch(err => logWritter(err));
}

const getRATPMission = (train) => {
	return axios.get(`https://api-ratp.pierre-grimaud.fr/v3/mission/rers/${train.route.line.code}/${train.name}?_format=json`)
	.then(response => { return response.data })
	// log ERROR
	.catch(err => logWritter(err));
}

const getStationLines = (codeTR3A) => {
	return axios.get(`https://transilien.mobi/gare/detail?id=${codeTR3A}`)
	.then(response => {
		const $ = cheerio.load(response.data);
		return $;
	})
	.then($ => {
		const lines = [];
		$('body').find("img[linename]")
		.each(function (i, elem) {
			lines.push($(this).attr('linename'));
		});
		if($('body').find("img[linename]").length <= 0){
			const uic = _.result(_.find(gares, (obj) => {
				return obj.code === codeTR3A;
			}), 'uic7');
			return _.filter(lignes, {"uic": uic}).map(values => {return values.line})
		} else return lines;
	})
	// log ERROR
	.catch(err => logWritter(err));
}

const getTraficObject = () => {
	return axios.get(`https://www.sncf.com/api/iv/1.0/avance/rechercherPrevisions?format=html`)
	.then(response => { return response.data.reponseRechercherPrevisions.reponse.listeResultats.resultat[0].donnees.listeInformations.information })
	// log ERROR
	.catch(err => logWritter(err));
}

function getColorLigne(q) {
	return axios.get(`https://data.sncf.com/api/records/1.0/search/?dataset=codes-couleur-des-lignes-transilien&q="${q}"&rows=1`)
	.then(result => {
		return !_.isEmpty(result.data.records) ? result.data.records[0].fields : q;
	})
	// log ERROR
	.catch(err => logWritter(err));
}

const getListPassage = (t) => {
	return axios.get("https://transilien.mobi/getDetailForTrain?idTrain="+encodeURI(t.trainNumber)+"&theoric="+encodeURI(t.theorique)+"&origine="+t.gareDepart.codeTR3A+"&destination="+t.gareArrivee.codeTR3A+"&now="+encodeURI(t.trainNumber ? true : false))
	.then(response => { return response.data })
	.then(response => {
		response.listPassage.shift(); // extract first element of the array
		return response.listPassage.map((list, k) => {
			return {
				stop_point : { name : list.gare.name },
				departure_time : list.time
			}
		})
	})
	// log ERROR
	.catch(err => logWritter(err));
}

const getVehiculeJourney = (train, t = null) => {
	console.log(`https://api.sncf.com/v1/coverage/sncf/vehicle_journeys?headsign=${train.number}&since=${moment(train.expectedDepartureTime).format('YYYYMMDD[T000000]')}&until=${moment(train.expectedDepartureTime).format('YYYYMMDD[T235959]')}&disable_geojson=true`)
	return axios.get(`https://api.sncf.com/v1/coverage/sncf/vehicle_journeys?headsign=${train.number}&since=${moment(train.expectedDepartureTime).format('YYYYMMDD[T000000]')}&until=${moment(train.expectedDepartureTime).format('YYYYMMDD[T235959]')}&disable_geojson=true`, {
		headers: {
			'Authorization': SNCFAPI_KEY
		}
	})
	.then(response => { 
		//console.log(`https://api.sncf.com/v1/coverage/sncf/vehicle_journeys?headsign=${train.number}&since=${moment(train.expectedDepartureTime).format('YYYYMMDD[T000000]')}&until=${moment(train.expectedDepartureTime).format('YYYYMMDD[T235959]')}`)		
		return response.data
	})
	.catch(err => {
		logWritter(err)
		return new Promise((resolve) => {
			return getListPassage(t)
			.then(response => resolve(response))
			.catch(err => resolve({}))
		})
	})
}

let departurejourney;
const getVehiculeJourneys = (uic, href) => {
	return new Promise(function(resolve) {
		let linknext;
		return axios.get(href, {
			headers: {
				'Authorization': SNCFAPI_KEY
			}
		})
		.then(response => {
			departurejourney = response.data.vehicle_journeys;
			linknext = _.result(_.find(response.data.links, function(obj) {
				return obj.type === 'next';
			}), 'href');
			return response;
		})
		.then(response => {
			if(linknext) {
				console.log(linknext)
				getVehiculeJourneys(uic, linknext).then(t=>{
					resolve(_.concat(departurejourney, response.data.vehicle_journeys))
				})
			} else {
				resolve(departurejourney);
			}
		})
		.catch(err => logWritter(err))
	});
}

const getTheoriqueDepartures = (uic) => {
	return new Promise(resolve => {
		
		storage.getItem(uic+"_departures").then(item => {
			if(item) {
				resolve(item)
			} else {
				return getVehiculeJourneys(uic, `https://api.sncf.com/v1/coverage/sncf/stop_areas/stop_area:OCE:SA:${uic}/vehicle_journeys?count=1000&since=${moment().format('YYYYMMDD[T000000]')}&until=${moment().format('YYYYMMDD[T235959]')}&disable_geojson=true&`)
				.then(departures=>{
					storage.setItem(uic+"_departures", departures, {ttl: moment().hour(0).minute(0).second(0).add(1,'d').diff(moment(), 'milliseconds') }).then(()=> {resolve(departures)}).catch(err => resolve({}));
				})
			}
		})
	})
}

const getRoute = (train, t = null) => {
	return axios.get(`https://api.sncf.com/v1/coverage/sncf/routes?headsign=${train.number}&disable_geojson=true`, {
		headers: {
			'Authorization': SNCFAPI_KEY
		}
	})
	.then(response => {
		return response.data
	})
	.catch(err =>{
		return new Promise(resolve => {
			train.route.line.code = train.route.type !== "ter" ? t.ligne.idLigne : null;
			if(train.route.line.code) {
				return getColorLigne(t.ligne.idLigne)
				.then(toto => {
					train.route.line.color = toto.code_hexadecimal.slice(1);
					resolve(train.route.line)
				})
				.catch(err => resolve({}));
			} else {
				resolve(train.route.line)
			}
		});
	});
}

const getUIC = (tr3a) => {
	const uic7 = _.result(_.find(gares, (obj) => {
		return obj.code === tr3a;
	}), 'uic7');
	return getInfosPointArret(uic7).then(data => {return data});
}

const getInfosPointArret = (uic7) => {
	return axios.get(`https://data.sncf.com/api/records/1.0/search/?dataset=sncf-gares-et-arrets-transilien-ile-de-france&q=${uic7}&rows=1`)
	.then(response => {
		return !_.isEmpty(response.data.records) ? response.data.records[0].fields : uic7;
	})
}

const getMoreInformations = (uic) => {
	return axios.get(`https://www.sncf.com/api/iv/1.0/infoVoy/rechercherProchainsDeparts?codeZoneArret=OCE${uic}&indicateurReponseGaresSecondaires=true&format=html`)
	.then(result => {
		let lastRes  = _.last(result.data.reponseRechercherProchainsDeparts.reponse.listeResultats.resultat).donnees;
		if(lastRes.listeHoraires)
			return lastRes;
		else
			return result.data.reponseRechercherProchainsDeparts.reponse.listeResultats.resultat[0].donnees;
	})
	// log ERROR
	.catch(err => logWritter(err));
}

const logWritter = (err) => {
	let text;
	if(err.response) {
		text = moment().format()
		+'\n-----------------\n'
		+'status : '+JSON.stringify(err.response.status)+' => '+JSON.stringify(err.response.statusText)+'\n'
		+'config : '+JSON.stringify(err.response.config)+'\n'
		+'data   : '+JSON.stringify(err.response.data)
		+'\n-----------------\n'
		+'••••••••••••••••••••••••••••••••••••\n'
	} else {
		text = moment().format()
		+'\n-----------------\n'
		+'error  : '+err
		+'\n-----------------\n'
		+'••••••••••••••••••••••••••••••••••••\n'
	}
	fs.appendFile('log.txt',text,()=>{return {}});
}

const getService = (t, uic, more = null, livemap = [], vehiculeJourneys = []) => {
	const SncfMore = more ? _.find(more.listeHoraires.horaire, {circulation:{numero: t.trainNumber}}) : false;
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
		distance: livemap.find(obj => {return obj.savedNumber == t.trainNumber}),
		route: {
			name: null,
			line: {
				code: null,
				color: null,
				type: null,
				name: null
			}
		},
		journey: null,
		journey_redux: null,
		journey_text: null,
		journey_text_html: null
	}
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
		case null:
			train.state = null;
			break;
		default:
			train.state = "à l'heure";
			break;
	};
	if(SncfMore) {
		switch(SncfMore.circulation.natureTrain) {
			case 'L':
				train.nature = "long";
				break;
			case 'C':
				train.nature = "court";
				break;
		};
		if(t.ligne.type == "RER") train.route.line.type = 'rer';
		else {
			switch(SncfMore.circulation.mode.typeCode) {
				case 'TRAIN_TER':
					train.route.line.type = 'ter';
					break;
				case 'TRANSILIEN':
					train.route.line.type = 'transilien';
					break;
				case 'INTERCITES':
					train.route.line.type = 'intercites';
					break;
				default:
					train.route.line.type = "";
					break;
			};
		}
	} else {
		train.route.line.type = (t.ligne.type == "RER") ? "rer" : 
								((t.trainNumber >= 110000 && t.trainNumber <= 169999 && t.ligne.type == "TRAIN") ? "transilien" : 
								(((t.trainNumber >= 830000 || (t.trainNumber >= 16750 && t.trainNumber <= 168749)) && t.ligne.type == "TRAIN") ? "ter" : "TRAIN"))
	}
	//return new Promise((resolve, reject) => {
		console.log(_.find(vehiculeJourneys, function(obj) {
			return obj.stop_times[0].headsign === train.number;
		}));
		return Promise.all([getVehiculeJourney(train, t), getRoute(train, t)])
		.then(result => {
			let late = 0;
			//si get vehicule journey
			if(!_.isEmpty(result[0])){
				if(result[0].vehicle_journeys){
					train.journey = result[0].vehicle_journeys[0].stop_times;
					let ok = false;
					train.journey_redux = _.compact(_.map(train.journey, (o) => { // recevoir seulement la suite
						if (ok) {
							return o;
						}
						const ouic = o.stop_point.id.split("-").pop();
						const start = (ouic == uic || (ouic == '87391102' && uic == '87391003'));
						if(start) {
							// verifications horaires chevauchement entre deux jours
							if (moment(o.departure_time, 'HHmmss').diff(moment(train.expectedDepartureTime), 'd') > 0 || moment(train.expectedDepartureTime) > moment().endOf('day')) {
								train.aimedDepartureTime = moment(o.departure_time, 'HHmmss').add(1, 'd');
							} else {
								train.aimedDepartureTime = moment(o.departure_time, 'HHmmss');
							}
							// les minutes de retards ☢⚠ très important ⚠☢
							late = moment(train.expectedDepartureTime).diff(moment(train.aimedDepartureTime), "m");
							train.state = (late !== null ? (late !== 0 ? `${(late<0?"":"+") + late} min` : train.state) : null);
							train.aimedDepartureTime = moment(train.aimedDepartureTime).format('LT');
						}
						ok = start;
					}));
				} else {
					train.journey_redux = result[0]
				}
				
				train.journey_text = train.journey_redux.length == 0 ? (train.departure == train.terminus ? "terminus" : "Desserte indisponible") : _.join(_.map(train.journey_redux, (o) => {
					return o.stop_point.name + (o.departure_time != "*" ? " (" +moment(o.departure_time, 'HHmmss').add(late, 'm').format('HH[h]mm') + ")" : '');
				}), ' • ');
				train.journey_text_html = _.join(_.map(train.journey_redux, (o) => {
					return o.stop_point.name + (o.departure_time != "*" ? "<small> "+moment(o.departure_time, 'HHmmss').add(late, 'm').format('HH[:]mm')+"</small>" : '');
				}), ' <span class="dot-separator">•</span> ');
			}
			// si get route
			if(!_.isEmpty(result[1])){
				if(result[1].routes) {
					const troute = result[1].routes[0];
					train.route.name = troute.name;
					train.route.line.color = troute.line.color;
					train.route.line.code = troute.line.code ? troute.line.code : (SncfMore && SncfMore.circulation.ligne ? SncfMore.circulation.ligne.libelleNumero: '');
					train.route.line.name = troute.line.name;
				}
				else {
					train.route.line = result[1];
				}
			}
			train.expectedDepartureTime = moment(train.expectedDepartureTime).format('LT');
	
			train.route.line = _.pickBy(train.route.line, _.identity);
			train.route = _.pickBy(train.route, _.identity);
			return _.pickBy(train, _.identity)
		})
		.then(data => {return data})
		.catch(err => {return {}})
	//})
}

module.exports = Departures = {
	get : (req, res, next) => {
		const tr3a = req.query.tr3a;
		const uic = req.query.uic;
		const gps = {
			lat: req.query.lat,
			long: req.query.long
		}
		let liveMap, moreInfos, trainsJsonBrut;
		
		Promise.all([LiveMap(gps).catch(err => logWritter(err)), getMoreInformations(uic), getSNCFRealTimeApi(tr3a), getTheoriqueDepartures(uic)])
		.then(values => {
			liveMap = values[0];
			moreInfos = values[1]; 
			trainsJsonBrut = values[2];
			trainsDepartures = values[3];
			
			return new Promise(resolve => {
				if(!_.isEmpty(trainsJsonBrut) && !_.isEmpty(moreInfos)){
						Promise.all(trainsJsonBrut.brut.slice(0,6).map(train => getService(train, uic, moreInfos, liveMap, trainsDepartures)))
						.then(sncf => {
							storage.setItem(uic, sncf).then(()=> {resolve(sncf)})
						})
				} else {
					resolve(storage.getItem(uic));
				}
			})
		})
		.then(sncf => res.json(sncf))
		// log ERROR
		.catch(err => logWritter(err))
	},

	getStation: (req, res, next) => {
		const tr3a = req.params.tr3a;
		Promise.all([getUIC(tr3a), getStationLines(tr3a)])
		.then(data => {
			const d = data[0];
			const lines = data[1];
			return {
				name : d.nom_gare,
				uic : d.code_uic,
				tr3a : tr3a,
				lines: lines,
				gps : {lat: d.coord_gps_wgs84[0], long: d.coord_gps_wgs84[1]}
			}
		})
		.then(json => res.json(json))
		.catch(err => {
			res.status(404).end("Gare non trouve")
		})
	},

	getTrafic: (req, res, next) => {
		const objTrafic = getTraficObject();
		const type = req.query.type;
		if(req.params.line) {
			const line = req.params.line;
			objTrafic
			.then(response => {
				return response.filter(obj => {
					if(obj.ligne) {
						const now = moment().format('YYYY-MM-DDTHH:mm:ss');
						const debut = moment.utc(obj.dateHeureDebut).format('YYYY-MM-DDTHH:mm:ss');
						const fin = moment.utc(obj.dateHeureFin).format('YYYY-MM-DDTHH:mm:ss');
						if(type) {
							return obj.ligne.libelleNumero == line && fin >= now && debut <= now && obj.typeMessage == type
						} else {
							return obj.ligne.libelleNumero == line && fin >= now && debut <= now
						}
					}
					else return false
				})
			})
			.then(json => res.json(json))
			.catch(err => res.json({}))
		}
		else if(req.body.lines){
			const lines = req.body.lines;
			objTrafic
			.then(response => {
				return response.filter(obj => {
					if(obj.ligne) {
						const now = moment().format('YYYY-MM-DDTHH:mm:ss');
						const debut = moment.utc(obj.dateHeureDebut).format('YYYY-MM-DDTHH:mm:ss');
						const fin = moment.utc(obj.dateHeureFin).format('YYYY-MM-DDTHH:mm:ss');
						if(type) {
							return _.includes(lines, obj.ligne.libelleNumero) && fin >= now && debut <= now && obj.typeMessage == type
						} else {
							return _.includes(lines, obj.ligne.libelleNumero) && fin >= now && debut <= now
						}
					}
					else return false
				})
			})
			.then(json => res.json(json))
			.catch(err => res.json({}))
		}
		else {
			objTrafic
			.then(response => {
				return response.filter(obj => {
					if(obj.ligne) {
						const now = moment().format('YYYY-MM-DDTHH:mm:ss');
						const debut = moment.utc(obj.dateHeureDebut).format('YYYY-MM-DDTHH:mm:ss');
						const fin = moment.utc(obj.dateHeureFin).format('YYYY-MM-DDTHH:mm:ss');
						if(type) {
							return fin >= now && debut <= now && obj.typeMessage == type
						} else {
							return fin >= now && debut <= now
						}
					}
					else return false
				})
			})
			.then(json => res.json(json))
			.catch(err => res.json({}))
		}
	}
}