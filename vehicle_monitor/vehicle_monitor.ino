#include <WiFi.h>
#include <FirebaseESP32.h>
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_ADXL345_U.h>
#include <TinyGPSPlus.h>

// ───────── CONFIG ─────────
#define WIFI_SSID       "Avinash"
#define WIFI_PASSWORD   "nahi dunga"

#define FIREBASE_HOST   "vehicle-monitor-10591-default-rtdb.asia-southeast1.firebasedatabase.app"
#define FIREBASE_AUTH   "8d3bEAHqL6d1pODfVSdOq53JAM1JnU5sbZOkNi1W"

// ───────── PINS ─────────
#define SDA_PIN   1
#define SCL_PIN   0
#define GPS_RX    8
#define GPS_TX    9
#define BUZZER    6

// ───────── CONSTANTS ─────────
#define GRAVITY 9.81

#define COLLISION_THRESH  (2.5 * GRAVITY)
#define RASH_THRESH       (1.5 * GRAVITY)
#define TOPPLE_Z_THRESH   (-5.0)

#define SAMPLE_INTERVAL   100
#define FIREBASE_INTERVAL 2000

// ===== EVENT CONTROL =====
unsigned long lastTowTime = 0;
unsigned long lastCollisionTime = 0;
unsigned long lastRashTime = 0;
unsigned long lastToppleTime = 0;

bool towActive = false;
bool toppleActive = false;

// cooldowns (tune later)
const unsigned long TOW_COOLDOWN = 5000;
const unsigned long COLLISION_COOLDOWN = 3000;
const unsigned long RASH_COOLDOWN = 3000;
const unsigned long TOPPLE_COOLDOWN = 5000;

// ───────── OBJECTS ─────────
FirebaseData fbdo;
FirebaseConfig config;
FirebaseAuth auth;

Adafruit_ADXL345_Unified accel = Adafruit_ADXL345_Unified(12345);
HardwareSerial gpsSerial(1);
TinyGPSPlus gps;

// ───────── STATE ─────────
float ax, ay, az, mag;
float pax, pay;
float paz;

float gpsLat = 0, gpsLng = 0, gpsSpd = 0;
bool gpsValid = false;

unsigned long lastSample = 0;
unsigned long lastFirebase = 0;

// Tow buffer
float magBuffer[30];
int idx = 0;
bool full = false;

// ───────── HELPERS ─────────
float magnitude(float x, float y, float z) {
  return sqrt(x*x + y*y + z*z);
}

void beep() {
  digitalWrite(BUZZER, HIGH);
  delay(150);
  digitalWrite(BUZZER, LOW);
}

// ───────── WIFI ─────────
void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
}

// ───────── FIREBASE ─────────
void connectFirebase() {
  config.host = FIREBASE_HOST;
  config.signer.tokens.legacy_token = FIREBASE_AUTH;
  Firebase.begin(&config, &auth);
}

// ───────── SENSORS ─────────
void setupAccel() {
  if (!accel.begin()) {
    while (1);
  }
}

void readAccel() {
  sensors_event_t event;
  accel.getEvent(&event);
  ax = event.acceleration.x;
  ay = event.acceleration.y;
  az = event.acceleration.z;
  mag = magnitude(ax, ay, az); 
}

void readGPS() {
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
  }
  if (gps.location.isValid()) {
    gpsLat = gps.location.lat();
    gpsLng = gps.location.lng();
    gpsSpd = gps.speed.kmph();
    gpsValid = true;
  }
}

// ───────── DETECTIONS ─────────

bool detectCollision() {
  return magnitude(ax, ay, az) > COLLISION_THRESH;
}

bool detectRash() {
  float jerk = magnitude(ax - pax, ay - pay, az - paz);
  return jerk > RASH_THRESH;
}

bool detectTopple() {
  return az < TOPPLE_Z_THRESH;
}

bool detectTow() {
  mag = magnitude(ax, ay, az);
  magBuffer[idx] = mag;
  idx = (idx + 1) % 30;
  if (idx == 0) full = true;

  if (!full) return false;

  float mean = 0;
  for (int i = 0; i < 30; i++) mean += magBuffer[i];
  mean /= 30;

  float var = 0;
  for (int i = 0; i < 30; i++) {
    float d = magBuffer[i] - mean;
    var += d * d;
  }
  var /= 30;

  return (var < 0.05 && abs(mean - GRAVITY) > 0.5);
}

// ───────── FIREBASE PUSH ─────────
void pushData(const char* type) {
  FirebaseJson json;

  json.set("type", type);
  json.set("ax", ax);
  json.set("ay", ay);
  json.set("az", az);
  json.set("mag", mag);
  json.set("lat", gpsLat);
  json.set("lng", gpsLng);
  json.set("speed", gpsSpd);

  json.set("ts", millis());

  // latest
  Firebase.setJSON(fbdo, "/events/latest", json);

  // history (SAFE PUSH — no overwrite)
  Firebase.pushJSON(fbdo, "/events/history", json);
}

// ───────── SETUP ─────────
void setup() {
  Serial.begin(115200);

  pinMode(BUZZER, OUTPUT);
  Wire.begin(SDA_PIN, SCL_PIN);

  setupAccel();
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);

  connectWiFi();
  connectFirebase();
}

// ───────── LOOP ─────────
void loop() {
  unsigned long now = millis();
  pax = ax;
  pay = ay;
  paz = az;
  readGPS();

  if (now - lastSample > SAMPLE_INTERVAL) {
    lastSample = now;

    pax = ax;
    pay = ay;

    readAccel();

    // COLLISION
    if (detectCollision() && (now - lastCollisionTime > COLLISION_COOLDOWN)) {
      lastCollisionTime = now;
      pushData("COLLISION");
      beep();
    }

    // RASH
    if (detectRash() && (now - lastRashTime > RASH_COOLDOWN)) {
      lastRashTime = now;
      pushData("RASH DRIVE");
    }

    // TOPPLE
    bool toppleNow = detectTopple();

    if (toppleNow && !toppleActive && (now - lastToppleTime > TOPPLE_COOLDOWN)) {
      toppleActive = true;
      lastToppleTime = now;

      pushData("TOPPLE");
    }
    else if (!toppleNow) {
      toppleActive = false;
    }

    // TOW (already fixed above)
    bool towNow = detectTow();

    if (towNow && !towActive && (now - lastTowTime > TOW_COOLDOWN)) {
      towActive = true;
      lastTowTime = now;

      pushData("TOW");
    }
    else if (!towNow) {
      towActive = false;
    }

    Serial.printf("AX %.2f AY %.2f AZ %.2f\n", ax, ay, az);
  }

  if (now - lastFirebase > FIREBASE_INTERVAL) {
    lastFirebase = now;

    FirebaseJson sensor;
    sensor.set("ax", ax);
    sensor.set("ay", ay);
    sensor.set("az", az);
    sensor.set("mag", mag);
    sensor.set("lat", gpsLat);
    sensor.set("lng", gpsLng);
    sensor.set("speed", gpsSpd);
    sensor.set("gpsValid", gpsValid);

    Firebase.setJSON(fbdo, "/sensor/latest", sensor);
  }
}