const axios = require('axios');
const moment = require('moment-timezone');

moment.tz.setDefault("Europe/Paris");
moment.locale('fr');

const maxDistanceInRealTimeMap = 500000

const haversine = (coords1, coords2) => {
	const degreesToRadian = Math.PI / 180;
	const latDelta = (coords2.lat - coords1.lat) * degreesToRadian
	const longDelta = (coords2.long - coords1.long) * degreesToRadian
	const a = Math.sin(latDelta/2) * Math.sin(latDelta/2) +
		Math.cos(coords1.lat * degreesToRadian) * Math.cos(coords2.lat * degreesToRadian) *
		Math.sin(longDelta/2) * Math.sin(longDelta/2)
	return 12742 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const read = (jnyL, prodL, remL, locL, {lat, long}) => jnyL
	.map(train => {return {...train, ...prodL[train.prodX], remarks:[...new Set(train.remL)].map(rem => {return {...rem, ...remL[rem.remX]}}),
		lines:train.ani && [...new Set(train.ani.fLocX)].map(loc => locL[loc])}})
	.map(train => {return {...train, names:train.remarks.filter(r => r.code = 'FD').map(r => r.txtN)}})
	.map(train => {return {...train, number:(train.names.map(name => name.match(/\s*[0-9]+$/) && parseInt(name.match(/\s*([0-9]+)$/)[1])) || [])[0]}})
	.map(train => {return {...train, distance:haversine({lat, long}, {lat:train.pos.y / 1E6, long:train.pos.x / 1E6})}})

const realTimeTrains = ({lat, long}) => axios.get(`http://sncf-maps.hafas.de/carto/livemaps?service=journeygeopos&rect=${Math.floor(long * 1E6) - maxDistanceInRealTimeMap},${Math.floor(lat * 1E6) - maxDistanceInRealTimeMap},${Math.floor(long * 1E6) + maxDistanceInRealTimeMap},${Math.floor(lat * 1E6) + maxDistanceInRealTimeMap}&i=35000&is=10000&prod=27&date=${moment().format('YYYYMMDD')}&time=${moment().format('HHmm00')}&tpm=REPORT_ONLY&its=CT|INTERNATIONAL,CT|TGV,CT|INTERCITE,CT|TER,CT|TRANSILIEN&un=true&livemapCallback=`, {headers:{Referer:'http://www.sncf.com/fr/geolocalisation'}})
	.then(({data:{svcResL:[{res:{common:{prodL,remL,locL},jnyL}}]}}) => read(jnyL, prodL, remL, locL, {lat, long}))

const realTimeRER = ({lat, long}) => axios.get(`http://sncf-maps.hafas.de/carto/livemaps?service=journeygeopos&rect=${Math.floor(long * 1E6) - maxDistanceInRealTimeMap},${Math.floor(lat * 1E6) - maxDistanceInRealTimeMap},${Math.floor(long * 1E6) + maxDistanceInRealTimeMap},${Math.floor(lat * 1E6) + maxDistanceInRealTimeMap}&i=35000&is=10000&prod=27&date=${moment().format('YYYYMMDD')}&time=${moment().format('HHmm00')}&livemapCallback=`, {headers:{Referer:'http://www.sncf.com/fr/geolocalisation'}})
	.then(({data:{svcResL:[{res:{common:{prodL,remL,locL},jnyL}}]}}) => read(jnyL, prodL, remL, locL, {lat, long}))

const realTimeMap = (stationCoords) => Promise.all([realTimeTrains(stationCoords), realTimeRER(stationCoords)])
	.then(([trains, rer]) => trains.concat(rer))
	.then(trains => trains.map(train => {
		return {
			//train: train,
			savedNumber: train.number,
			gps: {lat : train.pos.y/1000000, long: train.pos.x/1000000},
			lPosReport: moment(train.lPosReport, 'HHmmss').format('HH:mm:ss'),
			linkMap: `https://www.sncf.com/sncv1/fr/geolocalisation?data-map-livemap-infotexts=RT|${train.number}`,
			dataToDisplay: {
				distance: /*train.names.includes('OnPlatform') &&*/ train.distance <= 0.4 ? 'à quai' :
					train ? `< ${Math.ceil(train.distance)} km` : 'retardé'
			}
		}
	}))

/*module.exports = Trains = {
	get: function (req, res, next) {
		const mapdata = realTimeMap({lat: req.query.lat, long: req.query.long})
		if(req.params.filter) {
			mapdata.then(res=> { return res.filter(obj => {return obj.savedNumber == req.params.filter})[0]})
			.then(data => res.json(data))
		} else {
			mapdata.then(data => res.json(data))
		}
		
	},
	livemap: function(gps) {
		return realTimeMap({lat: gps.lat, long: gps.long})
	}
}*/

module.exports = function() {
	function get(req, res, next) {
		const mapdata = realTimeMap({lat: req.query.lat, long: req.query.long})
		if(req.params.filter) {
			mapdata.then(res=> { return res.filter(obj => {return obj.savedNumber == req.params.filter})[0]})
			.then(data => res.json(data))
		} else {
			mapdata.then(data => res.json(data))
		}
	}

	function livemap(gps) {
		return realTimeMap({lat: gps.lat, long: gps.long})
	}

	return {
        get: get,
        livemap: livemap
    };
}