#pragma once
#include <cstdint>
extern uint64_t fakeTime;
inline int64_t esp_timer_get_time() { return fakeTime * 1000; }
