# Self-Service Print Kiosk (Raspberry Pi 4)

A local-first web application for an autonomous self-service print kiosk running on Raspberry Pi OS or Windows with two Arduino Uno R3 controllers.

---

## 🏗️ Architecture & Technology Stack

| Component | Technology | Purpose |
|---|---|---|
| **Backend Framework** | Python 3.11, FastAPI, Uvicorn | High-performance asynchronous REST & WebSocket server |
| **Frontend** | Plain HTML5, CSS3, Vanilla JS | Zero-build step; runs in Chromium kiosk mode pointed at local IP |
| **PDF Preview** | Mozilla PDF.js rendering to HTML5 `<canvas>` | Fast client-side page flip-through (display only; zero security risks) |
| **Authoritative Pricing** | Ghostscript (`gs`) + Pillow (PIL) | Server-side bitmap rasterization & non-white pixel density counting |
| **Printing Pipeline** | Gutenprint via CUPS (`lp`) | Per-page print dispatch matching software queue and hardware paper tray |
| **Hardware** | `DualArduinoHardware` | Independent acceptor and actuator Arduino serial links |
| **Payments** | PayMongo API (GCash QR, test/sandbox mode) + Cash Acceptors | Dual payment paths with offline fallbacks and auto-recovery |
| **Audit Notifications** | Telegram Bot API | Non-blocking transaction logging to owner's chat |
| **Local Database** | SQLite (WAL mode, single-file `kiosk.db`) | Sessions, file metadata, transactions, print jobs |
| **Realtime Updates** | WebSockets (`/ws/{session_id}`) | Live balance updates, connection health, print progress |

---

## 🔒 Raspberry Pi OS Kiosk Setup

### 1. Launch Chromium in kiosk mode

Configure the Raspberry Pi desktop to start Chromium with:

```text
--kiosk --noerrdialogs --disable-infobars --disable-features=TranslateUI,MediaRouter
```

Open the application at `http://localhost:3000`.

### 2. Start Chromium on boot

Create a systemd service that starts the kiosk browser on boot as the only app:

```ini
[Unit]
Description=Print Kiosk Browser
After=network.target

[Service]
Type=simple
User=pi
Environment=DISPLAY=:0
ExecStart=/usr/bin/chromium --noerrdialogs --disable-infobars --kiosk --disable-features=TranslateUI,MediaRouter http://localhost:3000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Then enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kiosk-browser.service
```

Disable TTY switching and lock the system down further:

```bash
sudo nano /etc/systemd/logind.conf
```

Set:

```ini
NAutoVTs=1
```

Then restart the service manager:

```bash
sudo systemctl restart systemd-logind
```

Run the browser as a restricted user with no shell/sudo access. Keep the kiosk account out of the sudoers list and avoid giving it a login shell.

### 3. In-app hardening

The kiosk app now blocks:

- right-click context menu
- selection drag/highlight in the kiosk shell
- accidental tab/window destruction with `beforeunload`
- reload/shortcut escape paths such as Ctrl+R, F5, F11, and F12

This is intentionally scoped to the local kiosk UI and does not affect the payment, upload, or printing logic.

### 4. USB flash-drive upload safety

For the USB flow, the kiosk must assume the drive is read-only and never auto-executes anything. Only PDF files are accepted. The app validates the file extension and MIME before touching the payload with any parser, and it explicitly avoids executing or trusting autorun/autoplay content.

## ⚙️ Hardware Specifications

- **Microcontrollers**: Two Arduino Uno R3 boards at 115200 baud, each with an independent USB serial connection.
- **Acceptor firmware**: [`firmware/kiosk_acceptor_uno/kiosk_acceptor_uno.ino`](firmware/kiosk_acceptor_uno/kiosk_acceptor_uno.ino).
- **Actuator firmware**: [`firmware/kiosk_actuator_uno/kiosk_actuator_uno.ino`](firmware/kiosk_actuator_uno/kiosk_actuator_uno.ino). See [FIRMWARE.md](FIRMWARE.md) for pinouts and flashing guidance.
- **Bill Acceptor**: TB74 pulse-based bill acceptor via acceptor Uno hardware interrupt pin 3 (INT1).
- **Coin Acceptor**: Allan 1239A Pro Max multi-coin pulse acceptor via acceptor Uno hardware interrupt pin 2 (INT0).
- **Coin Hoppers**: Actuator Uno controls 2x 220V AC hoppers (₱5: Pin A0, ₱1: Pin A1); supports **₱1 and ₱5 coins only**.
- **Hopper Sensors**: Polled on A2/A3 with debounce; they do not use hardware interrupts.
- **Paper Feeder**: Actuator Uno controls 3x NEMA17 HD40 stepper motors driven by DRV8825 drivers:
  - Motor 1: **A4** Paper Tray (Step: Pin 4, Dir: Pin 5)
  - Motor 2: **Letter** Paper Tray (Step: Pin 6, Dir: Pin 7)
  - Motor 3: **Long** (Legal 8.5x13") Paper Tray (Step: Pin 10, Dir: Pin 11)
  - Shared Driver Sleep/Enable: Pin 12 (Active LOW)

### Serial Protocol (Newline-Delimited Strings)
```
Pi -> Arduino:
  PING\n                  -> Handshake / heartbeat query
  ACCEPTORS:ENABLE\n      -> Wake TB74 bill acceptor & Allan 1239A coin acceptor
  ACCEPTORS:DISABLE\n     -> Disable acceptors (standby mode)
  MOTOR:A4:FEED\n         -> Feed 1 sheet of A4 paper
  MOTOR:LETTER:FEED\n     -> Feed 1 sheet of Letter paper
  MOTOR:LONG:FEED\n       -> Feed 1 sheet of Long paper
  HOPPER:5:DISPENSE\n     -> Dispense 1x ₱5 coin
  HOPPER:1:DISPENSE\n     -> Dispense 1x ₱1 coin

Arduino -> Pi:
  PONG\n                  -> Handshake acknowledge
  HEARTBEAT\n             -> Periodic alive ping
  COIN:<value>\n          -> e.g. COIN:1, COIN:5, COIN:10, COIN:20
  BILL:<value>\n          -> e.g. BILL:20, BILL:50, BILL:100, BILL:200
  ACK:MOTOR:<tray>\n      -> Motor feed step complete
  ACK:HOPPER:<val>\n      -> Coin ejected
```

---

---

## 🍓 Raspberry Pi 4 Deployment (Raspberry Pi OS 64-bit)

### 1. System Packages & CUPS Installation
```bash
sudo apt update
sudo apt install -y python3-pip python3-venv git ghostscript cups printer-driver-gutenprint
```

### 2. Configure CUPS & Printer Driver
1. Add the `pi` user to the `lpadmin` group:
   ```bash
   sudo usermod -aG lpadmin,dialout pi
   ```
2. Enable CUPS remote administration if desired:
   ```bash
   sudo cupsctl --remote-admin
   sudo systemctl restart cups
   ```
3. Connect the Epson L121 (or test L360) via USB.
4. Add the printer with Gutenprint driver:
   ```bash
   # List detected USB printers
   lpinfo -v | grep usb

   # Add printer (replace URI with your device URI)
   sudo lpadmin -p EPSON_L121 -E -v usb://EPSON/L121%20Series -m gutenprint.5.3://escp2-l120/expert
   sudo cupsenable EPSON_L121
   sudo cupsaccept EPSON_L121
   ```

### 3. Serial Ports for Both Arduino Uno R3 Boards
```bash
# Linux defaults: acceptor /dev/ttyACM0, actuator /dev/ttyACM1
ls -la /dev/ttyACM*

# Ensure dialout permissions
sudo usermod -aG dialout $USER
```

The Windows defaults are `COM3` and `COM4`. Set `ACCEPTOR_SERIAL_PORT` and `ACTUATOR_SERIAL_PORT` in `.env` if the device assignments differ. Both serial connections are read independently with non-blocking reads.

### 4. Deploy Kiosk Backend as a systemd Service
Create `/etc/systemd/system/print-kiosk.service`:
```ini
[Unit]
Description=Self-Service Print Kiosk Service
After=network.target cups.service

[Service]
User=pi
WorkingDirectory=/home/pi/print_kiosk
ExecStart=/home/pi/print_kiosk/venv/bin/python main.py
Restart=always
RestartSec=3
Environment="CUPS_PRINTER_NAME=EPSON_L121"
Environment="ACCEPTOR_SERIAL_PORT=/dev/ttyACM0"
Environment="ACTUATOR_SERIAL_PORT=/dev/ttyACM1"

[Install]
WantedBy=multi-user.target
```
Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now print-kiosk.service
```

### 5. Auto-start Chromium in Kiosk Mode
Edit or create `~/.config/autostart/kiosk.desktop`:
```ini
[Desktop Entry]
Type=Application
Name=Kiosk
Exec=chromium-browser --noerrdialogs --disable-infobars --kiosk --incognito http://localhost:3000
X-GNOME-Autostart-enabled=true
```

### 6. Run the Isolated GCash Confirmation App

Set unique `GCASH_CONFIRM_PASSWORD` and `GCASH_CONFIRM_TOKEN` values in `.env`. The Node kiosk server and confirmation app share the token. Start the Node kiosk UI/backend and the operator app in separate terminals:

```bash
npm run dev
GCASH_CONFIRM_HOST=0.0.0.0 .venv/bin/python -m kiosk_backend.gcash_app
```

On a phone connected to the same trusted Wi-Fi, open `http://<kiosk-computer-LAN-IP>:8080` and sign in. New pending GCash requests arrive automatically with the amount and print details; the session ID is kept in the background. Verify each transfer in GCash, then choose **Accept** to release the print job or **Reject** to update the kiosk screen. Requests are delivered over an authenticated server-sent event stream and the server webhook uses the shared token. The confirmation page uses HTTP, so keep it on a trusted local network and do not expose port 8080 to the public internet.

The Python backend owns the dual-Arduino heartbeat monitor and CUPS polling. Run it as a separate process on a free port (the Node kiosk UI uses port 3000), for example:

```bash
PORT=3001 .venv/bin/python main.py
```

Set the same `GCASH_CONFIRM_TOKEN` in the Python backend and operator-app environments. Set `GCASH_CONFIRM_STATUS_URL` to the operator server's internal status receiver (default `http://127.0.0.1:8080/internal/system-status`). The Python monitor polls both Arduino heartbeats and `lpstat` on a background thread, publishes cached status through `/api/system/status`, and forwards status changes to the authenticated operator SSE stream. Critical Arduino disconnects, paper jams, and out-of-paper states raise dashboard alerts on transition.

---

## 💳 Payment & Security Architecture

1. **PayMongo GCash Test Keys**:
   - `PAYMONGO_MODE=test` runs against the sandbox with `sk_test_` keys.
   - Test mode issues QR codes and simulates `payment.paid` events without requiring merchant registration.
2. **Offline Resilience**:
   - The kiosk continuously probes internet connectivity. If offline, GCash is hidden with an informative prompt, leaving Cash active.
3. **Cash Safety Constraints**:
   - Change is mathematically partitioned into ₱5 and ₱1 coin combinations.
   - `MAX_PAYABLE_AMOUNT` (₱200) prevents overpaying beyond physical hopper capacity.
4. **Untrusted Input Sandboxing**:
   - All uploaded PDFs (via QR, Hotspot, or USB) are isolated into per-session folders with strict MIME and magic-byte checks.
   - Files automatically self-destruct after the 30-minute session TTL or upon job completion.
