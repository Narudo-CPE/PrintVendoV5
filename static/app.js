/**
 * Self-Service Print Kiosk - Core Frontend Application
 * Vanilla HTML/CSS/JavaScript - Zero Build Step Required
 */

// Global State
const state = {
  sessionId: null,
  currentStep: 1, // 1: Upload, 2: Preview & Config, 3: Review, 4: Payment, 5: Printing, 6: Receipt
  pdfDoc: null,
  currentPageNum: 1,
  totalPdfPages: 0,
  selectedPages: [1],
  paperSize: "A4", // A4 | LETTER | LONG
  colorMode: "bw", // bw | color
  copies: 1,
  reverseOrder: false,
  collate: true,
  pricing: null,
  isPricingLoading: false,
  hardwareConnected: true,
  internetConnected: true,
  activePaymentMethod: "cash",
  cashInserted: 0.0,
  cashTotalDue: 0.0,
  ws: null,
  printQueueProgress: { current: 0, total: 0 },
};

// UI Elements Cache
const elements = {
  // Navigation & Status
  hardwarePill: document.getElementById("hardware-status-pill"),
  hardwareDot: document.getElementById("hardware-status-dot"),
  hardwareText: document.getElementById("hardware-status-text"),
  internetPill: document.getElementById("internet-status-pill"),
  internetDot: document.getElementById("internet-status-dot"),
  internetText: document.getElementById("internet-status-text"),
  hardwareAlertBanner: document.getElementById("hardware-alert-banner"),

  // Views
  viewUpload: document.getElementById("view-upload"),
  viewPreview: document.getElementById("view-preview"),
  viewPayment: document.getElementById("view-payment"),
  viewPrinting: document.getElementById("view-printing"),
  viewReceipt: document.getElementById("view-receipt"),

  // PDF.js Canvas
  pdfCanvas: document.getElementById("pdf-canvas"),
  pdfPrevBtn: document.getElementById("pdf-prev-btn"),
  pdfNextBtn: document.getElementById("pdf-next-btn"),
  pdfPageIndicator: document.getElementById("pdf-page-indicator"),
  pageSelectorGrid: document.getElementById("page-selector-grid"),

  // Config Controls
  copiesVal: document.getElementById("copies-val"),
  copiesDec: document.getElementById("copies-dec"),
  copiesInc: document.getElementById("copies-inc"),
  reverseToggle: document.getElementById("reverse-toggle"),
  collateToggle: document.getElementById("collate-toggle"),
  selectAllPagesBtn: document.getElementById("select-all-pages-btn"),
  deselectAllPagesBtn: document.getElementById("deselect-all-pages-btn"),

  // Pricing Display
  unitPriceDisplay: document.getElementById("unit-price-display"),
  totalSheetsDisplay: document.getElementById("total-sheets-display"),
  grandTotalDisplay: document.getElementById("grand-total-display"),
  proceedToPayBtn: document.getElementById("proceed-to-pay-btn"),

  // Payment View Elements
  paymentGrandTotal: document.getElementById("payment-grand-total"),
  gcashCard: document.getElementById("gcash-payment-card"),
  cashCard: document.getElementById("cash-payment-card"),
  gcashQrContainer: document.getElementById("gcash-qr-container"),
  gcashStatusText: document.getElementById("gcash-status-text"),
  cashRunningBalance: document.getElementById("cash-running-balance"),
  cashRemainingDue: document.getElementById("cash-remaining-due"),
  changePreviewBox: document.getElementById("change-preview-box"),
  cancelCashBtn: document.getElementById("cancel-cash-btn"),

  // Printing View Elements
  printProgressBar: document.getElementById("print-progress-bar"),
  printProgressText: document.getElementById("print-progress-text"),
  printPageStatus: document.getElementById("print-page-status"),

  // Receipt
  receiptSessionId: document.getElementById("receipt-session-id"),
  receiptDate: document.getElementById("receipt-date"),
  receiptTotalCost: document.getElementById("receipt-total-cost"),
  receiptChangeDispensed: document.getElementById("receipt-change-dispensed"),
  receiptChangeDetails: document.getElementById("receipt-change-details"),
  deleteFileBtn: document.getElementById("delete-file-btn"),
  keepFileBtn: document.getElementById("keep-file-btn"),
  privacyActionStatus: document.getElementById("privacy-action-status"),

};

// ---------------------------------------------------------------------------
// Logger Utility for In-Browser Debug Console
// ---------------------------------------------------------------------------
function debugLog(msg) {
  const time = new Date().toLocaleTimeString();
  const line = `[${time}] ${msg}`;
  console.log(line);
}

// ---------------------------------------------------------------------------
// Step Navigation Manager
// ---------------------------------------------------------------------------
function setKioskStep(step) {
  state.currentStep = step;

  // Toggle View Containers
  elements.viewUpload.classList.toggle("active-view", step === 1);
  elements.viewPreview.classList.toggle("active-view", step === 2);
  elements.viewPayment.classList.toggle("active-view", step === 3);
  elements.viewPrinting.classList.toggle("active-view", step === 4);
  elements.viewReceipt.classList.toggle("active-view", step === 5);

  // Update step indicators in top bar
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById(`step-ind-${i}`);
    if (el) {
      el.classList.toggle("active", i === step);
      el.classList.toggle("completed", i < step);
    }
  }

  // Scroll to top
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------------------------------------------------------------------------
// Session Initialization & WebSocket Management
// ---------------------------------------------------------------------------
async function initializeSession() {
  try {
    const res = await fetch("/api/sessions/create", { method: "POST" });
    const data = await res.json();
    state.sessionId = data.session_id;
    debugLog(`Created session: ${state.sessionId}`);

    // Generate Mobile Upload QR Code for Step 1
    renderMobileUploadQR();

    // Connect WebSocket
    connectWebSocket();

    // Fetch initial system telemetry
    fetchSystemStatus();
  } catch (err) {
    debugLog(`Session init error: ${err.message}`);
  }
}

function connectWebSocket() {
  if (!state.sessionId) return;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/${state.sessionId}`;

  debugLog(`Connecting WebSocket: ${wsUrl}`);
  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    debugLog("WebSocket connected.");
  };

  state.ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      handleWebSocketMessage(msg.event, msg.data);
    } catch (e) {
      console.error("WS parse error", e);
    }
  };

  state.ws.onclose = () => {
    debugLog("WebSocket closed. Auto-reconnecting in 3s...");
    setTimeout(connectWebSocket, 3000);
  };
}

function handleWebSocketMessage(event, data) {
  debugLog(`WS Event: ${event} -> ${JSON.stringify(data)}`);

  switch (event) {
    case "hardware_status":
      updateHardwareStatus(data.connected);
      break;

    case "file_uploaded":
      debugLog(`Document uploaded remotely: ${data.filename} (${data.page_count} pages)`);
      closeAllModals();
      loadPdfDocument(`/api/session/${state.sessionId}/file`);
      break;

    case "balance_update":
      state.cashInserted = data.total_paid;
      updateCashBalanceUI(data.total_paid, data.amount_due);
      break;

    case "payment_confirmed":
      debugLog("Payment Confirmed! Auto-transitioning to print pipeline.");
      onPaymentConfirmed(data);
      break;

    case "print_progress":
      updatePrintProgress(data);
      break;

    case "print_completed":
      debugLog("Print job and change payout completed.");
      break;

    case "TRANSACTION_COMPLETE":
      onTransactionComplete(data);
      break;
  }
}

// ---------------------------------------------------------------------------
// System Telemetry & Hardware Connection Health
// ---------------------------------------------------------------------------
async function fetchSystemStatus() {
  try {
    const res = await fetch("/api/system/status");
    const data = await res.json();

    updateHardwareStatus(data.hardware ? data.hardware.connected : false);
    updateInternetStatus(data.internet_connected);
  } catch (err) {
    debugLog(`Status check error: ${err.message}`);
  }
}

function updateHardwareStatus(isConnected) {
  state.hardwareConnected = isConnected;

  if (isConnected) {
    elements.hardwareDot.className = "status-indicator status-online";
    elements.hardwareText.innerText = "Arduino Uno Link Active";
    elements.hardwareAlertBanner.classList.add("hidden");
    elements.cashCard.classList.remove("disabled-method");
  } else {
    elements.hardwareDot.className = "status-indicator status-offline";
    elements.hardwareText.innerText = "Arduino Disconnected";
    elements.hardwareAlertBanner.classList.remove("hidden");
    elements.cashCard.classList.add("disabled-method");
  }
}

function updateInternetStatus(isOnline) {
  state.internetConnected = isOnline;

  if (isOnline) {
    elements.internetDot.className = "status-indicator status-online";
    elements.internetText.innerText = "Online (GCash Active)";
    elements.gcashCard.classList.remove("disabled-method");
    const offlineBadge = elements.gcashCard.querySelector(".offline-badge");
    if (offlineBadge) offlineBadge.style.display = "none";
  } else {
    elements.internetDot.className = "status-indicator status-warning";
    elements.internetText.innerText = "Offline (Cash Only)";
    elements.gcashCard.classList.add("disabled-method");
    const offlineBadge = elements.gcashCard.querySelector(".offline-badge");
    if (offlineBadge) offlineBadge.style.display = "block";
  }
}

// ---------------------------------------------------------------------------
// Step 1: Upload Channels
// ---------------------------------------------------------------------------
function renderMobileUploadQR() {
  const qrBox = document.getElementById("mobile-qr-code-box");
  if (!qrBox) return;

  const uploadUrl = `${window.location.origin}/#upload-${state.sessionId}`;
  qrBox.innerHTML = "";

  // Render QR code using QRCode.js if available, or SVG fallback
  if (window.QRCode) {
    new QRCode(qrBox, {
      text: uploadUrl,
      width: 180,
      height: 180,
      colorDark: "#0f172a",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
  } else {
    qrBox.innerHTML = `<div style="padding:20px; font-weight:bold; color:#0f172a;">Scan on Phone:<br><small>${uploadUrl}</small></div>`;
  }
}

// Direct File Upload Handling
const fileInput = document.getElementById("direct-file-input");
fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith(".pdf")) {
    alert("Only PDF documents are supported for printing.");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);

  try {
    debugLog(`Uploading direct PDF: ${file.name}...`);
    const res = await fetch(`/api/upload/${state.sessionId}`, {
      method: "POST",
      body: formData,
    });
    const result = await res.json();
    if (result.success) {
      loadPdfDocument(`/api/session/${state.sessionId}/file`);
    } else {
      alert(result.detail || "Upload failed.");
    }
  } catch (err) {
    alert(`Upload error: ${err.message}`);
  }
});

// USB Scan Modal
async function openUsbModal() {
  const modal = document.getElementById("usb-modal");
  const listContainer = document.getElementById("usb-file-list-container");
  modal.classList.add("active");
  listContainer.innerHTML = "<div style='padding:20px;'>Scanning USB ports...</div>";

  try {
    const res = await fetch("/api/upload/usb/scan");
    const data = await res.json();

    if (data.files && data.files.length > 0) {
      listContainer.innerHTML = "";
      data.files.forEach((f) => {
        const item = document.createElement("div");
        item.className = "usb-file-item";
        item.innerHTML = `
          <div>
            <div style="font-weight:700;">📄 ${f.name}</div>
            <div style="font-size:12px; color:#94a3b8;">${(f.size / 1024).toFixed(1)} KB</div>
          </div>
          <button class="icon-btn" style="min-height:36px; padding:6px 12px;">Select</button>
        `;
        item.onclick = () => selectUsbFile(f.path);
        listContainer.appendChild(item);
      });
    } else {
      listContainer.innerHTML = "<div style='padding:20px; color:#94a3b8;'>No PDF documents detected on USB drive.</div>";
    }
  } catch (err) {
    listContainer.innerHTML = `<div style='padding:20px; color:#ef4444;'>Scan error: ${err.message}</div>`;
  }
}

async function selectUsbFile(path) {
  try {
    debugLog(`Importing file from USB: ${path}`);
    const res = await fetch(`/api/upload/usb/${state.sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const data = await res.json();
    if (data.success) {
      closeAllModals();
      loadPdfDocument(`/api/session/${state.sessionId}/file`);
    }
  } catch (err) {
    alert(`USB import failed: ${err.message}`);
  }
}

function closeAllModals() {
  document.querySelectorAll(".upload-modal-overlay").forEach((m) => m.classList.remove("active"));
}

// ---------------------------------------------------------------------------
// Step 2: PDF.js Preview & Page Selection
// ---------------------------------------------------------------------------
async function loadPdfDocument(pdfUrl) {
  debugLog(`Loading PDF preview: ${pdfUrl}`);
  try {
    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    state.pdfDoc = await loadingTask.promise;
    state.totalPdfPages = state.pdfDoc.numPages;
    state.currentPageNum = 1;

    // Default select all pages
    state.selectedPages = Array.from({ length: state.totalPdfPages }, (_, i) => i + 1);

    // Build page selection chips
    buildPageSelectionChips();

    // Render first page canvas
    renderPdfPage(1);

    // Advance to Step 2
    setKioskStep(2);

    // Request initial authoritative server-side pricing
    requestAuthoritativePricing();
  } catch (err) {
    debugLog(`PDF preview render error: ${err.message}`);
    alert("Failed to render PDF preview.");
  }
}

async function renderPdfPage(pageNum) {
  if (!state.pdfDoc) return;
  state.currentPageNum = pageNum;
  elements.pdfPageIndicator.innerText = `Page ${pageNum} of ${state.totalPdfPages}`;

  const page = await state.pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = elements.pdfCanvas;
  const ctx = canvas.getContext("2d");

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const renderContext = {
    canvasContext: ctx,
    viewport: viewport,
  };
  await page.render(renderContext).promise;
}

function buildPageSelectionChips() {
  elements.pageSelectorGrid.innerHTML = "";
  for (let p = 1; p <= state.totalPdfPages; p++) {
    const chip = document.createElement("div");
    chip.className = `page-chip ${state.selectedPages.includes(p) ? "selected" : ""}`;
    chip.id = `page-chip-${p}`;
    chip.innerText = p;
    chip.onclick = () => togglePageSelection(p);
    elements.pageSelectorGrid.appendChild(chip);
  }
}

function togglePageSelection(pageNum) {
  if (state.selectedPages.includes(pageNum)) {
    if (state.selectedPages.length === 1) {
      alert("At least one page must be selected.");
      return;
    }
    state.selectedPages = state.selectedPages.filter((p) => p !== pageNum);
  } else {
    state.selectedPages.push(pageNum);
    state.selectedPages.sort((a, b) => a - b);
  }

  // Update chip styles
  for (let p = 1; p <= state.totalPdfPages; p++) {
    const chip = document.getElementById(`page-chip-${p}`);
    if (chip) chip.classList.toggle("selected", state.selectedPages.includes(p));
  }

  requestAuthoritativePricing();
}

function selectAllPages() {
  state.selectedPages = Array.from({ length: state.totalPdfPages }, (_, i) => i + 1);
  buildPageSelectionChips();
  requestAuthoritativePricing();
}

function deselectAllPages() {
  state.selectedPages = [1];
  buildPageSelectionChips();
  requestAuthoritativePricing();
}

// ---------------------------------------------------------------------------
// Step 2 Configuration Controls (Paper, Color, Copies, Order)
// ---------------------------------------------------------------------------
function setPaperSize(size) {
  state.paperSize = size;
  document.querySelectorAll(".paper-size-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.size === size);
  });
  requestAuthoritativePricing();
}

function setColorMode(mode) {
  state.colorMode = mode;
  document.querySelectorAll(".color-mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  requestAuthoritativePricing();
}

function changeCopies(delta) {
  const newCopies = state.copies + delta;
  if (newCopies >= 1 && newCopies <= 50) {
    state.copies = newCopies;
    elements.copiesVal.innerText = newCopies;
    requestAuthoritativePricing();
  }
}

elements.reverseToggle.addEventListener("change", (e) => {
  state.reverseOrder = e.target.checked;
  requestAuthoritativePricing();
});

elements.collateToggle.addEventListener("change", (e) => {
  state.collate = e.target.checked;
  requestAuthoritativePricing();
});

// Canvas Page Flipping
elements.pdfPrevBtn.addEventListener("click", () => {
  if (state.currentPageNum > 1) renderPdfPage(state.currentPageNum - 1);
});
elements.pdfNextBtn.addEventListener("click", () => {
  if (state.currentPageNum < state.totalPdfPages) renderPdfPage(state.currentPageNum + 1);
});

// ---------------------------------------------------------------------------
// Step 3: Authoritative Pricing Request (Never trusted from client)
// ---------------------------------------------------------------------------
let pricingDebounceTimeout = null;

function requestAuthoritativePricing() {
  if (pricingDebounceTimeout) clearTimeout(pricingDebounceTimeout);

  elements.grandTotalDisplay.innerText = "Calculating...";
  elements.proceedToPayBtn.disabled = true;

  pricingDebounceTimeout = setTimeout(async () => {
    try {
      debugLog("Requesting authoritative server-side pricing...");
      const payload = {
        selected_pages: state.selectedPages,
        paper_size: state.paperSize,
        color_mode: state.colorMode,
        copies: state.copies,
        reverse_order: state.reverseOrder,
        collate: state.collate,
      };

      const res = await fetch(`/api/pricing/${state.sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      state.pricing = data;

      // Update UI with unforgeable calculated pricing
      elements.unitPriceDisplay.innerText = `₱${data.unit_price.toFixed(2)}`;
      elements.totalSheetsDisplay.innerText = `${data.total_sheets_to_feed} sheets`;
      elements.grandTotalDisplay.innerText = `₱${data.total_price.toFixed(2)}`;
      elements.paymentGrandTotal.innerText = `₱${data.total_price.toFixed(2)}`;
      elements.proceedToPayBtn.disabled = false;

      debugLog(`Authoritative price: ₱${data.total_price.toFixed(2)} for ${data.total_sheets_to_feed} sheets`);
    } catch (err) {
      debugLog(`Pricing error: ${err.message}`);
      elements.grandTotalDisplay.innerText = "Error";
    }
  }, 300);
}

// ---------------------------------------------------------------------------
// Step 4: Payment Flow (GCash QR + Cash Acceptors)
// ---------------------------------------------------------------------------
elements.proceedToPayBtn.addEventListener("click", () => {
  setKioskStep(3); // Go to Payment View
  selectPaymentMethod(state.internetConnected ? "gcash" : "cash");
});

function selectPaymentMethod(method) {
  state.activePaymentMethod = method;
  elements.gcashCard.classList.toggle("selected", method === "gcash");
  elements.cashCard.classList.toggle("selected", method === "cash");

  if (method === "gcash") {
    initiateGcashPayment();
  } else {
    initiateCashPayment();
  }
}

async function initiateGcashPayment() {
  elements.gcashStatusText.innerText = "Generating PayMongo GCash QR code...";
  elements.gcashQrContainer.innerHTML = "<div style='padding:20px;'>Generating QR...</div>";

  try {
    const res = await fetch("/api/payments/gcash/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId }),
    });
    const data = await res.json();

    if (data.success && data.qr_data) {
      elements.gcashQrContainer.innerHTML = "";
      if (window.QRCode) {
        new QRCode(elements.gcashQrContainer, {
          text: data.qr_data,
          width: 220,
          height: 220,
          colorDark: "#0f172a",
          colorLight: "#ffffff",
        });
      } else {
        elements.gcashQrContainer.innerText = "Scan PayMongo QR";
      }
      elements.gcashStatusText.innerText = "Scan with your GCash app to pay.";
    } else {
      elements.gcashStatusText.innerText = data.detail || "GCash payment unavailable.";
    }
  } catch (err) {
    elements.gcashStatusText.innerText = `GCash error: ${err.message}`;
  }
}

async function initiateCashPayment() {
  if (!state.hardwareConnected) {
    alert("Microcontroller disconnected. Cash payment unavailable.");
    return;
  }

  state.cashInserted = 0.0;
  state.cashTotalDue = state.pricing ? state.pricing.total_price : 0.0;
  updateCashBalanceUI(0.0, state.cashTotalDue);

  try {
    debugLog("Waking TB74 bill acceptor & Allan 1239A coin acceptor...");
    await fetch("/api/payments/cash/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId }),
    });
  } catch (err) {
    debugLog(`Cash start error: ${err.message}`);
  }
}

function updateCashBalanceUI(inserted, totalDue) {
  elements.cashRunningBalance.innerText = `₱${inserted.toFixed(2)}`;
  const remaining = Math.max(0, totalDue - inserted);
  elements.cashRemainingDue.innerText = `₱${remaining.toFixed(2)}`;

  if (inserted > totalDue && totalDue > 0) {
    const change = inserted - totalDue;
    const coins5 = Math.floor(change / 5);
    const coins1 = Math.round(change % 5);
    elements.changePreviewBox.innerText = `Change: ₱${change.toFixed(2)} (${coins5}x ₱5 coins, ${coins1}x ₱1 coins)`;
    elements.changePreviewBox.style.display = "block";
  } else {
    elements.changePreviewBox.style.display = "none";
  }
}

elements.cancelCashBtn.addEventListener("click", async () => {
  try {
    await fetch("/api/payments/cash/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId }),
    });
    setKioskStep(2); // Return to preview
  } catch (err) {
    console.error(err);
  }
});

// ---------------------------------------------------------------------------
// Step 5: Printing Pipeline
// ---------------------------------------------------------------------------
async function onPaymentConfirmed(paymentData) {
  state.paymentReceiptData = paymentData;
  setKioskStep(4); // Advance to Printing view

  // Trigger backend print execution
  try {
    debugLog("Payment Confirmed! Calling /api/print/start...");
    const res = await fetch("/api/print/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId }),
    });
    const data = await res.json();
    debugLog(`Print job started: ${data.job_id} (${data.total_sheets} sheets)`);
  } catch (err) {
    debugLog(`Print start error: ${err.message}`);
  }
}

function updatePrintProgress(data) {
  const percent = data.percent || 0;
  elements.printProgressBar.style.width = `${percent}%`;
  elements.printProgressText.innerText = `Printing Sheet ${data.current_page} of ${data.total_pages} (${percent}%)`;
  elements.printPageStatus.innerText = `Page ${data.page_number} (Copy ${data.copy_number}) • Tray: ${state.paperSize}`;
}

function onTransactionComplete(data) {
  debugLog("Transaction complete. Showing receipt.");
  setKioskStep(5); // Advance to Receipt

  elements.receiptSessionId.innerText = state.sessionId.substring(0, 8);
  elements.receiptDate.innerText = new Date().toLocaleString();
  const totalCost = Number(data.total_cost ?? state.pricing?.total_price ?? 0);
  const changeDispensed = Number(data.change_dispensed ?? 0);
  elements.receiptTotalCost.innerText = `₱${totalCost.toFixed(2)}`;

  if (changeDispensed > 0) {
    elements.receiptChangeDispensed.innerText = `₱${changeDispensed.toFixed(2)}`;
    elements.receiptChangeDetails.innerText = `Dispensed: ${Number(data.change_coins_5 || 0)}x ₱5 coins, ${Number(data.change_coins_1 || 0)}x ₱1 coins`;
  } else {
    elements.receiptChangeDispensed.innerText = "₱0.00 (Exact)";
    elements.receiptChangeDetails.innerText = "";
  }
}

async function chooseFilePrivacy(action) {
  elements.deleteFileBtn.disabled = true;
  elements.keepFileBtn.disabled = true;
  elements.privacyActionStatus.hidden = false;
  elements.privacyActionStatus.innerText = action === "delete" ? "Deleting your file..." : "Keeping your file for now...";

  try {
    const response = await fetch(`/api/privacy/${encodeURIComponent(state.sessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Unable to save your file privacy choice.");

    elements.privacyActionStatus.innerText = "Your choice is saved. Returning to the welcome screen...";
    window.setTimeout(() => window.location.reload(), 700);
  } catch (error) {
    elements.deleteFileBtn.disabled = false;
    elements.keepFileBtn.disabled = false;
    elements.privacyActionStatus.innerText = error.message;
  }
}

elements.deleteFileBtn.addEventListener("click", () => chooseFilePrivacy("delete"));
elements.keepFileBtn.addEventListener("click", () => chooseFilePrivacy("keep"));

// ---------------------------------------------------------------------------
// Initialize Application on Page Load
// ---------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  initializeSession();

  // Configure PDF.js worker
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
});
