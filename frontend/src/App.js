import React, { useEffect, useState, useRef } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "./firebaseConfig";

import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, Title, Tooltip, Legend
} from "chart.js";

import { Line } from "react-chartjs-2";
import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";

import "leaflet/dist/leaflet.css";
import "leaflet.heat";

import L from "leaflet";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require("leaflet/dist/images/marker-icon-2x.png"),
  iconUrl: require("leaflet/dist/images/marker-icon.png"),
  shadowUrl: require("leaflet/dist/images/marker-shadow.png"),
});

ChartJS.register(
  CategoryScale, LinearScale, PointElement,
  LineElement, Title, Tooltip, Legend
);

const MAX_HISTORY = 60;
const SPEED_LIMIT = 10; // km/h (change as needed)

function App() {
  const [sensor, setSensor] = useState({ ax: 0, ay: 0, az: 0, mag: 0 });
  const [gps, setGps] = useState({ lat: 29, lng: 77, speed:0 });
  const [gpsPath, setGpsPath] = useState([]);
  const [events, setEvents] = useState([]);
  const [eventHistory, setEventHistory] = useState([]);
  const [trip, setTrip] = useState({
    distance: 0,
    maxSpeed: 0,
    avgSpeed: 0
  });
  const [analytics, setAnalytics] = useState({
    totalEvents: 0,
    collisions: 0
  });

  const [accelHistory, setAccelHistory] = useState({
    labels: [], ax: [], ay: [], az: []
  });

  const [filter, setFilter] = useState("all");

  const mapRef = useRef(null);          // history map
  const liveMapRef = useRef(null);      // live map
  const heatLayerRef = useRef(null);

  const [timeOffset, setTimeOffset] = useState(null);
  const [latestMillis, setLatestMillis] = useState(0);

  const normalizeType = (type) =>
    (type || "").toString().trim().toLowerCase();

  const getDistance = (p1, p2) => {
    const R = 6371; // km
    const dLat = (p2[0] - p1[0]) * Math.PI / 180;
    const dLng = (p2[1] - p1[1]) * Math.PI / 180;

    const a =
      Math.sin(dLat/2) ** 2 +
      Math.cos(p1[0]*Math.PI/180) *
      Math.cos(p2[0]*Math.PI/180) *
      Math.sin(dLng/2) ** 2;

    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  };

  // SENSOR
  useEffect(() => {
    const sensorRef = ref(db, "/sensor/latest");

    return onValue(sensorRef, (snap) => {
      if (!snap.exists()) return;

      const d = snap.val();
      setSensor(d);
      if (d.speed && d.speed > SPEED_LIMIT) {
        const ts = Date.now();

        setEvents(prev => {
          const id = ts + "overspeed";

          const isDuplicate = prev.some(e => e.id === id);
          if (isDuplicate) return prev;

          return [
            {
              id,
              type: "overspeed",
              ts,
              speed: d.speed,
              lat: d.lat,
              lng: d.lng
            },
            ...prev
          ].slice(0, 20);
        });
      }

      setAccelHistory(prev => {
        const ts = new Date().toLocaleTimeString();
        return {
          labels: [...prev.labels, ts].slice(-MAX_HISTORY),
          ax: [...prev.ax, d.ax].slice(-MAX_HISTORY),
          ay: [...prev.ay, d.ay].slice(-MAX_HISTORY),
          az: [...prev.az, d.az].slice(-MAX_HISTORY)
        };
      });

      if (d.gpsValid) {
        const newPos = [d.lat, d.lng];

        setGps({ lat: d.lat, lng: d.lng , speed: d.speed || 0});
        setGpsPath(prev => [...prev, newPos].slice(-200));
        setTrip(prev => {
          let newDistance = prev.distance;

          if (gpsPath.length > 0) {
            const last = gpsPath[gpsPath.length - 1];
            const curr = [d.lat, d.lng];
            newDistance += getDistance(last, curr);
          }

          const newMax = Math.max(prev.maxSpeed, d.speed || 0);

          const totalPoints = gpsPath.length + 1;
          const newAvg =
            ((prev.avgSpeed * gpsPath.length) + (d.speed || 0)) / totalPoints;

          return {
            distance: newDistance,
            maxSpeed: newMax,
            avgSpeed: newAvg
          };
        });
        // //   FORCE MAP UPDATE
        // if (liveMapRef.current) {
        //   liveMapRef.current.setView(newPos, 15);
        // }
      }
      if (liveMapRef.current && d.gpsValid) {
        liveMapRef.current.setView([d.lat, d.lng]);
      }
    });
  }, []);

  // EVENTS
  useEffect(() => {
    const evRef = ref(db, "/events/latest");

    return onValue(evRef, (snap) => {
      if (!snap.exists()) return;

      const ev = snap.val();
      const evMillis = Number(ev.ts) || 0;

      setEvents(prev => {
        if (evMillis > latestMillis) {
          setLatestMillis(evMillis);

          if (timeOffset === null) {
            setTimeOffset(Date.now() - evMillis);
          }
        }

        //   DUPLICATE CHECK
        const isDuplicate = prev.some(e => e.id === (ev.ts + ev.type));

        if (isDuplicate) return prev;

        return [
          { ...ev, id: ev.ts + ev.type }, // stable id
          ...prev
        ].slice(0, 20);
      });
    });
  }, [latestMillis, timeOffset]);

  // HISTORY
  useEffect(() => {
    const evHistRef = ref(db, "/events/history");

    return onValue(evHistRef, (snap) => {
      if (!snap.exists()) return;

      const data = snap.val();

      const parsed = Object.keys(data).map(key => ({
        id: key,
        ...data[key]
      }));

      parsed.sort((a, b) => b.ts - a.ts);
      setEventHistory(parsed);
    });
  }, []);

  // ANALYTICS
  useEffect(() => {
    if (!eventHistory.length) return;

    let collisions = 0;

    eventHistory.forEach(ev => {
      if (normalizeType(ev.type) === "collision") collisions++;
    });

    setAnalytics({
      totalEvents: eventHistory.length,
      collisions
    });
  }, [eventHistory]);

  // HEATMAP
  useEffect(() => {
    if (!mapRef.current || !eventHistory.length) return;

    const points = eventHistory
      .filter(ev => ev.lat && ev.lng)
      .map(ev => [ev.lat, ev.lng]);

    if (heatLayerRef.current) {
      mapRef.current.removeLayer(heatLayerRef.current);
    }

    heatLayerRef.current = L.heatLayer(points, {
      radius: 25,
      blur: 15
    }).addTo(mapRef.current);

  }, [eventHistory]);

  const filteredEvents = events.filter(ev => {
    if (filter === "all") return true;
    return normalizeType(ev.type) === filter;
  });

  const getEventTime = (ts) => {
    if (!ts || timeOffset === null) return "syncing...";

    const realTime = timeOffset + Number(ts);
    let diff = Date.now() - realTime;

    if (diff < 0) diff = 0;

    const sec = Math.floor(diff / 1000);
    const min = Math.floor(sec / 60);
    const hr  = Math.floor(min / 60);

    if (sec < 60) return `${sec}s ago`;
    if (min < 60) return `${min}m ago`;
    if (hr < 24) return `${hr}h ago`;

    return `${Math.floor(hr / 24)}d ago`;
  };

  const chartData = {
    labels: accelHistory.labels,
    datasets: [
      { label: "X", data: accelHistory.ax, borderColor: "#ef4444", tension: 0.3 },
      { label: "Y", data: accelHistory.ay, borderColor: "#22c55e", tension: 0.3 },
      { label: "Z", data: accelHistory.az, borderColor: "#3b82f6", tension: 0.3 }
    ]
  };

  const eventColour = {
    collision: "#ef4444",
    rash: "#f97316",
    "rash drive": "#f97316",
    tow: "#eab308",
    topple: "#8b5cf6",
    overspeed: "#06b6d4"
  };

  //   LIVE LOCATION ICON (green glow)
  const liveIcon = L.divIcon({
    className: "",
    html: `
      <div style="
        width:16px;
        height:16px;
        background:#22c55e;
        border-radius:50%;
        border:3px solid white;
        box-shadow:0 0 12px #22c55e;
      "></div>
    `
  });

  //  EVENT ICONS (color-based)
  const getEventIcon = (type) => {
    const colorMap = {
      collision: "#ef4444",
      tow: "#eab308",
      topple: "#8b5cf6",
      "rash drive": "#f97316"
    };

    const color = colorMap[type] || "#3b82f6";

    return L.divIcon({
      className: "",
      html: `
        <div style="
          width:14px;
          height:14px;
          background:${color};
          border-radius:50%;
          border:2px solid white;
          box-shadow:0 0 6px ${color};
        "></div>
      `
    });
  };

  const card = {
    background: "#0f172a",
    borderRadius: 16,
    padding: "1rem",
    boxShadow: "0 8px 20px rgba(0,0,0,0.4)"
  };

  return (
    <div style={{
      fontFamily: "Inter, sans-serif",
      padding: "1.5rem",
      background: "#020617",
      color: "#e2e8f0"
    }}>

      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
        <h1 style={{ color: "#38bdf8" }}>  Vehicle Dashboard</h1>

        <div style={{ display: "flex", gap: "1rem" }}>
          <div style={{ color: "#22c55e" }}>● Live</div>
          <div style={{ color: gps.lat ? "#22c55e" : "#ef4444" }}>
            ● GPS {gps.lat ? "Active" : "No Signal"}
          </div>
        </div>
      </div>

      {/* SENSOR CARDS */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "1rem",
        marginBottom: "1rem"
      }}>
        {[
          { label: "AX", value: sensor.ax?.toFixed(2) },
          { label: "AY", value: sensor.ay?.toFixed(2) },
          { label: "AZ", value: sensor.az?.toFixed(2) },
          { label: "|A|", value: sensor.mag?.toFixed(2) },
          { label: "LAT", value: gps.lat?.toFixed(5) },
          { label: "LNG", value: gps.lng?.toFixed(5) },
          { label: "SPEED (km/h)", value: gps.speed?.toFixed(1) },
        ].map(({ label, value }) => (
          <div key={label} style={card}>
            <div style={{ opacity: 0.6 }}>{label}</div>
            <div style={{ fontSize: 26 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ANALYTICS */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <div style={{ ...card, flex: 1 }}>
          <div>Total Events</div>
          <div style={{ fontSize: 24 }}>{analytics.totalEvents}</div>
        </div>

        <div style={{ ...card, flex: 1 }}>
          <div>Collisions</div>
          <div style={{ fontSize: 24 }}>{analytics.collisions}</div>
        </div>
      </div>

      {/* TRIP   */}
        <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
          <div style={{ ...card, flex: 1 }}>
            <div>Distance (km)</div>
            <div style={{ fontSize: 24 }}>{trip.distance.toFixed(2)}</div>
          </div>

          <div style={{ ...card, flex: 1 }}>
            <div>Avg Speed</div>
            <div style={{ fontSize: 24 }}>{trip.avgSpeed.toFixed(1)} km/h</div>
          </div>

          <div style={{ ...card, flex: 1 }}>
            <div>Max Speed</div>
            <div style={{ fontSize: 24 }}>{trip.maxSpeed.toFixed(1)} km/h</div>
          </div>
        </div>

      {/* CHART */}
      <div style={{ ...card, marginBottom: "1rem" }}>
        <Line data={chartData} />
      </div>

      {/* MAPS */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1rem",
          marginBottom: "1rem"
        }}>

          {/* LIVE MAP */}
          <div style={card}>
            <h3 style={{ marginBottom: "0.5rem" }}> Live Location</h3>

            <MapContainer
              center={[gps.lat || 0, gps.lng || 0]}
              zoom={5}
              style={{ height: 300 }}
              whenCreated={(map) => (liveMapRef.current = map)}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

              {gpsPath.length > 0 && (
                <Polyline positions={gpsPath} color="#38bdf8" />
              )}

    

              {gps.lat !== 0 && gps.lng !== 0 && (
                <Marker position={[gps.lat, gps.lng]} icon={liveIcon}>
                  <Popup>  Live Vehicle</Popup>
                </Marker>
              )}
            </MapContainer>
          </div>

          {/* EVENT HISTORY MAP */}
          <div style={card}>
            <h3 style={{ marginBottom: "0.5rem" }}>Event History</h3>

            <MapContainer
              center={[gps.lat || 0, gps.lng || 0]}
              zoom={5}
              style={{ height: 300 }}
              whenCreated={(map) => (mapRef.current = map)}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

              {/* Event markers */}
              {eventHistory.map((ev, i) => {
                if (!ev.lat || !ev.lng) return null;

                return (
                  <Marker
                    key={i}
                    position={[ev.lat, ev.lng]}
                    icon={getEventIcon(normalizeType(ev.type))}
                  >
                    <Popup>
                      <strong>{ev.type}</strong><br />
                      {getEventTime(ev.ts)}
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          </div>

        </div>

      {/* EVENTS */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2>Events</h2>

          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ background: "#020617", color: "#fff" }}
          >
            <option value="all">All</option>
            <option value="collision">Collision</option>
            <option value="rash drive">Rash Drive</option>
            <option value="tow">Tow</option>
            <option value="topple">Topple</option>
            <option value="overspeed">Overspeed</option>
          </select>
        </div>

        <div style={{ maxHeight: 300, overflowY: "auto", marginTop: "0.5rem" }}>
          {filteredEvents.map(ev => {
            const type = normalizeType(ev.type);

            return (
              <div key={ev.id} style={{
                borderLeft: `5px solid ${eventColour[type] || "#888"}`,
                padding: "0.6rem",
                marginBottom: "0.4rem",
                background: "#020617",
                borderRadius: 8,
                transition: "0.2s"
              }}>
                <strong>{ev.type}</strong>
                <div style={{ fontSize: 12 }}>{getEventTime(ev.ts)}</div>
                <div style={{ fontSize: 12 }}>
                  AX:{ev.ax?.toFixed(1)} AY:{ev.ay?.toFixed(1)} AZ:{ev.az?.toFixed(1)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

export default App;