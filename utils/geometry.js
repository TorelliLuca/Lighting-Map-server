// utils/geometry.js

/**
 * Calcola il centroide (approssimativo) di un poligono.
 * Utilizza la media delle coordinate dei vertici.
 * @param {Array<Array<number[]>>} coordinates - Le coordinate del poligono.
 * @returns {{lat: number, lng: number}} - Latitudine e longitudine del centroide.
 */
function getPolygonCentroid(coordinates) {
  let latSum = 0;
  let lngSum = 0;
  let count = 0;

  // I GeoJSON Polygon hanno un array di anelli, il primo è l'esterno
  const outerRing = coordinates[0];

  for (const point of outerRing) {
    lngSum += point[0];
    latSum += point[1];
    count++;
  }

  // Calcolo la media
  const avgLng = lngSum / count;
  const avgLat = latSum / count;

  return { lat: avgLat, lng: avgLng };
}

module.exports = { getPolygonCentroid };