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

function App() {
  const [sensor, setSensor] = useState({ ax: 0, ay: 0, az: 0, mag: 0 });
  const [gps, setGps] = useState({ lat: 0, lng: 0 });
  const [gpsPath, setGpsPath] = useState([]);

  const [events, setEvents] = useState([]);
  const [eventHistory, setEventHistory] = useState([]);

  const [analytics, setAnalytics] = useState({
    totalEvents: 0,
    collisions: 0
  });

  const [accelHistory, setAccelHistory] = useState({
    labels: [], ax: [], ay: [], az: []
  });

  const [filter, setFilter] = useState("all");

  const mapRef = useRef(null);
  const heatLayerRef = useRef(null);

  const [timeOffset, setTimeOffset] = useState(null);
  const [latestMillis, setLatestMillis] = useState(0);

  const normalizeType = (type) =>
    (type || "").toString().trim().toLowerCase();

  // SENSOR
  useEffect(() => {
    const sensorRef = ref(db, "/sensor/latest");

    return onValue(sensorRef, (snap) => {
      if (!snap.exists()) return;

      const d = snap.val();
      setSensor(d);

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
        setGps({ lat: d.lat, lng: d.lng });
        setGpsPath(prev => [...prev, [d.lat, d.lng]].slice(-200));
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

        return [
          { ...ev, id: Date.now() },
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
    topple: "#8b5cf6"
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
        <h1 style={{ color: "#38bdf8" }}>🚗 Vehicle Dashboard</h1>

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

      {/* CHART */}
      <div style={{ ...card, marginBottom: "1rem" }}>
        <Line data={chartData} />
      </div>

      {/* MAP */}
      <div style={{ ...card, marginBottom: "1rem" }}>
        <MapContainer
          center={[gps.lat || 0, gps.lng || 0]}
          zoom={15}
          style={{ height: 320 }}
          whenCreated={(map) => (mapRef.current = map)}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {gpsPath.length > 0 && (
            <Polyline positions={gpsPath} color="#38bdf8" />
          )}

          <Marker position={[gps.lat, gps.lng]}>
            <Popup>Current Location</Popup>
          </Marker>
        </MapContainer>
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