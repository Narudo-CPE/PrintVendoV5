# Legacy Combined Arduino Firmware (Archived)

> The single-board sketch described below is retained for historical reference only. Do not flash it for the current dual-Arduino architecture. Use the current sketches and instructions at the end of this document.

This document outlines the complete hardware wiring, pin assignments, electrical protection, and flashing instructions for the **Autonomous Self-Service Print Kiosk** microcontroller.

---

## 📋 Hardware Peripherals Overview

| Component | Make / Model | Signal / Interface | Arduino Pin | Notes |
|---|---|---|---|---|
| **Microcontroller** | Arduino Uno R3 | USB-Serial (115200 8N1) | Pin 0 (RX), Pin 1 (TX) | Handshake & telemetric heartbeat with Host (Pi/PC) |
| **Coin Acceptor** | Allan 1239A Pro Max | Active LOW Pulse (INT0) | **Pin 2** | Needs 10k/20k voltage divider if 12V pulse line! |
| **Coin Inhibit Line** | Allan 1239A | Active LOW Enable | **Pin 8** | LOW = Enabled, HIGH = Inhibited |
| **Bill Acceptor** | TB74 Pulse Bill Acceptor | Active LOW Pulse (INT1) | **Pin 3** | Interrupt-driven pulse train detector |
| **Bill Inhibit Line** | TB74 | Active LOW Enable | **Pin 9** | LOW = Enabled, HIGH = Inhibited |
| **A4 Paper Stepper** | NEMA17 HD40 + DRV8825 | STEP / DIR | **Step: 4, Dir: 5** | Feeds A4 paper into printer intake |
| **Letter Paper Stepper** | NEMA17 HD40 + DRV8825 | STEP / DIR | **Step: 6, Dir: 7** | Feeds Short/Letter paper into intake |
| **Long Paper Stepper** | NEMA17 HD40 + DRV8825 | STEP / DIR | **Step: 10, Dir: 11** | Feeds Legal (8.5x13") paper |
| **Stepper Sleep/Enable** | DRV8825 (Shared) | Active LOW Enable | **Pin 12** | De-energizes coils when idle (prevents heating) |
| **₱5 Coin Hopper** | 220V AC Motor | 5V Optocoupled Relay | **Pin A0** | Active LOW relay trigger |
| **₱1 Coin Hopper** | 220V AC Motor | 5V Optocoupled Relay | **Pin A1** | Active LOW relay trigger |
| **₱5 Hopper Sensor** | Infrared Optical Switch | Active LOW Coin Pass | **Pin A2** | Confirms physical coin ejection |
| **₱1 Hopper Sensor** | Infrared Optical Switch | Active LOW Coin Pass | **Pin A3** | Confirms physical coin ejection |
| **Status / Heartbeat** | Built-in LED | Digital Output | **Pin 13** | Blinks on ping / heartbeat / hopper activity |

The Uno R3 has only two external hardware-interrupt pins. Coin and bill pulse inputs use pins 2 (INT0) and 3 (INT1); hopper sensors on A2/A3 are polled with software debounce.

---

## ⚡ Electrical Wiring & Protection Guidelines

### 1. Allan 1239A and TB74 12V Pulse Lines
> [!WARNING]
> Allan 1239A and TB74 acceptors are powered by a **12V DC power supply**. Their pulse lines may output 12V unless set to open-collector with an internal pull-up. Connecting 12V directly to an Arduino pin will permanently damage the ATmega328P.
- Use a **resistor voltage divider** (e.g. 10kΩ series resistor and 4.7kΩ to GND) or an **optocoupler (PC817)** between the acceptor pulse line and Arduino Pin 2 / Pin 3.
- If using the acceptor's open-collector mode with common ground, connect the pulse line directly to Pin 2 / Pin 3 and enable the Arduino's internal pull-up (`INPUT_PULLUP`).
- **Always tie the 12V power supply ground (GND) to the Arduino ground (GND)**.

### 2. DRV8825 Stepper Motor Drivers
- Connect the **VMOT** and **GND** pins of the DRV8825 drivers to your **12V or 24V stepper power supply** with a **100µF electrolytic capacitor** across VMOT and GND close to each driver.
- Set the DRV8825 current limit via the onboard potentiometer (`Vref`):
  $$\text{Current Limit} = \frac{V_{ref}}{0.66}$$
  For a 1.0A NEMA17 motor, adjust $V_{ref} \approx 0.65\text{V}$.
- Tie **RST** and **SLP** pins together on each DRV8825.
- Connect **EN** to Arduino **Pin 12** so motors are energized only during feed cycles, keeping them completely cool during standby.

### 3. 220V AC Coin Hoppers & Relays
- Use an **optocoupled 2-channel 5V relay module** (rated for 250V AC 10A).
- Wire the 220V AC Live wire through the **Normally Open (NO)** and **Common (COM)** terminals of each relay.
- Keep the high-voltage 220V AC wiring physically insulated and physically separated from low-voltage logic wires.

---

## 🔄 Serial Protocol Reference (115200 Baud, 8N1)

### Commands Sent from Raspberry Pi to Arduino:
| Command | Action |
|---|---|
| `PING\n` | Heartbeat query. Arduino responds with `PONG\n`. |
| `ACCEPTORS:ENABLE\n` | Wakes up coin & bill acceptors (Pin 8 & Pin 9 set LOW). |
| `ACCEPTORS:DISABLE\n` | Puts acceptors in standby (Pin 8 & Pin 9 set HIGH). |
| `MOTOR:A4:FEED\n` | Pulses DRV8825 on Pin 4 to advance 1 sheet of A4. Responds `ACK:MOTOR:A4\n`. |
| `MOTOR:LETTER:FEED\n` | Pulses DRV8825 on Pin 6 to advance 1 sheet of Letter. Responds `ACK:MOTOR:LETTER\n`. |
| `MOTOR:LONG:FEED\n` | Pulses DRV8825 on Pin 10 to advance 1 sheet of Long. Responds `ACK:MOTOR:LONG\n`. |
| `HOPPER:5:DISPENSE\n` | Energizes ₱5 hopper relay on Pin A0 until 1 coin is ejected. Responds `ACK:HOPPER:5\n`. |
| `HOPPER:1:DISPENSE\n` | Energizes ₱1 hopper relay on Pin A1 until 1 coin is ejected. Responds `ACK:HOPPER:1\n`. |

### Messages Sent from Arduino to Raspberry Pi:
| Message | Meaning |
|---|---|
| `PONG\n` | Response to `PING\n` handshake. |
| `HEARTBEAT\n` | Periodic alive signal (emitted every ~3.5 seconds). |
| `COIN:1\n` / `COIN:5\n` / `COIN:10\n` / `COIN:20\n` | Verified coin pulses received from Allan 1239A. |
| `BILL:20\n` / `BILL:50\n` / `BILL:100\n` / `BILL:200\n` | Verified bill pulses received from TB74. |
| `ACK:ACCEPTORS:ENABLED\n` | Acceptors are active and ready. |
| `ACK:ACCEPTORS:DISABLED\n` | Acceptors are safely inhibited. |
| `ACK:MOTOR:<TRAY>\n` | Paper feed stepper motion completed. |
| `ACK:HOPPER:<VAL>\n` | Change coin dispensed. |

---

## Current Dual-Arduino Firmware

Both current sketches are non-blocking: their `loop()` functions continuously poll serial input, pulse timeouts, heartbeats, hopper sensors, and motor-step state using `millis()`. They contain no `delay()` calls. Do not combine the board roles; the backend expects two serial devices.

### Acceptor board

Flash `firmware/kiosk_acceptor_uno/kiosk_acceptor_uno.ino` to Arduino 1. It owns the Allan 1239A coin pulse input on pin 2, TB74 bill pulse input on pin 3, and their inhibit outputs on pins 8 and 9. It sends `COIN:<peso>` and `BILL:<peso>` events and accepts `PING` plus `ACCEPTORS:ENABLE` / `ACCEPTORS:DISABLE`.

### Actuator board

Flash `firmware/kiosk_actuator_uno/kiosk_actuator_uno.ino` to Arduino 2. Its current digital-only map is: hopper sensors D2/D3, stepper STEP/DIR D4-D7 and D10-D11, hopper relays D8/D9, shared stepper enable D12, and status LED D13. The hopper relay inputs are active-HIGH: HIGH runs the motor and LOW stops it. D0/RX and D1/TX remain unused by peripherals for USB serial. Rewire the hardware to match before powering the board. It accepts `PING`, `MOTOR:<TRAY>:FEED`, and `HOPPER:<1|5>:DISPENSE`. Standalone `DISPENSE:<count>` runs that many ₱5 coins and replies `DISPENSE:DONE`; the backend's grouped payout uses `DISPENSE:BATCH:<count>` for ₱5 coins, queues any ₱1 coins, then sends `DISPENSE:END`. Arduino reports each grouped ₱5 batch as `DISPENSE:COINS_DONE:<count>` and sends final `DISPENSE:DONE` only after all queued payout actions finish. The sensor uses `INPUT_PULLUP` with non-blocking 15 ms debounce. If no coin sensor edge is counted for 4 seconds while dispensing, both hopper relays are switched off, remaining queued payout actions are discarded, and `WARN:HOPPER_ERROR` is sent. Legacy single-coin hopper acknowledgements end in `:SENSOR` when a coin sensor transition is seen or `:TIMED` on timeout.

### Flashing and serial ports

Compile and upload each sketch separately in Arduino IDE by opening the `.ino` file in its matching folder and selecting **Arduino Uno** plus that board's USB port. The default host mapping is acceptor `/dev/ttyACM0` and actuator `/dev/ttyACM1` on Linux, or `COM3` and `COM4` on Windows. Override with `ACCEPTOR_SERIAL_PORT` and `ACTUATOR_SERIAL_PORT` in `.env` if the assigned ports differ.

The hopper actuator switches its relay off at the first debounced sensor transition, or after 250 ms / the 1200 ms safety limit if no transition is detected. Confirm relay polarity, sensor polarity, step calibration, pulse denomination profiles, and mains isolation on the actual hardware before enabling acceptors or permitting payouts.
