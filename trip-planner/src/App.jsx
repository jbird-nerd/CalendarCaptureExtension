import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';
import pointsOfInterest from './points_of_interest_geocoded.json';
import Itinerary from './Itinerary';
import Agenda from './Agenda';
import OpenRouteService from 'openrouteservice-js';

// Leaflet's default icon breaks when used with bundlers like Vite
// This is a workaround to fix it
import L from 'leaflet';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

// Extract unique categories from the data
const categories = [...new Set(pointsOfInterest.map(poi => poi.category))];
const ors = new OpenRouteService({
  api_key: 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjQzNzdiZTI4NThhNTRiMDI5MDc1MTZiMjc1Mzg4OTdjIiwiaCI6Im11cm11cjY0In0=',
});


function App() {
  const position = [40, -95]; // Default center of the map
  const [itinerary, setItinerary] = useState([]);
  const [route, setRoute] = useState(null);

  // State to manage which categories are visible
  const [visibleCategories, setVisibleCategories] = useState(
    categories.reduce((acc, category) => {
      acc[category] = true;
      return acc;
    }, {})
  );

  useEffect(() => {
    if (itinerary.length > 1) {
      const fetchRoute = async () => {
        try {
          const coordinates = itinerary.map(p => [p.lon, p.lat]);
          const response = await ors.directions({
            coordinates: coordinates,
            profile: 'driving-car',
            format: 'geojson'
          });
          setRoute(response);
        } catch (error) {
          console.error('Error fetching route:', error);
        }
      };
      fetchRoute();
    } else {
      setRoute(null);
    }
  }, [itinerary]);


  const handleFilterChange = (category) => {
    setVisibleCategories(prevState => ({
      ...prevState,
      [category]: !prevState[category],
    }));
  };

  const addToItinerary = (poi) => {
    if (!itinerary.some(item => item.name === poi.name)) {
      setItinerary([...itinerary, poi]);
    }
  };

  const removeFromItinerary = (poiToRemove) => {
    setItinerary(itinerary.filter(item => item.name !== poiToRemove.name));
  };

  const loadItinerary = (newItinerary) => {
    setItinerary(newItinerary);
  };


  // Filter points of interest based on the visible categories
  const filteredPois = pointsOfInterest.filter(poi => visibleCategories[poi.category]);

  return (
    <div style={{ display: 'flex' }}>
      <Itinerary items={itinerary} onRemove={removeFromItinerary} onLoad={loadItinerary} />
      <Agenda route={route ? { summary: route.features[0].properties.summary, segments: route.features[0].properties.segments } : null} />
      <div style={{ flex: 1 }}>
        <div className="filter-controls">
          <h3>Filter by Category</h3>
          {categories.map(category => (
            <div key={category}>
              <input
                type="checkbox"
                id={category}
                checked={visibleCategories[category]}
                onChange={() => handleFilterChange(category)}
              />
              <label htmlFor={category}>{category}</label>
            </div>
          ))}
        </div>
        <MapContainer center={position} zoom={4} style={{ height: '100vh', width: '100%' }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          {filteredPois.map((poi) => (
            <Marker key={poi.name} position={[poi.lat, poi.lon]}>
              <Popup>
                <b>{poi.name}</b><br />
                {poi.city}, {poi.state}<br />
                <em>{poi.category}</em><br />
                {poi.description}<br />
                <button onClick={() => addToItinerary(poi)}>Add to Itinerary</button>
              </Popup>
            </Marker>
          ))}
          {route && (
            <Polyline
              positions={route.features[0].geometry.coordinates.map(c => [c[1], c[0]])}
              color="blue"
            />
          )}
        </MapContainer>
      </div>
    </div>
  );
}

export default App;
