import React from 'react';

function Itinerary({ items, onRemove, onLoad }) {
  const handleSave = () => {
    const csvContent = "data:text/csv;charset=utf-8,"
      + "Name,Category,City,State,Description,Latitude,Longitude\n"
      + items.map(e => `"${e.name}","${e.category}","${e.city}","${e.state}","${e.description}",${e.lat},${e.lon}`).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "itinerary.csv");
    document.body.appendChild(link);
    link.click();
  };

  const handleLoad = (event) => {
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split('\n');
      const headers = lines[0].split(',');
      const newItinerary = [];
      for (let i = 1; i < lines.length; i++) {
        const data = lines[i].split(',');
        const item = {};
        for (let j = 0; j < headers.length; j++) {
          item[headers[j].trim()] = data[j].trim().replace(/"/g, '');
        }
        item.lat = parseFloat(item.Latitude);
        item.lon = parseFloat(item.Longitude);
        newItinerary.push(item);
      }
      onLoad(newItinerary);
    };
    reader.readAsText(file);
  };

  return (
    <div className="itinerary-panel">
      <h2>Itinerary</h2>
      <button onClick={handleSave}>Save to CSV</button>
      <input type="file" accept=".csv" onChange={handleLoad} />
      {items.length === 0 ? (
        <p>Click on a marker's popup to add a site to your itinerary.</p>
      ) : (
        <ul>
          {items.map(item => (
            <li key={item.name}>
              <span>{item.name} - {item.city}, {item.state}</span>
              <button onClick={() => onRemove(item)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default Itinerary;
