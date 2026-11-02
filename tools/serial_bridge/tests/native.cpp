#include "telemetry.h"
#include <cassert>
#include <cstring>
#include <limits>
int main() {
  assert(msd::validThresholds(.8, 1.8));
  assert(!msd::validThresholds(0, 1.8));
  assert(!msd::validThresholds(2, 1));
  assert(!msd::validThresholds(1, 11));
  assert(!msd::validThresholds(NAN, 2));
  assert(!msd::classify(std::nextafter(.8, 0.), .8, 1.8));
  assert(!strcmp(msd::classify(.8, .8, 1.8), "warning"));
  assert(!strcmp(msd::classify(1.8, .8, 1.8), "warning"));
  assert(!strcmp(msd::classify(std::nextafter(1.8, 2.), .8, 1.8), "critical"));
  msd::Clock clock;
  assert(!clock.valid(0));
  assert(!clock.start(0));
  assert(!clock.prepare(0, 0));
  assert(clock.prepare(1793649600123ULL, 5000000000ULL));
  assert(!clock.start(5000000501ULL));
  assert(clock.prepare(1793649600123ULL, 5000000000ULL));
  assert(clock.start(5000000500ULL));
  assert(clock.utc(5000001000ULL) == 1793649601123ULL);
  assert(clock.valid(5000059999ULL));
  assert(!clock.valid(5000060000ULL));
  assert(!clock.valid(4999999999ULL));
  uint64_t sequence = 0;
  uint8_t random[16] = {};
  char id[37], line[640];
  for (unsigned tick = 0; tick < 6; ++tick) {
    auto first = msd::simulate(tick, 1, .8, 1.8);
    auto second = msd::simulate(tick, 2, .8, 1.8);
    assert(first.x != second.x || first.y != second.y || first.z != second.z);
    for (unsigned imu = 1; imu <= 3; ++imu) {
      random[15]++;
      msd::uuid(random, id);
      auto a = msd::simulate(tick, imu, .8, 1.8);
      bool emitted = msd::event(line, sizeof(line), "10000000-0000-4000-8000-000000000001", id,
                               sequence + 1, imu, 1793649600123ULL, a, .8, 1.8);
      assert(emitted == (msd::classify(msd::magnitude(a), .8, 1.8) != nullptr));
      if (emitted) { ++sequence; std::fputs(line, stdout); }
    }
  }
  assert(sequence == 12);
  assert(!msd::event(line, 10, "run", id, 1, 1, 1793649600123ULL, {2,0,0}, .8, 1.8));
}
