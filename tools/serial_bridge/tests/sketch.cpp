#include <Arduino.h>
#include <cassert>
uint64_t fakeTime = 0;
FakeSerial Serial;
#include "usb_simulator.ino"
void send(const char* command) { Serial.input = command; loop(); }
int main() {
  setup(); loop(); assert(Serial.output.empty());
  send("START 1234567890abcdef1234567890abcdef\n"); assert(Serial.output.empty());
  send("SYNC 10000000-0000-4000-8000-000000000001 1234567890abcdef1234567890abcdef 1793649600123 0.8 1.8\n");
  assert(Serial.output.find("\"type\":\"ready\"") != std::string::npos);
  assert(Serial.output.find("\"type\":\"event\"") == std::string::npos);
  Serial.output.clear();
  send("START bad\n"); assert(Serial.output.empty());
  send("START 1234567890abcdef1234567890abcdef\n");
  assert(sequence == 2);
  assert(Serial.output.find("\"sequence\":1") != std::string::npos);
  assert(Serial.output.find("\"sequence\":2") != std::string::npos);
  assert(Serial.output.find("\"imu_id\":2") != std::string::npos);
  Serial.output.clear(); fakeTime += 1000; loop(); assert(sequence == 5);
  send("STOP\n"); Serial.output.clear(); fakeTime += 1000; loop(); assert(Serial.output.empty());
  // STOP / USB reset cannot reuse a challenge or resume with an invented epoch.
  send("START 1234567890abcdef1234567890abcdef\n"); assert(Serial.output.empty());
  send("SYNC 10000000-0000-4000-8000-000000000001 1234567890abcdef1234567890abcdef 1793649600123 0.8 1.8\n");
  Serial.output.clear(); fakeTime += 501;
  send("START 1234567890abcdef1234567890abcdef\n"); assert(Serial.output.empty());
  // An overflowing command is discarded through its newline.
  Serial.input = std::string(250, 'x') + "\n"; loop(); assert(Serial.output.empty());
}
