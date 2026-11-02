#pragma once
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <ctime>

namespace msd {
struct Acceleration { double x, y, z; };
inline double magnitude(Acceleration a) { return std::hypot(std::hypot(a.x, a.y), a.z); }
inline bool validThresholds(double t1, double t2) {
  return std::isfinite(t1) && std::isfinite(t2) && 0 < t1 && t1 < t2 && t2 <= 10;
}
inline const char* classify(double a, double t1, double t2) {
  return a < t1 ? nullptr : (a <= t2 ? "warning" : "critical");
}
// Independent phase per IMU, in g. Axis-aligned boundary samples avoid rounding
// ambiguity; the final sample exercises all three nonzero components.
inline Acceleration simulate(unsigned tick, unsigned imu, double t1, double t2) {
  switch ((tick + imu - 1) % 6) {
    case 0: return {0.1*t1, 0.2*t1, 0.3*t1};
    case 1: return {t1, 0, 0};
    case 2: return {0, t2, 0};
    case 3: return {0, 0, t2 + 0.25};
    case 4: return {-0.1*t1, 0.2*t1, -0.3*t1};
    default: return {0.6*t2, 0.8*t2, 0.25*t2};
  }
}
struct Clock {
  uint64_t epoch = 0, anchor = 0;
  bool running = false;
  bool prepare(uint64_t utc, uint64_t uptime) {
    running = false; epoch = 0;
    // Reject uninitialized clocks; upper bound is 2100-01-01.
    if (utc < 1735689600000ULL || utc >= 4102444800000ULL) return false;
    epoch = utc; anchor = uptime; return true;
  }
  bool start(uint64_t uptime) {
    running = epoch && uptime >= anchor && uptime - anchor <= 500;
    return running;
  }
  bool valid(uint64_t uptime) const {
    return running && uptime >= anchor && uptime - anchor < 60000;
  }
  uint64_t utc(uint64_t uptime) const { return epoch + uptime - anchor; }
};
inline void uuid(const uint8_t* random, char* out) {
  uint8_t b[16];
  for (int i=0; i<16; ++i) b[i]=random[i];
  b[6]=(b[6]&15)|64; b[8]=(b[8]&63)|128;
  std::snprintf(out, 37,
    "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
    b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7],b[8],b[9],b[10],b[11],b[12],b[13],b[14],b[15]);
}
// Shared by actual firmware and native tests. Raw X/Y/Z stay on the board.
inline bool event(char* out, size_t size, const char* run, const char* id,
                  uint64_t sequence, unsigned imu, uint64_t utc,
                  Acceleration a, double t1, double t2) {
  double peak = magnitude(a);
  const char* severity = classify(peak, t1, t2);
  if (!severity) return false;
  time_t seconds = utc / 1000;
  struct tm parts;
  gmtime_r(&seconds, &parts);
  char date[24];
  strftime(date, sizeof(date), "%Y-%m-%dT%H:%M:%S", &parts);
  int length = std::snprintf(out, size,
    "{\"type\":\"event\",\"run_id\":\"%s\",\"id\":\"%s\",\"sequence\":%llu,\"imu_id\":%u,"
    "\"recorded_at\":\"%s.%03uZ\",\"magnitude\":%.17g,\"severity\":\"%s\","
    "\"t1\":%.17g,\"t2\":%.17g,\"latitude\":null,\"longitude\":null}\n",
    run, id, (unsigned long long)sequence, imu, date, (unsigned)(utc%1000), peak, severity, t1, t2);
  return length > 0 && (size_t)length < size;
}
}
