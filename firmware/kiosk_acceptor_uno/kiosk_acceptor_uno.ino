#include <Arduino.h>

const uint8_t PIN_COIN_PULSE = 2;
const uint8_t PIN_COIN_INHIBIT = 8;
const uint8_t PIN_BILL_PULSE = 3;
const uint8_t PIN_BILL_INHIBIT = 9;
const uint8_t PIN_STATUS_LED = 13;

const unsigned long COIN_PULSE_TIMEOUT_MS = 280;
const unsigned long BILL_PULSE_TIMEOUT_MS = 350;
const unsigned long COIN_DEBOUNCE_MS = 18;
const unsigned long BILL_DEBOUNCE_MS = 25;
const unsigned long HEARTBEAT_INTERVAL_MS = 3500;

volatile unsigned int coinPulseCount = 0;
volatile unsigned long lastCoinPulseAt = 0;
volatile unsigned int billPulseCount = 0;
volatile unsigned long lastBillPulseAt = 0;

bool acceptorsEnabled = false;
unsigned long lastHeartbeatAt = 0;
String commandBuffer;

void coinPulseISR() {
  const unsigned long now = millis();
  if (now - lastCoinPulseAt >= COIN_DEBOUNCE_MS) {
    ++coinPulseCount;
    lastCoinPulseAt = now;
  }
}

void billPulseISR() {
  const unsigned long now = millis();
  if (now - lastBillPulseAt >= BILL_DEBOUNCE_MS) {
    ++billPulseCount;
    lastBillPulseAt = now;
  }
}

int coinValue(unsigned int pulses) {
  if (pulses == 1) return 1;
  if (pulses == 5) return 5;
  if (pulses == 10) return 10;
  if (pulses == 20) return 20;
  if (pulses > 0 && pulses <= 20) return pulses;
  return 0;
}

int billValue(unsigned int pulses) {
  if (pulses == 1) return 10;
  if (pulses == 2) return 20;
  if (pulses == 5) return 50;
  if (pulses == 10) return 100;
  if (pulses == 20) return 200;
  return 0;
}

void setAcceptorsEnabled(bool enabled) {
  acceptorsEnabled = enabled;
  digitalWrite(PIN_COIN_INHIBIT, enabled ? LOW : HIGH);
  digitalWrite(PIN_BILL_INHIBIT, enabled ? LOW : HIGH);
  Serial.println(enabled ? F("ACK:ACCEPTORS:ENABLED") : F("ACK:ACCEPTORS:DISABLED"));
}

void handleCommand(const String& command) {
  if (command.equalsIgnoreCase("PING")) {
    Serial.println(F("PONG"));
  } else if (command.equalsIgnoreCase("ACCEPTORS:ENABLE")) {
    setAcceptorsEnabled(true);
  } else if (command.equalsIgnoreCase("ACCEPTORS:DISABLE")) {
    setAcceptorsEnabled(false);
  } else {
    Serial.print(F("ERROR:UNKNOWN_COMMAND:"));
    Serial.println(command);
  }
}

void readSerialCommands() {
  while (Serial.available() > 0) {
    const char value = static_cast<char>(Serial.read());
    if (value == '\n' || value == '\r') {
      if (commandBuffer.length() > 0) handleCommand(commandBuffer);
      commandBuffer = "";
    } else if (commandBuffer.length() < 60) {
      commandBuffer += value;
    } else {
      commandBuffer = "";
    }
  }
}

void finishPulseTrain(bool coin) {
  unsigned int pulses;
  if (coin) {
    noInterrupts();
    pulses = coinPulseCount;
    coinPulseCount = 0;
    interrupts();
    const int value = coinValue(pulses);
    if (value > 0) {
      Serial.print(F("COIN:"));
      Serial.println(value);
    } else {
      Serial.print(F("WARN:UNRECOGNIZED_COIN_PULSES:"));
      Serial.println(pulses);
    }
  } else {
    noInterrupts();
    pulses = billPulseCount;
    billPulseCount = 0;
    interrupts();
    const int value = billValue(pulses);
    if (value > 0) {
      Serial.print(F("BILL:"));
      Serial.println(value);
    } else {
      Serial.print(F("WARN:UNRECOGNIZED_BILL_PULSES:"));
      Serial.println(pulses);
    }
  }
}

void pollPulseTrains(unsigned long now) {
  unsigned int coinCount;
  unsigned long coinAt;
  unsigned int billCount;
  unsigned long billAt;

  noInterrupts();
  coinCount = coinPulseCount;
  coinAt = lastCoinPulseAt;
  billCount = billPulseCount;
  billAt = lastBillPulseAt;
  interrupts();

  if (coinCount > 0 && now - coinAt >= COIN_PULSE_TIMEOUT_MS) finishPulseTrain(true);
  if (billCount > 0 && now - billAt >= BILL_PULSE_TIMEOUT_MS) finishPulseTrain(false);
}

void setup() {
  Serial.begin(115200);
  commandBuffer.reserve(64);
  pinMode(PIN_STATUS_LED, OUTPUT);
  pinMode(PIN_COIN_PULSE, INPUT_PULLUP);
  pinMode(PIN_COIN_INHIBIT, OUTPUT);
  pinMode(PIN_BILL_PULSE, INPUT_PULLUP);
  pinMode(PIN_BILL_INHIBIT, OUTPUT);
  setAcceptorsEnabled(false);
  attachInterrupt(digitalPinToInterrupt(PIN_COIN_PULSE), coinPulseISR, FALLING);
  attachInterrupt(digitalPinToInterrupt(PIN_BILL_PULSE), billPulseISR, FALLING);
  Serial.println(F("BOOT:KIOSK_ACCEPTOR_V1_ONLINE"));
}

void loop() {
  const unsigned long now = millis();
  readSerialCommands();
  pollPulseTrains(now);
  if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatAt = now;
    Serial.println(F("HEARTBEAT"));
  }
}
