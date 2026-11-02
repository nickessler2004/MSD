#pragma once
#include <cctype>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
extern uint64_t fakeTime;
inline void delay(unsigned ms) { fakeTime += ms; }
struct FakeSerial {
  std::string input, output;
  void begin(unsigned) {}
  int available() { return input.size(); }
  char read() { char c = input.front(); input.erase(0, 1); return c; }
  void print(const char* line) { output += line; }
  void printf(const char* format, ...) {
    char buffer[1024]; va_list args; va_start(args, format);
    vsnprintf(buffer, sizeof(buffer), format, args); va_end(args); output += buffer;
  }
};
extern FakeSerial Serial;
