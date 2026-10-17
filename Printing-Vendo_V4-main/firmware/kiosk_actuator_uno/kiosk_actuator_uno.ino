#include <Arduino.h>

const uint8_t PIN_MOTOR_A4_DIR = 4;
const uint8_t PIN_MOTOR_A4_STEP = 5;
const uint8_t PIN_MOTOR_LETTER_STEP = 6;
const uint8_t PIN_MOTOR_LETTER_DIR = 7;
const uint8_t PIN_MOTOR_LONG_STEP = 10;
const uint8_t PIN_MOTOR_LONG_DIR = 11;
const uint8_t PIN_STEPPER_ENABLE = 12;
const uint8_t PIN_HOPPER_5_SENSOR = 2;
const uint8_t PIN_HOPPER_1_SENSOR = 3;
const uint8_t PIN_HOPPER_5_RELAY = 8;
const uint8_t PIN_HOPPER_1_RELAY = 9;
const uint8_t PIN_STATUS_LED = 13;
const uint8_t HOPPER_RELAY_ON = HIGH;
const uint8_t HOPPER_RELAY_OFF = LOW;

const unsigned long HEARTBEAT_INTERVAL_MS = 3500;
const unsigned long HOPPER_NO_COIN_TIMEOUT_MS = 4000;
const unsigned long SENSOR_DEBOUNCE_MS = 15;
const unsigned long MOTOR_STEP_INTERVAL_MS = 2;
const unsigned long MOTOR_STEP_HIGH_MS = 1;
const uint8_t COMMAND_QUEUE_SIZE = 220;

enum Action : uint8_t { ACTION_NONE, ACTION_HOPPER_5, ACTION_HOPPER_1, ACTION_DISPENSE_5, ACTION_CHANGE_BATCH_5, ACTION_DISPENSE_END, ACTION_A4, ACTION_LETTER, ACTION_LONG };
enum HopperPhase : uint8_t { HOPPER_IDLE, HOPPER_RUNNING };

struct ActionRequest {
  Action action;
  uint16_t targetCoins;
  bool batchDispense;
  bool groupedBatch;
};

ActionRequest actionQueue[COMMAND_QUEUE_SIZE];
uint8_t queueHead = 0;
uint8_t queueTail = 0;
uint8_t queueCount = 0;
String commandBuffer;
unsigned long lastHeartbeatAt = 0;

HopperPhase hopperPhase = HOPPER_IDLE;
unsigned long hopperStartedAt = 0;
unsigned long lastCoinAt = 0;
unsigned long sensorCandidateAt = 0;
unsigned long sensorClearAt = 0;
uint8_t activeRelayPin = 0;
uint8_t activeSensorPin = 0;
uint8_t rawSensorState = HIGH;
uint8_t stableSensorState = HIGH;
uint8_t activeDenomination = 0;
uint8_t dispensedCoinCount = 0;
uint8_t targetCoinCount = 1;
bool activeBatchDispense = false;
bool activeGroupedBatch = false;
bool sensorSawClear = false;

bool motorActive = false;
uint8_t motorStepPin = 0;
uint8_t motorDirPin = 0;
uint16_t motorStepsRemaining = 0;
uint16_t motorStepCount = 0;
unsigned long motorLastStepAt = 0;
bool motorStepHigh = false;
const char* activeTrayName = "";

bool enqueue(Action action) {
  if (queueCount >= COMMAND_QUEUE_SIZE) return false;
  actionQueue[queueTail] = {action, 1, false, false};
  queueTail = (queueTail + 1) % COMMAND_QUEUE_SIZE;
  ++queueCount;
  return true;
}

bool enqueueDispense(uint16_t targetCoins) {
  if (queueCount >= COMMAND_QUEUE_SIZE) return false;
  actionQueue[queueTail] = {ACTION_DISPENSE_5, targetCoins, true, false};
  queueTail = (queueTail + 1) % COMMAND_QUEUE_SIZE;
  ++queueCount;
  return true;
}

ActionRequest dequeue() {
  if (queueCount == 0) return {ACTION_NONE, 0, false, false};
  const ActionRequest request = actionQueue[queueHead];
  queueHead = (queueHead + 1) % COMMAND_QUEUE_SIZE;
  --queueCount;
  return request;
}

bool enqueueChangeBatch5(uint16_t targetCoins) {
  if (queueCount >= COMMAND_QUEUE_SIZE) return false;
  actionQueue[queueTail] = {ACTION_CHANGE_BATCH_5, targetCoins, false, true};
  queueTail = (queueTail + 1) % COMMAND_QUEUE_SIZE;
  ++queueCount;
  return true;
}

void handleCommand(const String& command) {
  if (command.equalsIgnoreCase("PING")) {
    Serial.println(F("PONG"));
    return;
  }

  if (command.equalsIgnoreCase("DISPENSE:END")) {
    if (!enqueue(ACTION_DISPENSE_END)) Serial.println(F("ERROR:QUEUE_FULL"));
    return;
  }

  if (command.startsWith("DISPENSE:BATCH:")) {
    const long requestedCoins = command.substring(15).toInt();
    if (requestedCoins < 1 || requestedCoins > 200) {
      Serial.println(F("ERROR:INVALID_DISPENSE_COUNT"));
    } else if (!enqueueChangeBatch5(static_cast<uint16_t>(requestedCoins))) {
      Serial.println(F("ERROR:QUEUE_FULL"));
    }
    return;
  }

  if (command.startsWith("DISPENSE:")) {
    const long requestedCoins = command.substring(9).toInt();
    if (requestedCoins < 1 || requestedCoins > 200) {
      Serial.println(F("ERROR:INVALID_DISPENSE_COUNT"));
    } else if (!enqueueDispense(static_cast<uint16_t>(requestedCoins))) {
      Serial.println(F("ERROR:QUEUE_FULL"));
    }
    return;
  }

  Action action = ACTION_NONE;
  if (command.equalsIgnoreCase("HOPPER:5:DISPENSE")) action = ACTION_HOPPER_5;
  else if (command.equalsIgnoreCase("HOPPER:1:DISPENSE")) action = ACTION_HOPPER_1;
  else if (command.equalsIgnoreCase("MOTOR:A4:FEED")) action = ACTION_A4;
  else if (command.equalsIgnoreCase("MOTOR:LETTER:FEED")) action = ACTION_LETTER;
  else if (command.equalsIgnoreCase("MOTOR:LONG:FEED")) action = ACTION_LONG;

  if (action == ACTION_NONE) {
    Serial.print(F("ERROR:UNKNOWN_COMMAND:"));
    Serial.println(command);
  } else if (!enqueue(action)) {
    Serial.println(F("ERROR:QUEUE_FULL"));
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

void startHopper(uint8_t relayPin, uint8_t sensorPin, uint8_t denomination, uint16_t targetCoins, bool batchDispense, bool groupedBatch, unsigned long now) {
  activeRelayPin = relayPin;
  activeSensorPin = sensorPin;
  activeDenomination = denomination;
  dispensedCoinCount = 0;
  targetCoinCount = targetCoins;
  activeBatchDispense = batchDispense;
  activeGroupedBatch = groupedBatch;
  rawSensorState = digitalRead(sensorPin);
  stableSensorState = rawSensorState;
  sensorSawClear = stableSensorState == HIGH;
  sensorCandidateAt = now;
  hopperStartedAt = now;
  lastCoinAt = now;
  hopperPhase = HOPPER_RUNNING;
  digitalWrite(relayPin, HOPPER_RELAY_ON);
  digitalWrite(PIN_STATUS_LED, HIGH);
}

void finishHopper(bool sensorDetected) {
  digitalWrite(PIN_HOPPER_5_RELAY, HOPPER_RELAY_OFF);
  digitalWrite(PIN_HOPPER_1_RELAY, HOPPER_RELAY_OFF);
  digitalWrite(PIN_STATUS_LED, LOW);
  hopperPhase = HOPPER_IDLE;
  if (!sensorDetected) {
    Serial.println(F("WARN:HOPPER_ERROR"));
    queueHead = queueTail;
    queueCount = 0;
  }
  if (activeGroupedBatch) {
    if (sensorDetected) {
      Serial.print(F("DISPENSE:COINS_DONE:"));
      Serial.println(dispensedCoinCount);
    }
  } else if (activeBatchDispense) {
    if (sensorDetected) Serial.println(F("DISPENSE:DONE"));
  } else {
    Serial.print(F("ACK:HOPPER:"));
    Serial.print(activeDenomination);
    Serial.println(sensorDetected ? F(":SENSOR") : F(":TIMED"));
  }
}

void pollHopper(unsigned long now) {
  if (hopperPhase != HOPPER_RUNNING) return;

  const uint8_t reading = digitalRead(activeSensorPin);
  if (reading != rawSensorState) {
    rawSensorState = reading;
    sensorCandidateAt = now;
  } else if (reading != stableSensorState && now - sensorCandidateAt >= SENSOR_DEBOUNCE_MS) {
    stableSensorState = reading;
    if (stableSensorState == HIGH) sensorSawClear = true;
    else if (sensorSawClear) {
      sensorSawClear = false;
      ++dispensedCoinCount;
      lastCoinAt = now;
      if (dispensedCoinCount >= targetCoinCount) {
        finishHopper(true);
        return;
      }
    }
  }

  if (now - lastCoinAt >= HOPPER_NO_COIN_TIMEOUT_MS) finishHopper(false);
}

void startMotor(uint8_t stepPin, uint8_t dirPin, uint16_t steps, const char* tray) {
  motorStepPin = stepPin;
  motorDirPin = dirPin;
  motorStepsRemaining = steps;
  motorStepCount = 0;
  motorStepHigh = false;
  activeTrayName = tray;
  motorActive = true;
  digitalWrite(PIN_STEPPER_ENABLE, LOW);
  digitalWrite(dirPin, HIGH);
}

void finishMotor() {
  digitalWrite(motorStepPin, LOW);
  digitalWrite(PIN_STEPPER_ENABLE, HIGH);
  motorActive = false;
  Serial.print(F("ACK:MOTOR:"));
  Serial.println(activeTrayName);
}

void pollMotor(unsigned long now) {
  if (!motorActive || now - motorLastStepAt < (motorStepHigh ? MOTOR_STEP_HIGH_MS : MOTOR_STEP_INTERVAL_MS)) return;
  motorLastStepAt = now;

  if (motorStepHigh) {
    digitalWrite(motorStepPin, LOW);
    motorStepHigh = false;
    ++motorStepCount;
    --motorStepsRemaining;
    if (motorStepsRemaining == 0) finishMotor();
  } else {
    digitalWrite(motorStepPin, HIGH);
    motorStepHigh = true;
  }
}

void startNextAction(unsigned long now) {
  if (hopperPhase != HOPPER_IDLE || motorActive || queueCount == 0) return;
  const ActionRequest request = dequeue();
  switch (request.action) {
    case ACTION_HOPPER_5: startHopper(PIN_HOPPER_5_RELAY, PIN_HOPPER_5_SENSOR, 5, 1, false, false, now); break;
    case ACTION_HOPPER_1: startHopper(PIN_HOPPER_1_RELAY, PIN_HOPPER_1_SENSOR, 1, 1, false, false, now); break;
    case ACTION_DISPENSE_5: startHopper(PIN_HOPPER_5_RELAY, PIN_HOPPER_5_SENSOR, 5, request.targetCoins, request.batchDispense, false, now); break;
    case ACTION_CHANGE_BATCH_5: startHopper(PIN_HOPPER_5_RELAY, PIN_HOPPER_5_SENSOR, 5, request.targetCoins, false, request.groupedBatch, now); break;
    case ACTION_DISPENSE_END: Serial.println(F("DISPENSE:DONE")); break;
    case ACTION_A4: startMotor(PIN_MOTOR_A4_STEP, PIN_MOTOR_A4_DIR, 850, "A4"); break;
    case ACTION_LETTER: startMotor(PIN_MOTOR_LETTER_STEP, PIN_MOTOR_LETTER_DIR, 850, "LETTER"); break;
    case ACTION_LONG: startMotor(PIN_MOTOR_LONG_STEP, PIN_MOTOR_LONG_DIR, 950, "LONG"); break;
    default: break;
  }
}

void setup() {
  Serial.begin(115200);
  commandBuffer.reserve(64);
  pinMode(PIN_STATUS_LED, OUTPUT);

  digitalWrite(PIN_HOPPER_5_RELAY, HOPPER_RELAY_OFF);
  digitalWrite(PIN_HOPPER_1_RELAY, HOPPER_RELAY_OFF);
  pinMode(PIN_HOPPER_5_RELAY, OUTPUT);
  pinMode(PIN_HOPPER_1_RELAY, OUTPUT);
  pinMode(PIN_HOPPER_5_SENSOR, INPUT_PULLUP);
  pinMode(PIN_HOPPER_1_SENSOR, INPUT_PULLUP);

  pinMode(PIN_STEPPER_ENABLE, OUTPUT);
  digitalWrite(PIN_STEPPER_ENABLE, HIGH);
  pinMode(PIN_MOTOR_A4_STEP, OUTPUT);
  pinMode(PIN_MOTOR_A4_DIR, OUTPUT);
  pinMode(PIN_MOTOR_LETTER_STEP, OUTPUT);
  pinMode(PIN_MOTOR_LETTER_DIR, OUTPUT);
  pinMode(PIN_MOTOR_LONG_STEP, OUTPUT);
  pinMode(PIN_MOTOR_LONG_DIR, OUTPUT);
  Serial.println(F("BOOT:KIOSK_ACTUATOR_V1_ONLINE"));
}

void loop() {
  const unsigned long now = millis();
  readSerialCommands();
  startNextAction(now);
  pollHopper(now);
  pollMotor(now);
  if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatAt = now;
    Serial.println(F("HEARTBEAT"));
  }
}