// Adafruit ESP32-S3 Feather / Reverse TFT. See board IDs in docs/ESP32_USB_TEST.md. No IMU, BLE, Wi-Fi or TFT drivers.
#include <Arduino.h>
#include <esp_system.h>
#include <esp_timer.h>
#include "telemetry.h"

msd::Clock sourceClock;
char runId[37] = {}, nonce[33] = {}, command[192];
size_t used = 0;
bool discard = false;
double t1 = 0.8, t2 = 1.8;
uint64_t sequence = 0, nextSample = 0;
unsigned tick = 0;
uint64_t uptimeMs() { return esp_timer_get_time() / 1000; }
bool hexToken(const char* value, size_t length, bool hyphens = false) {
  if (strlen(value) != length) return false;
  for (size_t i = 0; i < length; ++i) {
    if (hyphens && (i == 8 || i == 13 || i == 18 || i == 23)) {
      if (value[i] != '-') return false;
    } else if (!isxdigit((unsigned char)value[i])) return false;
  }
  return true;
}
void handleCommand() {
  if (!strcmp(command, "STOP")) { sourceClock.running = false; nonce[0] = '\0'; return; }
  char run[37], challenge[33], extra;
  unsigned long long utc;
  double first, second;
  if (sscanf(command, "SYNC %36s %32s %llu %lf %lf %c", run, challenge, &utc, &first, &second, &extra) == 5) {
    sourceClock.running = false; nonce[0] = '\0';
    if (!hexToken(run, 36, true) || !hexToken(challenge, 32) ||
        !msd::validThresholds(first, second) || !sourceClock.prepare(utc, uptimeMs())) return;
    strcpy(runId, run); strcpy(nonce, challenge);
    t1 = first; t2 = second; sequence = 0; tick = 0;
    // Control acknowledgement only. No acceleration emitted before START.
    Serial.printf("{\"type\":\"ready\",\"run_id\":\"%s\",\"nonce\":\"%s\",\"utc_ms\":%llu,\"t1\":%.17g,\"t2\":%.17g}\n", runId, nonce, utc, t1, t2);
  } else if (sscanf(command, "START %32s %c", challenge, &extra) == 1 && !strcmp(challenge, nonce)) {
    if (sourceClock.start(uptimeMs())) nextSample = uptimeMs();
    nonce[0] = '\0'; // Single-use challenge; replay cannot restart the stream.
  }
}
void setup() { Serial.begin(115200); }
void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      if (!discard) { command[used] = '\0'; handleCommand(); }
      used = 0; discard = false;
    } else if (!discard) {
      if (used + 1 < sizeof(command)) command[used++] = c;
      else { used = 0; discard = true; }
    }
  }
  uint64_t now = uptimeMs();
  if (sourceClock.valid(now) && now >= nextSample) {
    nextSample = now + 1000;
    for (unsigned imu = 1; imu <= 3; ++imu) {
      auto a = msd::simulate(tick, imu, t1, t2);
      if (!msd::classify(msd::magnitude(a), t1, t2)) continue;
      uint8_t random[16]; char id[37], line[640];
      esp_fill_random(random, sizeof(random)); msd::uuid(random, id);
      if (msd::event(line, sizeof(line), runId, id, sequence + 1, imu,
                     sourceClock.utc(now), a, t1, t2)) {
        ++sequence; Serial.print(line);
      }
    }
    ++tick;
  }
  delay(1);
}
