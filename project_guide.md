# IoT Vehicle Monitoring & Event Detection System
## Complete Step-by-Step Project Guide

---

## Table of Contents
1. [Hardware Overview & Wiring](#1-hardware-overview--wiring)
2. [Arduino IDE Setup & Library Installation](#2-arduino-ide-setup--library-installation)
3. [ESP32 Code — Explained Section by Section](#3-esp32-code--explained-section-by-section)
4. [Firebase Setup](#4-firebase-setup)
5. [Node.js Backend Setup](#5-nodejs-backend-setup)
6. [React Frontend Setup](#6-react-frontend-setup)
7. [Calibration & Threshold Tuning](#7-calibration--threshold-tuning)
8. [Testing & Validation](#8-testing--validation)
9. [Troubleshooting Guide](#9-troubleshooting-guide)
10. [System Architecture Diagram](#10-system-architecture-diagram)

---

## 1. Hardware Overview & Wiring

### 1.1 Components Required

| Component | Purpose | Interface |
|-----------|---------|-----------|
| ESP32 (30 or 38 pin) | Main controller, WiFi | — |
| ADXL345 | Acceleration measurement | I²C |
| GP-02 GPS Module | Location tracking | UART |
| WS2812 NeoPixel (optional) | Visual status indicator | Digital |
| Passive Buzzer (optional) | Audio alerts | Digital |
| 3.3V Regulator or USB power | Power supply | — |

### 1.2 Wiring Table

#### ADXL345 → ESP32 (I²C)

| ADXL345 Pin | ESP32 Pin | Notes |
|-------------|-----------|-------|
| VCC | 3.3V | **Do NOT connect to 5V** |
| GND | GND | Common ground |
| SDA | GPIO 21 | I²C data |
| SCL | GPIO 22 | I²C clock |
| SDO | GND | Sets I²C address to 0x53 |
| CS | 3.3V | Selects I²C mode |

> **Note:** If SDO is connected to 3.3V, I²C address becomes 0x1D. The Adafruit library defaults to 0x53 (SDO to GND).

#### GP-02 GPS → ESP32 (UART2)

| GPS Pin | ESP32 Pin | Notes |
|---------|-----------|-------|
| VCC | 3.3V or 5V | Check module datasheet |
| GND | GND | Common ground |
| TX | GPIO 16 (RX2) | GPS transmits → ESP32 receives |
| RX | GPIO 17 (TX2) | ESP32 transmits → GPS receives |

> **Note:** The GP-02 outputs 3.3V logic. Safe to connect directly to ESP32.

#### WS2812 NeoPixel → ESP32

| NeoPixel Pin | ESP32 Pin |
|--------------|-----------|
| VCC | 5V (from USB, not 3.3V) |
| GND | GND |
| DIN | GPIO 5 |

#### Buzzer → ESP32

| Buzzer Pin | ESP32 Pin |
|------------|-----------|
| + | GPIO 4 |
| − | GND |

### 1.3 Power Considerations
- Power the ESP32 via a quality USB cable or a 5V LiPo shield for vehicle use.
- The ADXL345 and GPS are powered from ESP32's 3.3V pin.
- WS2812 LEDs should be powered from 5V; never from 3.3V.

---

## 2. Arduino IDE Setup & Library Installation

### 2.1 Install Arduino IDE 2.x
Download from: https://www.arduino.cc/en/software

### 2.2 Add ESP32 Board Package
1. Open Arduino IDE → **File → Preferences**
2. In "Additional Board Manager URLs" paste:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Go to **Tools → Board → Board Manager**
4. Search for `esp32` by Espressif Systems
5. Install version **2.0.x or later**

### 2.3 Select Your Board
- **Tools → Board → ESP32 Arduino → ESP32 Dev Module**
- **Tools → Port** → Select the COM port (Windows) or `/dev/ttyUSB0` (Linux/Mac)
- **Tools → Upload Speed** → 115200
- **Tools → Flash Size** → 4MB (Default)

### 2.4 Install Required Libraries

Go to **Sketch → Include Library → Manage Libraries** and install each:

| Library Name | Author | Purpose |
|---|---|---|
| `Adafruit ADXL345` | Adafruit | ADXL345 sensor driver |
| `Adafruit Unified Sensor` | Adafruit | Sensor abstraction layer (dependency) |
| `TinyGPSPlus` | Mikal Hart | GPS NMEA parsing |
| `FastLED` | Daniel Garcia | WS2812 LED control |
| `Firebase ESP Client` | Mobizt | Firebase Realtime Database |
| `ArduinoJson` | Benoit Blanchon | JSON (Firebase dependency) |

> **Search tip:** Search the exact names above. Adafruit Unified Sensor is installed automatically when you install Adafruit ADXL345 — verify it appears in the installed list.

---

## 3. ESP32 Code — Explained Section by Section

### 3.1 Configuration Block (Edit Before Uploading)

```cpp
#define WIFI_SSID        "YOUR_WIFI_SSID"
#define WIFI_PASSWORD    "YOUR_WIFI_PASSWORD"
#define FIREBASE_HOST    "YOUR_PROJECT.firebaseio.com"
#define FIREBASE_AUTH    "YOUR_DATABASE_SECRET_OR_API_KEY"
```

Replace these four values with your actual credentials. See Section 4 for Firebase setup.

### 3.2 Event Detection Logic Explained

#### Collision Detection
```cpp
float mag = magnitude(ax, ay, az);
if (mag > COLLISION_THRESH_MS2)  // > 2.5g = 24.5 m/s²
```
The total acceleration vector magnitude spikes far above gravity during a collision. A moving vehicle normally has |A| ≈ 9.81–12 m/s². A threshold of 24.5 m/s² (2.5g) catches real impacts without false positives from bumps.

#### Rash Driving Detection
```cpp
float jerk = max(|ax - pax|, |ay - pay|);
if (jerk > RASH_JERK_THRESH_MS2)  // > 1.5g change in 100ms
```
Jerk is the *rate of change* of acceleration. Sudden braking or swerving creates a large jerk in X (forward/back) or Y (side-to-side). Measuring delta between consecutive 100ms samples detects these rapid changes.

#### Tow Detection
Three conditions must all be true simultaneously:
1. **Low variance** of |A| over 30 samples → no engine vibration
2. **Mean magnitude near 1g** → vehicle is near-horizontal (not parked sideways on a ramp)
3. **Small drift from 9.81** → slight, consistent motion (not completely stationary)

This distinguishes: parked (zero variance, exactly 9.81) vs towed (tiny variance, slightly off 9.81) vs driving (high variance).

#### Topple Detection
```cpp
if (az < TOPPLE_Z_THRESH)  // Z < -5.0 m/s²
```
When upright, the Z-axis reads ≈ +9.81 (pointing up against gravity). When the vehicle rolls 180°, Z reads ≈ -9.81. The threshold of -5.0 m/s² catches a significant tilt before full inversion.

### 3.3 Threshold Constants to Tune

Open the code and adjust these defines based on your test results:

```cpp
#define COLLISION_THRESH_MS2   (2.5f * GRAVITY_MS2)  // Raise if false positives on rough roads
#define RASH_JERK_THRESH_MS2   (1.5f * GRAVITY_MS2)  // Raise if normal driving triggers alerts
#define TOW_LOW_VAR_THRESH     0.08f                  // Raise if your parked car never triggers tow
#define TOW_DRIFT_THRESH       0.12f                  // Lower if parked cars falsely trigger tow
#define TOPPLE_Z_THRESH       (-5.0f)                 // Bring closer to -9.81 to reduce sensitivity
```

### 3.4 Firebase Data Structure

The code writes to these RTDB paths:

```
/sensor/latest          ← live ADXL + GPS snapshot (overwritten each second)
/sensor/log/<ts>        ← historical sensor log entries
/gps/latest             ← live GPS position
/gps/path/<ts>          ← GPS breadcrumb trail for map
/events/latest          ← most recent event (any type)
/events/collision/<ts>  ← collision log entries
/events/rash_driving/<ts>
/events/tow/<ts>
/events/topple/<ts>
```

---

## 4. Firebase Setup

### 4.1 Create a Firebase Project
1. Go to https://console.firebase.google.com
2. Click **"Add project"** → name it (e.g., `vehicle-monitor`)
3. Disable Google Analytics (not needed) → **Create project**

### 4.2 Enable Realtime Database
1. In left sidebar → **Build → Realtime Database**
2. Click **"Create Database"**
3. Choose a region close to you
4. Start in **Test mode** (allows open read/write temporarily)
   > ⚠️ Switch to authenticated rules before deploying!

### 4.3 Get Your Database URL and Secret
- **Database URL:** Shown at the top of the RTDB page, looks like `https://vehicle-monitor-default-rtdb.firebaseio.com`
- **Database Secret (legacy auth):**
  1. Project Settings (gear icon) → **Service accounts** tab
  2. Click **Database secrets** → **Show** → copy the secret

Paste both into the `#define` lines in your sketch.

### 4.4 Security Rules (for testing)
In Firebase Console → Realtime Database → **Rules** tab:
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```
> Switch to proper auth rules before deploying in a vehicle.

---

## 5. Node.js Backend Setup

The backend is minimal — it serves the React build and acts as a local API proxy if needed. Firebase handles actual data storage.

### 5.1 Initialize Project
```bash
mkdir vehicle-dashboard && cd vehicle-dashboard
npm init -y
npm install express cors
```

### 5.2 server.js
```javascript
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Serve React build in production
app.use(express.static(path.join(__dirname, 'client/build')));

// Health-check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Catch-all: serve React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

### 5.3 Run the Backend
```bash
node server.js
```

---

## 6. React Frontend Setup

### 6.1 Create React App
```bash
cd vehicle-dashboard
npx create-react-app client
cd client
npm install firebase chart.js react-chartjs-2 leaflet react-leaflet
```

### 6.2 Firebase Config (client/src/firebaseConfig.js)
```javascript
import { initializeApp } from "firebase/app";
import { getDatabase }   from "firebase/database";

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
```

Get these values from Firebase Console → Project Settings → **Your apps** → **Web app** → SDK setup.

### 6.3 Main Dashboard Component (client/src/App.js)
```jsx
import React, { useEffect, useState } from "react";
import { ref, onValue }               from "firebase/database";
import { db }                         from "./firebaseConfig";
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, Title, Tooltip, Legend
} from "chart.js";
import { Line }        from "react-chartjs-2";
import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix default Leaflet marker icons (broken with Webpack)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require("leaflet/dist/images/marker-icon-2x.png"),
  iconUrl:       require("leaflet/dist/images/marker-icon.png"),
  shadowUrl:     require("leaflet/dist/images/marker-shadow.png"),
});

ChartJS.register(
  CategoryScale, LinearScale, PointElement,
  LineElement, Title, Tooltip, Legend
);

const MAX_HISTORY = 60;  // number of chart data points

function App() {
  const [sensor,  setSensor]  = useState({ ax: 0, ay: 0, az: 0, mag: 0 });
  const [gps,     setGps]     = useState({ lat: 35.6762, lng: 139.6503 });
  const [gpsPath, setGpsPath] = useState([]);
  const [events,  setEvents]  = useState([]);
  const [accelHistory, setAccelHistory] = useState({
    labels: [], ax: [], ay: [], az: []
  });

  // ── Subscribe to latest sensor data ──────────────────
  useEffect(() => {
    const sensorRef = ref(db, "/sensor/latest");
    return onValue(sensorRef, (snap) => {
      if (!snap.exists()) return;
      const d = snap.val();
      setSensor(d);

      // Append to rolling chart history
      setAccelHistory(prev => {
        const ts = new Date().toLocaleTimeString();
        const labels = [...prev.labels, ts].slice(-MAX_HISTORY);
        const ax     = [...prev.ax, d.ax].slice(-MAX_HISTORY);
        const ay     = [...prev.ay, d.ay].slice(-MAX_HISTORY);
        const az     = [...prev.az, d.az].slice(-MAX_HISTORY);
        return { labels, ax, ay, az };
      });

      if (d.gpsValid) {
        setGps({ lat: d.lat, lng: d.lng });
        setGpsPath(prev => [...prev, [d.lat, d.lng]].slice(-200));
      }
    });
  }, []);

  // ── Subscribe to latest event ─────────────────────────
  useEffect(() => {
    const evRef = ref(db, "/events/latest");
    return onValue(evRef, (snap) => {
      if (!snap.exists()) return;
      const ev = snap.val();
      setEvents(prev => [
        { ...ev, id: Date.now() },
        ...prev
      ].slice(0, 20));   // keep last 20 events
    });
  }, []);

  // ── Chart data ────────────────────────────────────────
  const chartData = {
    labels: accelHistory.labels,
    datasets: [
      { label: "X (m/s²)", data: accelHistory.ax, borderColor: "#ef4444", tension: 0.3, pointRadius: 0 },
      { label: "Y (m/s²)", data: accelHistory.ay, borderColor: "#22c55e", tension: 0.3, pointRadius: 0 },
      { label: "Z (m/s²)", data: accelHistory.az, borderColor: "#3b82f6", tension: 0.3, pointRadius: 0 },
    ]
  };

  const chartOptions = {
    responsive: true,
    animation: false,
    scales: {
      y: { title: { display: true, text: "Acceleration (m/s²)" } },
      x: { ticks: { maxRotation: 0, maxTicksLimit: 8 } }
    }
  };

  // ── Event badge colour ────────────────────────────────
  const eventColour = {
    collision:    "#ef4444",
    rash_driving: "#f97316",
    tow:          "#eab308",
    topple:       "#8b5cf6"
  };

  // ── Render ────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem", background: "#0f172a", color: "#e2e8f0", minHeight: "100vh" }}>
      <h1 style={{ textAlign: "center", color: "#38bdf8" }}>🚗 Vehicle Monitor Dashboard</h1>

      {/* Live Readings */}
      <section style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {[
          { label: "AX", value: sensor.ax?.toFixed(2), unit: "m/s²" },
          { label: "AY", value: sensor.ay?.toFixed(2), unit: "m/s²" },
          { label: "AZ", value: sensor.az?.toFixed(2), unit: "m/s²" },
          { label: "|A|", value: sensor.mag?.toFixed(2), unit: "m/s²" },
        ].map(({ label, value, unit }) => (
          <div key={label} style={{ background: "#1e293b", borderRadius: 8, padding: "1rem 1.5rem", flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: "bold", color: "#38bdf8" }}>{value}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{unit}</div>
          </div>
        ))}
      </section>

      {/* Chart */}
      <section style={{ background: "#1e293b", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
        <h2 style={{ margin: "0 0 0.5rem" }}>Live Acceleration Chart</h2>
        <Line data={chartData} options={chartOptions} />
      </section>

      {/* Map + Events side by side */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>

        {/* Map */}
        <section style={{ flex: 2, minWidth: 300, background: "#1e293b", borderRadius: 8, padding: "1rem" }}>
          <h2 style={{ margin: "0 0 0.5rem" }}>GPS Map</h2>
          <MapContainer center={[gps.lat, gps.lng]} zoom={15}
            style={{ height: 350, borderRadius: 6 }}>
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {gpsPath.length > 0 && (
              <Polyline positions={gpsPath} color="#38bdf8" weight={3} />
            )}
            <Marker position={[gps.lat, gps.lng]}>
              <Popup>Current Location<br />Lat: {gps.lat.toFixed(5)}<br />Lng: {gps.lng.toFixed(5)}</Popup>
            </Marker>
          </MapContainer>
        </section>

        {/* Events */}
        <section style={{ flex: 1, minWidth: 240, background: "#1e293b", borderRadius: 8, padding: "1rem" }}>
          <h2 style={{ margin: "0 0 0.5rem" }}>Event Log</h2>
          <div style={{ maxHeight: 350, overflowY: "auto" }}>
            {events.length === 0 && <p style={{ color: "#64748b" }}>No events yet.</p>}
            {events.map(ev => (
              <div key={ev.id} style={{
                borderLeft: `4px solid ${eventColour[ev.type] || "#888"}`,
                background: "#0f172a", borderRadius: 4,
                padding: "0.5rem 0.75rem", marginBottom: "0.5rem"
              }}>
                <strong style={{ color: eventColour[ev.type] || "#fff" }}>
                  {ev.type?.toUpperCase().replace("_", " ")}
                </strong>
                <div style={{ fontSize: 11, color: "#64748b" }}>{ev.ts}</div>
                <div style={{ fontSize: 12 }}>
                  AX:{ev.ax?.toFixed(1)} AY:{ev.ay?.toFixed(1)} AZ:{ev.az?.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
```

### 6.4 Run the Frontend
```bash
cd client
npm start
```
Opens at http://localhost:3000

---

## 7. Calibration & Threshold Tuning

### 7.1 Step 1 — Verify ADXL345 Readings

With the ESP32 stationary on a flat surface, open Serial Monitor (115200 baud). You should see:
```
AX:0.10 AY:-0.05 AZ:9.78 |A|:9.78 | GPS:-- Lat:0.00000 Lng:0.00000
```
- AZ should be close to +9.81
- AX and AY should be near 0
- |A| (magnitude) should be ≈ 9.81

If not, check wiring (SDA/SCL, GND, 3.3V).

### 7.2 Step 2 — Calibrate Tow Thresholds

With the ESP32 on a flat surface, powered on:
1. Let it run for 30+ seconds (fill tow buffer)
2. Note the variance and mean in Serial output
3. Adjust `TOW_LOW_VAR_THRESH` to be slightly above the resting variance

Then gently rock/tilt the board slowly (simulating tow):
1. Variance should stay low
2. Mean should drift slightly
3. Event should fire if tow conditions met

### 7.3 Step 3 — Test Collision Threshold

Hold the board and sharply tap it against your palm. Observe |A| spike in Serial Monitor. If |A| exceeds 24.5 (2.5g) you'll see the event fire. Adjust `COLLISION_THRESH_MS2` accordingly.

### 7.4 Step 4 — Test Topple

Slowly flip the board upside-down. AZ should go from +9.81 to -9.81. Event fires when AZ < -5.0. The `-5.0` threshold catches the board before full inversion.

### 7.5 Step 5 — Test Rash Driving

Hold the board and jerk it suddenly in one direction. If the AX or AY change between two 100ms samples exceeds 1.5g (14.7 m/s²), a rash driving event fires.

---

## 8. Testing & Validation

### 8.1 Unit Tests (on bench)

| Test | Expected Result |
|------|----------------|
| ADXL345 flat surface | AZ ≈ 9.81, AX/AY ≈ 0 |
| ADXL345 on side | One lateral axis ≈ 9.81 |
| Sharp tap on board | Collision event fires |
| Sudden lateral jerk | Rash driving event fires |
| Board inverted | Topple event fires |
| Slow rocking motion | Tow event fires (after ~3 s) |
| GPS outdoors | gpsValid = true, coordinates update |
| Firebase dashboard | All paths populate with data |

### 8.2 In-Vehicle Testing Checklist
- [ ] Mount ADXL345 with Z-axis pointing UP (vertical, parallel to gravity)
- [ ] Mark X-axis pointing toward vehicle front
- [ ] Secure all connections (vibrations can loosen jumpers — use dupont with lock or solder)
- [ ] Test WiFi reaches vehicle location
- [ ] Verify GPS lock before driving (can take 30–90 seconds cold start)
- [ ] Monitor Serial output for first 2 minutes before relying on dashboard

---

## 9. Troubleshooting Guide

### ADXL345 not found
- Check `SDA → GPIO 21`, `SCL → GPIO 22`
- Verify VCC = 3.3V (not 5V)
- Confirm `CS` is tied to 3.3V and `SDO` to GND
- Run an I2C scanner sketch to verify address (0x53)

### GPS has no data / gpsValid always false
- Ensure GPS module has a clear sky view
- Cold start takes 30–90 seconds
- Check TX/RX are not crossed (GPS TX → ESP32 RX2 pin 16)
- Verify GPS baud rate is 9600
- Echo raw GPS UART to Serial to confirm NMEA sentences arriving:
  ```cpp
  // Debug: add to loop temporarily
  while (gpsSerial.available()) Serial.write(gpsSerial.read());
  ```

### Firebase write fails
- Check `FIREBASE_HOST` format: `YOUR_PROJECT.firebaseio.com` (no `https://`)
- Verify database rules allow write
- Check WiFi is connected: Serial should print IP address
- Firebase library may need `Firebase.reconnectWiFi(true)` after connection drops

### False positive events (too many alerts)
- Raise collision threshold to 3.0g
- Raise rash jerk threshold to 2.0g
- Ensure ADXL345 is mounted rigidly; loose mounting amplifies vibration

### Dashboard map not showing
- Leaflet requires internet for tile loading (OpenStreetMap tiles)
- For fully offline map, use a local tile server (e.g., `mbtiles` with `tileserver-gl`)

---

## 10. System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          VEHICLE                                │
│                                                                 │
│   ┌──────────┐    I²C    ┌──────────────────────────────────┐  │
│   │ ADXL345  │─────────►│                                  │  │
│   └──────────┘           │           ESP32                  │  │
│                          │                                  │  │
│   ┌──────────┐   UART2   │  ┌──────────────────────────┐   │  │
│   │ GP-02    │─────────►│  │  Event Detection Engine  │   │  │
│   │  GPS     │           │  │  • Collision             │   │  │
│   └──────────┘           │  │  • Rash Driving          │   │  │
│                          │  │  • Tow Detection         │   │  │
│   ┌──────────┐  GPIO     │  │  • Topple Detection      │   │  │
│   │ LED +    │◄─────────│  └──────────────────────────┘   │  │
│   │ Buzzer   │           │                                  │  │
│   └──────────┘           └──────────────┬───────────────────┘  │
│                                         │ WiFi                  │
└─────────────────────────────────────────┼───────────────────────┘
                                          │
                                          ▼
                            ┌─────────────────────────┐
                            │   Firebase Realtime DB   │
                            │   /sensor/latest         │
                            │   /gps/path/<ts>         │
                            │   /events/<type>/<ts>    │
                            └────────────┬────────────┘
                                         │ Firebase SDK
                          ┌──────────────┴──────────────┐
                          │                             │
                   ┌──────┴──────┐            ┌────────┴───────┐
                   │  Node.js    │            │  React Frontend │
                   │  Backend    │            │                 │
                   │  (Express)  │            │  • Accel Chart  │
                   │  Port 3001  │            │  • GPS Map      │
                   └─────────────┘            │  • Event Log    │
                                              │  (Chart.js +    │
                                              │   Leaflet.js)   │
                                              └────────────────┘
```

### Data Flow Summary
1. ADXL345 samples at 100 Hz → ESP32 reads every 100 ms
2. GPS NMEA sentences parsed continuously by TinyGPSPlus
3. Every 100 ms: event detection algorithms run on fresh accelerometer data
4. Every 1000 ms: sensor snapshot + any pending events pushed to Firebase RTDB
5. React dashboard subscribes to Firebase via `onValue` listeners (real-time push)
6. Chart.js plots rolling 60-sample accelerometer history
7. Leaflet renders GPS breadcrumb trail and current marker on OpenStreetMap

---

## Quick Start Checklist

```
[ ] Step 1: Wire ADXL345 (SDA→21, SCL→22, VCC→3.3V, GND, CS→3.3V, SDO→GND)
[ ] Step 2: Wire GPS (TX→GPIO16, GND, VCC→3.3V)
[ ] Step 3: Install Arduino ESP32 board package
[ ] Step 4: Install all 6 libraries via Library Manager
[ ] Step 5: Create Firebase project + Realtime Database
[ ] Step 6: Fill in WiFi, Firebase credentials in the sketch
[ ] Step 7: Upload sketch, open Serial Monitor at 115200
[ ] Step 8: Verify AZ ≈ 9.81 in Serial Monitor
[ ] Step 9: Initialize Node.js backend (npm install, node server.js)
[ ] Step 10: Initialize React app (npx create-react-app, npm install firebase chart.js ...)
[ ] Step 11: Add Firebase config to firebaseConfig.js
[ ] Step 12: npm start → open http://localhost:3000
[ ] Step 13: Calibrate thresholds using bench tests
[ ] Step 14: Test each event type manually
[ ] Step 15: Deploy in vehicle with secure mounting
```
