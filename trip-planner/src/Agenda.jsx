import React from 'react';

function Agenda({ route }) {
  if (!route) {
    return (
      <div className="agenda-panel">
        <h2>Agenda</h2>
        <p>Add items to your itinerary to see the agenda.</p>
      </div>
    );
  }

  const { distance, duration } = route.summary;
  const days = [];
  let day = 1;
  let dayDuration = 0;
  let dayDistance = 0;
  let daySegments = [];

  route.segments.forEach((segment, index) => {
    dayDuration += segment.duration;
    dayDistance += segment.distance;
    daySegments.push(segment);

    if (dayDuration > 8 * 3600) { // 8 hours in seconds
      days.push({
        day,
        duration: dayDuration,
        distance: dayDistance,
        segments: daySegments,
      });
      day++;
      dayDuration = 0;
      dayDistance = 0;
      daySegments = [];
    }
  });

  if (daySegments.length > 0) {
    days.push({
      day,
      duration: dayDuration,
      distance: dayDistance,
      segments: daySegments,
    });
  }


  return (
    <div className="agenda-panel">
      <h2>Agenda</h2>
      <p>Total Distance: {(distance / 1609.34).toFixed(2)} miles</p>
      <p>Total Duration: {(duration / 3600).toFixed(2)} hours</p>
      <hr />
      {days.map(d => (
        <div key={d.day}>
          <h3>Day {d.day}</h3>
          <p>Driving Time: {(d.duration / 3600).toFixed(2)} hours</p>
          <p>Distance: {(d.distance / 1609.34).toFixed(2)} miles</p>
        </div>
      ))}
    </div>
  );
}

export default Agenda;
