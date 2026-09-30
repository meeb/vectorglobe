/**
 * Sample data for the demo: a handful of large airports and the routes between them.
 *
 * Coordinates are the published positions of each airport, rounded to four decimal places.
 */

window.DEMO_AIRPORTS = [
  { id: 'LHR', lat: 51.47, lon: -0.4543, label: 'LHR', title: 'London Heathrow' },
  { id: 'JFK', lat: 40.6413, lon: -73.7781, label: 'JFK', title: 'New York Kennedy' },
  { id: 'LAX', lat: 33.9416, lon: -118.4085, label: 'LAX', title: 'Los Angeles' },
  { id: 'NRT', lat: 35.772, lon: 140.3929, label: 'NRT', title: 'Tokyo Narita' },
  { id: 'SIN', lat: 1.3644, lon: 103.9915, label: 'SIN', title: 'Singapore Changi' },
  { id: 'DXB', lat: 25.2532, lon: 55.3657, label: 'DXB', title: 'Dubai International' },
  { id: 'SYD', lat: -33.9399, lon: 151.1753, label: 'SYD', title: 'Sydney Kingsford Smith' },
  { id: 'GRU', lat: -23.4356, lon: -46.4731, label: 'GRU', title: 'Sao Paulo Guarulhos' },
  { id: 'JNB', lat: -26.1367, lon: 28.2411, label: 'JNB', title: 'Johannesburg Tambo' },
  { id: 'FRA', lat: 50.0379, lon: 8.5622, label: 'FRA', title: 'Frankfurt am Main' },
  { id: 'HKG', lat: 22.308, lon: 113.9185, label: 'HKG', title: 'Hong Kong International' },
  { id: 'YYZ', lat: 43.6777, lon: -79.6248, label: 'YYZ', title: 'Toronto Pearson' },
  { id: 'KEF', lat: 63.985, lon: -22.6056, label: 'KEF', title: 'Reykjavik Keflavik' },
  { id: 'SCL', lat: -33.393, lon: -70.7858, label: 'SCL', title: 'Santiago Merino Benitez' },
];

/** Generated arcs: the map works the great circle out from the two point ids. */
window.DEMO_ROUTES = [
  { id: 'LHR-JFK', from: 'LHR', to: 'JFK' },
  { id: 'JFK-LAX', from: 'JFK', to: 'LAX' },
  { id: 'LAX-NRT', from: 'LAX', to: 'NRT' },
  { id: 'NRT-SIN', from: 'NRT', to: 'SIN' },
  { id: 'SIN-DXB', from: 'SIN', to: 'DXB' },
  { id: 'DXB-LHR', from: 'DXB', to: 'LHR' },
  { id: 'SIN-SYD', from: 'SIN', to: 'SYD' },
  { id: 'GRU-JNB', from: 'GRU', to: 'JNB', color: '#ff7ab6' },
  { id: 'FRA-HKG', from: 'FRA', to: 'HKG' },
  { id: 'YYZ-KEF', from: 'YYZ', to: 'KEF' },
  { id: 'GRU-SCL', from: 'GRU', to: 'SCL', color: '#ff7ab6' },
];

/**
 * An explicitly routed path: longitude, latitude and altitude in kilometres.
 *
 * This is the shape a recorded flight track takes, climbing out of Heathrow, cruising north of the
 * great circle and descending into Singapore.
 */
window.DEMO_TRACK = {
  id: 'LHR-SIN-track',
  color: '#8bf7a0',
  width: 2,
  path: [
    [-0.4543, 51.47, 0],
    [4.2, 50.6, 9.5],
    [16.8, 48.1, 11.2],
    [35.4, 42.9, 11.6],
    [55.3, 35.2, 11.6],
    [72.1, 25.4, 11.6],
    [88.6, 17.2, 11.2],
    [98.4, 8.9, 9.5],
    [103.9915, 1.3644, 0],
  ],
};
