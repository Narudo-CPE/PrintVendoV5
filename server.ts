import 'dotenv/config';
import express from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { randomUUID, timingSafeEqual } from 'crypto';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Enable CORS for cross-tab and cross-device communication (e.g. Owner Dashboard)
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Support up to 50MB payload for high-resolution PDF/image documents and screenshots
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // In-memory document buffer mapped by sessionId
  // Automatically expired after 30 minutes to prevent memory leaks
  const sessionUploads = new Map<
    string,
    { fileName: string; fileDataUrl: string; timestamp: number }
  >();

  // Payment Tracking for Kiosk & Owner Approval App
  interface PaymentRecord {
    sessionId: string;
    amount: number;
    fileName?: string;
    pageCount?: number;
    copies?: number;
    colorMode?: string;
    timestamp: number;
    status: 'pending' | 'approved' | 'rejected';
    method?: string;
    amountPaid?: number;
    reference?: string;
    approvedAt?: number;
    notes?: string;
    orderScreenshot?: string; // base64 screenshot of kiosk order & amount
    customerReceipt?: string; // base64 screenshot of customer's GCash receipt
    customerRef?: string;     // GCash reference number entered by customer
  }

  const paymentOrders = new Map<string, PaymentRecord>();
  const paymentEventClients = new Map<string, Set<import('express').Response>>();
  const publishPaymentStatus = (record: PaymentRecord) => {
    const clients = paymentEventClients.get(record.sessionId);
    if (!clients) return;
    const payload = JSON.stringify({
      paid: record.status === 'approved',
      status: record.status,
      amount: record.amount,
      reference: record.reference,
      approvedAt: record.approvedAt,
    });
    for (const client of clients) client.write('event: payment_status\n' + `data: ${payload}\n\n`);
  };
  const printerQueueName = process.env.CUPS_PRINTER_NAME?.trim() || 'L120-Series';
  const configuredPrintMode = process.env.PRINT_MODE?.trim().toLowerCase();
  const printMode = configuredPrintMode === 'simulation' ? 'simulation' : 'gutenprint';
  const printUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
  });
  type PrintJob = {
    sessionId: string;
    jobId: string;
    requestId: string;
    status: 'submitting' | 'queued' | 'completed' | 'failed';
    createdAt: number;
    error?: string;
    mode?: 'simulation' | 'gutenprint';
  };
  const printJobsBySession = new Map<string, PrintJob>();

  const runCommand = (command: string, args: string[]) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFile(command, args, { encoding: 'utf8', timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stderr });
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  const waitForCupsRequest = async (requestId: string) => {
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      const [activeJobs, completedJobs] = await Promise.all([
        runCommand('lpstat', ['-W', 'not-completed', '-o', printerQueueName]),
        runCommand('lpstat', ['-W', 'completed', '-o', printerQueueName]),
      ]);
      if (completedJobs.stdout.includes(requestId)) return;
      if (!activeJobs.stdout.includes(requestId)) {
        throw new Error(`Gutenprint no longer reports request ${requestId}.`);
      }
      await wait(1000);
    }
    throw new Error(`Timed out waiting for Gutenprint request ${requestId} to finish.`);
  };

  // Periodically sweep items older than 60 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [sId, item] of sessionUploads.entries()) {
      if (now - item.timestamp > 30 * 60 * 1000) {
        sessionUploads.delete(sId);
      }
    }
    for (const [sId, order] of paymentOrders.entries()) {
      if (now - order.timestamp > 60 * 60 * 1000) {
        paymentOrders.delete(sId);
      }
    }
  }, 5 * 60 * 1000);

  // Owner App URL (configured from user's companion Owner App)
  let ownerAppUrl =
    process.env.OWNER_APP_URL ||
    'https://ais-dev-c6d32e42tdbjv5z6yuynjk-604002314892.asia-southeast1.run.app';

  // Helper to forward events/orders to the remote Owner App
  async function notifyOwnerApp(endpoint: string, method = 'POST', payload?: any) {
    if (!ownerAppUrl) return;
    try {
      const baseUrl = ownerAppUrl.replace(/\/+$/, '');
      const targetUrl = `${baseUrl}${endpoint}`;
      console.log(`[Owner Sync] Forwarding ${method} to ${targetUrl}`);
      const response = await fetch(targetUrl, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(5000),
      });
      console.log(`[Owner Sync] Response from ${targetUrl}: ${response.status}`);
    } catch (e: any) {
      console.log(`[Owner Sync Note] Forward to ${endpoint}: ${e.message}`);
    }
  }

  // Health endpoint
  app.get('/api/kiosk/upload-origin', (req, res) => {
    const configuredOrigin = process.env.KIOSK_PUBLIC_URL?.trim();
    const apiOrigin = process.env.KIOSK_API_URL?.trim();
    const makeResponse = (origin: string) => {
      let derivedApiOrigin = apiOrigin;
      if (!derivedApiOrigin) {
        try {
          const parsedOrigin = new URL(origin);
          parsedOrigin.port = process.env.KIOSK_API_PORT || '3000';
          derivedApiOrigin = parsedOrigin.origin;
        } catch {
          derivedApiOrigin = '';
        }
      }
      return { origin: origin.replace(/\/+$/, ''), apiOrigin: derivedApiOrigin };
    };
    if (configuredOrigin) {
      return res.json(makeResponse(configuredOrigin));
    }

    const host = req.get('host');
    const protocol = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim();
    if (host && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)) {
      return res.json(makeResponse(`${protocol}://${host}`));
    }

    const addresses = Object.values(os.networkInterfaces())
      .flatMap((entries) => entries || [])
      .filter((entry) => entry.family === 'IPv4' && !entry.internal)
      .map((entry) => entry.address);
    const address = addresses.find((ip) => !ip.startsWith('172.17.')) || addresses[0];
    return res.json(makeResponse(address ? `http://${address}:${PORT}` : `http://${host || `localhost:${PORT}`}`));
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      ownerAppUrl,
      kioskUrl: 'https://ais-dev-gvqgfzsddvwzvo4ks5rgyw-604002314892.asia-southeast1.run.app',
    });
  });

  // Owner App URL endpoints
  app.get('/api/kiosk/owner-url', (_req, res) => {
    res.json({
      ownerAppUrl,
      kioskUrl: 'https://ais-dev-gvqgfzsddvwzvo4ks5rgyw-604002314892.asia-southeast1.run.app',
      kioskSharedUrl: 'https://ais-pre-gvqgfzsddvwzvo4ks5rgyw-604002314892.asia-southeast1.run.app',
    });
  });

  app.post('/api/kiosk/owner-url', (req, res) => {
    const { url } = req.body;
    if (url && typeof url === 'string') {
      ownerAppUrl = url.trim();
      console.log(`[Owner Sync] Updated Owner App URL to: ${ownerAppUrl}`);
    }
    res.json({ success: true, ownerAppUrl });
  });

  // Serve public static folder explicitly
  const publicDir = path.join(process.cwd(), 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  app.use(express.static(publicDir));

  // --- Permanent Father's GCash QR Storage Endpoints ---
  app.post('/api/kiosk/save-qr', (req, res) => {
    try {
      const { imageData } = req.body;
      if (!imageData || typeof imageData !== 'string') {
        return res.status(400).json({ error: 'imageData base64 string is required' });
      }

      // Strip data:image/...;base64, header if present
      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const targetPath = path.join(publicDir, 'father-gcash-qr.png');

      fs.writeFileSync(targetPath, buffer);
      console.log(`[QR Storage] Saved Father GCash QR to ${targetPath} (${buffer.length} bytes)`);

      res.json({ success: true, url: '/father-gcash-qr.png', timestamp: Date.now() });
    } catch (err: any) {
      console.error('[QR Storage Error]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/kiosk/qr-status', (_req, res) => {
    const targetPath = path.join(publicDir, 'father-gcash-qr.png');
    const exists = fs.existsSync(targetPath);
    res.json({
      hasQR: exists,
      url: exists ? `/father-gcash-qr.png?v=${fs.statSync(targetPath).mtimeMs}` : null,
    });
  });

  // --- GCash Remote Owner Confirmation & Payment Endpoints ---

  // 1. Kiosk notifies server of a new pending GCash payment (includes order screenshot)
  app.post('/api/payment/:sessionId/pending', (req, res) => {
    const { sessionId } = req.params;
    const {
      amount,
      fileName,
      pageCount,
      copies,
      colorMode,
      orderScreenshot,
      customerReceipt,
      customerRef,
    } = req.body;

    const record: PaymentRecord = {
      sessionId,
      amount: Number(amount) || 0,
      fileName: fileName || 'Document',
      pageCount: pageCount || 1,
      copies: copies || 1,
      colorMode: colorMode || 'bw',
      orderScreenshot: orderScreenshot || undefined,
      customerReceipt: customerReceipt || undefined,
      customerRef: customerRef || undefined,
      timestamp: Date.now(),
      status: 'pending',
    };

    paymentOrders.set(sessionId, record);
    publishPaymentStatus(record);
    console.log(`[Payment] New pending order for session ${sessionId}: ₱${record.amount} (Screenshot: ${Boolean(orderScreenshot)})`);

    // Synchronously/asynchronously forward to Owner App across common endpoint patterns
    notifyOwnerApp(`/api/payment/${sessionId}/pending`, 'POST', req.body);

    const confirmerUrl = process.env.GCASH_CONFIRM_NOTIFY_URL || 'http://127.0.0.1:8080/internal/payment-request';
    const confirmationToken = process.env.GCASH_CONFIRM_TOKEN || '';
    if (confirmationToken) {
      void fetch(confirmerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GCash-Confirm-Token': confirmationToken,
        },
        body: JSON.stringify({
          session_id: sessionId,
          amount: record.amount,
          file_name: record.fileName,
          page_count: record.pageCount,
          copies: record.copies,
        }),
        signal: AbortSignal.timeout(2500),
      }).then((response) => {
        if (!response.ok) console.error(`[Payment] Operator notification failed: HTTP ${response.status}`);
      }).catch((error) => {
        console.error(`[Payment] Operator notification failed: ${error.message}`);
      });
    } else {
      console.error('[Payment] GCASH_CONFIRM_TOKEN is not configured; operator notification skipped.');
    }

    res.json({ success: true, order: record });
  });

  app.get('/api/payment/:sessionId/events', (req, res) => {
    const { sessionId } = req.params;
    const record = paymentOrders.get(sessionId);

    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    let clients = paymentEventClients.get(sessionId);
    if (!clients) {
      clients = new Set();
      paymentEventClients.set(sessionId, clients);
    }
    clients.add(res);

    const sendStatus = (payment: PaymentRecord) => {
      res.write('event: payment_status\n' + `data: ${JSON.stringify({
        paid: payment.status === 'approved',
        status: payment.status,
        amount: payment.amount,
        reference: payment.reference,
        approvedAt: payment.approvedAt,
      })}\n\n`);
    };
    if (record) sendStatus(record);
    else res.write('event: payment_status\ndata: {"paid":false,"status":"waiting"}\n\n');
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15000);
    res.on('close', () => {
      clearInterval(keepAlive);
      clients?.delete(res);
      if (clients?.size === 0) paymentEventClients.delete(sessionId);
    });
  });

  app.post('/api/payment/:sessionId/cash/confirm', (req, res) => {
    const record = paymentOrders.get(req.params.sessionId);
    if (!record) {
      return res.status(404).json({ error: 'Payment session is not registered.' });
    }
    if (record.status === 'rejected') {
      return res.status(409).json({ error: 'This payment session was rejected.' });
    }

    const method = req.body.method;
    const amountPaid = Number(req.body.amountPaid);
    if (!['bill', 'coin'].includes(method) || !Number.isFinite(amountPaid) || amountPaid < record.amount) {
      return res.status(400).json({ error: 'Cash payment does not cover the registered amount due.' });
    }

    record.status = 'approved';
    record.method = method;
    record.amountPaid = amountPaid;
    record.approvedAt = Date.now();
    record.notes = 'Cash payment accepted at kiosk.';
    paymentOrders.set(record.sessionId, record);
    publishPaymentStatus(record);
    return res.json({ success: true, paid: true, amountPaid });
  });

  // Authoritative Pricing Quote Endpoint
  app.post('/api/pricing/quote', printUpload.single('document') as any, (req, res) => {
    try {
      const paperSize = String(req.body?.paperSize || 'A4').toUpperCase();
      const colorMode = req.body?.colorMode === 'color' ? 'color' : 'bw';
      const copies = Math.max(1, parseInt(req.body?.copies, 10) || 1);

      let selectedPages: number[] = [1];
      if (req.body?.selectedPages) {
        try {
          const parsed = JSON.parse(req.body.selectedPages);
          if (Array.isArray(parsed) && parsed.length > 0) {
            selectedPages = parsed.map((n: any) => Number(n) || 1);
          }
        } catch {
          // fallback to [1]
        }
      }

      // Ingest real optical pixel analysis if provided by client's canvas engine
      let clientGrayscalePixels = 0;
      let clientColorPixels = 0;
      let clientAvgCoverage = 0;
      let clientColorPages: number[] = [];

      if (req.body?.pixelAnalysis) {
        try {
          const parsedAnalysis =
            typeof req.body.pixelAnalysis === 'string'
              ? JSON.parse(req.body.pixelAnalysis)
              : req.body.pixelAnalysis;
          clientGrayscalePixels = Number(parsedAnalysis.grayscalePixels) || 0;
          clientColorPixels = Number(parsedAnalysis.colorPixels) || 0;
          clientAvgCoverage = Number(parsedAnalysis.avgCoverage) || 0;
          if (Array.isArray(parsedAnalysis.colorPages)) {
            clientColorPages = parsedAnalysis.colorPages;
          }
        } catch {
          // quiet
        }
      }

      // Base Paper Pricing per sheet (PHP)
      const paperCosts: Record<string, number> = {
        A4: 1.0,
        LETTER: 1.0,
        LONG: 1.5,
      };
      const baseCost = paperCosts[paperSize] || 1.0;
      const numPages = selectedPages.length;
      const totalSheets = numPages * copies;
      const basePriceTotal = Math.round(baseCost * totalSheets * 100) / 100;

      // Ink pricing calculation:
      // In B&W mode: All pages printed with black ink (₱1.00/sheet base ink charge)
      // In Color mode: Color pages are ₱3.50/sheet, pure B&W pages are ₱1.00/sheet
      let inkChargePerPage = colorMode === 'color' ? 3.5 : 1.0;
      let inkChargeTotal = 0;

      if (colorMode === 'bw') {
        inkChargeTotal = 1.0 * totalSheets;
      } else {
        // If color mode is selected, check if client provided per-page color detection
        let colorSheetsCount = 0;
        let bwSheetsCount = 0;
        for (const p of selectedPages) {
          if (clientColorPages.includes(p) || clientColorPixels > 0) {
            colorSheetsCount += copies;
          } else {
            bwSheetsCount += copies;
          }
        }
        // If no specific color pages mapped but colorMode is 'color', treat as full color
        if (colorSheetsCount === 0 && bwSheetsCount === 0) {
          colorSheetsCount = totalSheets;
        }
        inkChargeTotal = Math.round((colorSheetsCount * 3.5 + bwSheetsCount * 1.0) * 100) / 100;
        inkChargePerPage = Math.round((inkChargeTotal / totalSheets) * 100) / 100;
      }

      const totalPrice = Math.round((basePriceTotal + inkChargeTotal) * 100) / 100;
      const unitPrice = Math.round((baseCost + inkChargePerPage) * numPages * 100) / 100;

      // Computed pixel metrics
      const computedGrayscalePixels =
        colorMode === 'bw'
          ? (clientGrayscalePixels + clientColorPixels || 148500 * numPages) * copies
          : (clientGrayscalePixels || (numPages * 65000)) * copies;

      const computedColorPixels =
        colorMode === 'bw'
          ? 0
          : (clientColorPixels || (numPages * 185000)) * copies;

      const computedAvgCoverage =
        clientAvgCoverage > 0
          ? clientAvgCoverage
          : colorMode === 'color'
          ? 14.8
          : 6.5;

      const queueSequence = [];
      let sheetIndex = 1;
      for (let c = 1; c <= copies; c++) {
        for (const p of selectedPages) {
          queueSequence.push({
            page_number: p,
            copy_number: c,
            sheet_index: sheetIndex++,
            paper_size: paperSize,
            tray_motor: paperSize === 'LONG' ? 'motor_tray_long' : 'motor_tray_standard',
            color_mode: colorMode,
          });
        }
      }

      const pricing = {
        unit_price: unitPrice,
        total_price: totalPrice,
        grand_total: totalPrice,
        total_sheets_to_feed: totalSheets,
        base_price_total: basePriceTotal,
        base_cost: baseCost,
        ink_charge_total: inkChargeTotal,
        grayscale_pixel_count: computedGrayscalePixels,
        grayscale_cost: colorMode === 'bw' ? inkChargeTotal : Math.round(numPages * copies * 1.0 * 100) / 100,
        color_pixel_count: computedColorPixels,
        color_cost: colorMode === 'color' ? Math.round(inkChargeTotal * 100) / 100 : 0,
        avg_pixel_coverage: computedAvgCoverage,
        copies,
        color_mode: colorMode,
        paper_size: paperSize,
        queue_sequence: queueSequence,
      };

      return res.json({ pricing });
    } catch (err: any) {
      console.error('Pricing quote error:', err);
      return res.status(500).json({ error: 'Failed to calculate pricing quote' });
    }
  });

  app.post('/api/print/submit', printUpload.single('document') as any, async (req, res) => {
    const sessionId = String(req.body.sessionId || '');
    const payment = paymentOrders.get(sessionId);
    if (!payment || payment.status !== 'approved') {
      return res.status(402).json({ error: 'Printing is locked until this payment is approved.' });
    }

    const priorJob = printJobsBySession.get(sessionId);
    if (priorJob && priorJob.status !== 'failed') {
      return res.json({
        success: true,
        ...priorJob,
        queueName: priorJob.mode === 'simulation' ? 'Simulation' : printerQueueName,
        reused: true,
      });
    }
    if (priorJob?.status === 'failed' && req.body.retry !== 'true') {
      return res.status(409).json({ error: 'The previous print attempt failed. Use the retry action to submit again.' });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'A PDF, PNG, or JPEG document is required.' });
    }
    const isPdf = ['application/pdf', 'application/octet-stream'].includes(file.mimetype) && file.buffer.subarray(0, 5).toString() === '%PDF-';
    const isPng = file.mimetype === 'image/png' && file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = file.mimetype === 'image/jpeg' && file.buffer[0] === 0xff && file.buffer[1] === 0xd8;
    if (!isPdf && !isPng && !isJpeg) {
      return res.status(415).json({ error: 'The L120 print queue accepts PDF, PNG, and JPEG files.' });
    }

    let selectedPages: number[];
    try {
      selectedPages = JSON.parse(String(req.body.selectedPages || '[]'));
    } catch {
      return res.status(400).json({ error: 'Selected print pages are invalid.' });
    }
    if (!Array.isArray(selectedPages) || selectedPages.length === 0 || selectedPages.some((page) => !Number.isInteger(page) || page < 1)) {
      return res.status(400).json({ error: 'Select at least one valid page to print.' });
    }

    const paperSizes: Record<string, string> = {
      A4: 'A4',
      LETTER: 'Letter',
      LONG: 'w612h936',
    };
    const paperSize = paperSizes[String(req.body.paperSize || '').toUpperCase()];
    const colorMode = String(req.body.colorMode || '').toLowerCase();
    const copies = Number(req.body.copies);
    if (!paperSize || !['bw', 'color'].includes(colorMode) || !Number.isInteger(copies) || copies < 1 || copies > 50) {
      return res.status(400).json({ error: 'Print settings are invalid.' });
    }

    const job: PrintJob = {
      sessionId,
      jobId: randomUUID(),
      requestId: '',
      status: 'submitting',
      createdAt: Date.now(),
      mode: printMode,
    };
    printJobsBySession.set(sessionId, job);

    if (printMode === 'simulation') {
      job.requestId = `SIM-${job.jobId}`;
      job.status = 'completed';
      return res.json({
        success: true,
        ...job,
        queueName: 'Simulation',
        message: 'Simulated print completed; no physical printer was used.',
      });
    }

    const extension = isPdf ? '.pdf' : isPng ? '.png' : '.jpg';
    const tempPath = path.join(os.tmpdir(), `printpoint-${job.jobId}${extension}`);
    try {
      const queueStatus = await runCommand('lpstat', ['-p', printerQueueName]);
      if (/disabled/i.test(queueStatus.stdout)) {
        throw new Error(`Gutenprint printer queue ${printerQueueName} is disabled.`);
      }
      const driverOptions = await runCommand('lpoptions', ['-p', printerQueueName, '-l']);
      if (!/^StpQuality\/Print Quality:/m.test(driverOptions.stdout)) {
        throw new Error(`Printer queue "${printerQueueName}" is not using Gutenprint. Configure the Epson L120 with gutenprint.5.3://escp2-l120/expert.`);
      }
      fs.writeFileSync(tempPath, file.buffer, { flag: 'wx' });

      const pageOrder = req.body.reverseOrder === 'true' ? [...selectedPages].reverse() : [...selectedPages];
      const pagesToPrint: number[] = [];
      if (copies <= 1 || req.body.collate === 'true') {
        for (let copy = 0; copy < copies; copy += 1) pagesToPrint.push(...pageOrder);
      } else {
        for (const page of pageOrder) {
          for (let copy = 0; copy < copies; copy += 1) pagesToPrint.push(page);
        }
      }

      void (async () => {
        try {
          const backendOrigin = (process.env.KIOSK_HARDWARE_BACKEND_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');
          const confirmationToken = process.env.GCASH_CONFIRM_TOKEN || '';

          for (const page of pagesToPrint) {
            job.status = 'submitting';
            const feedHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
            if (confirmationToken) feedHeaders['X-GCash-Confirm-Token'] = confirmationToken;
            const feedResponse = await fetch(`${backendOrigin}/api/hardware/feed`, {
              method: 'POST',
              headers: feedHeaders,
              body: JSON.stringify({ tray: String(req.body.paperSize).toUpperCase() }),
              signal: AbortSignal.timeout(20000),
            });
            const feedResult = await feedResponse.json().catch(() => ({}));
            if (!feedResponse.ok) {
              throw new Error(feedResult.detail || 'The paper tray motor did not complete its feed.');
            }

            const args = [
              '-d', printerQueueName,
              '-t', `PrintPoint ${sessionId} page ${page}`,
              '-o', `PageSize=${paperSize}`,
              '-o', `ColorModel=${colorMode === 'color' ? 'RGB' : 'Gray'}`,
              '-o', 'fit-to-page',
            ];
            if (isPdf) args.push('-P', String(page));
            args.push(tempPath);

            const result = await runCommand('lp', args);
            const requestId = result.stdout.match(/request id is\s+(\S+)/i)?.[1];
            if (!requestId) throw new Error(`Gutenprint queue returned no identifiable job: ${result.stdout.trim()}`);

            job.requestId = requestId;
            console.log(`[Gutenprint] Submitted ${requestId} to ${printerQueueName} for ${sessionId}`);
            await waitForCupsRequest(requestId);
          }
          job.status = 'completed';
        } catch (error) {
          job.status = 'failed';
          job.error = error instanceof Error ? error.message : String(error);
          console.error(`[Gutenprint] Print job failed for ${sessionId}: ${job.error}`);
        } finally {
          try {
            fs.rmSync(tempPath, { force: true });
          } catch {}
        }
      })();

      return res.json({ success: true, ...job, status: 'queued', queueName: printerQueueName });
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      console.error(`[Gutenprint] Print submission failed for ${sessionId}: ${job.error}`);
      return res.status(503).json({ error: job.error, queueName: printerQueueName });
    }
  });

  app.get('/api/print/status/:sessionId', async (req, res) => {
    const job = printJobsBySession.get(req.params.sessionId);
    if (!job) return res.status(404).json({ error: 'No print job exists for this session.' });
    if (job.status === 'queued' && job.requestId) {
      try {
        const [activeJobs, completedJobs] = await Promise.all([
          runCommand('lpstat', ['-W', 'not-completed', '-o', printerQueueName]),
          runCommand('lpstat', ['-W', 'completed', '-o', printerQueueName]),
        ]);
        if (completedJobs.stdout.includes(job.requestId)) job.status = 'completed';
        else if (!activeJobs.stdout.includes(job.requestId)) {
          return res.json({ ...job, queueName: printerQueueName, status: 'queued', message: 'The Gutenprint-backed queue accepted the job; waiting for printer status.' });
        }
      } catch (error) {
        return res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
      }
    }
    return res.json({ ...job, queueName: job.mode === 'simulation' ? 'Simulation' : printerQueueName });
  });

  app.post('/api/print/prepare-finalize/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const payment = paymentOrders.get(sessionId);
    if (!payment || payment.status !== 'approved') {
      return res.status(409).json({ error: 'Verified payment is unavailable for this print session.' });
    }
    const printJob = printJobsBySession.get(sessionId);
    if (!printJob || printJob.status !== 'completed') {
      return res.status(409).json({ error: 'The print queue has not confirmed this job as completed.' });
    }

    const confirmationToken = process.env.GCASH_CONFIRM_TOKEN || '';
    if (!confirmationToken) {
      return res.status(503).json({ error: 'Payment synchronization is not configured.' });
    }
    const backendOrigin = (process.env.KIOSK_HARDWARE_BACKEND_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');
    try {
      const response = await fetch(`${backendOrigin}/api/payments/sync-confirmed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GCash-Confirm-Token': confirmationToken,
        },
        body: JSON.stringify({
          session_id: sessionId,
          method: payment.method || 'gcash',
          amount_due: payment.amount,
          amount_paid: payment.amountPaid ?? payment.amount,
        }),
        signal: AbortSignal.timeout(5000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        return res.status(502).json({ error: result.detail || 'Could not synchronize verified payment with the hardware backend.' });
      }
      return res.json({ success: true, sessionId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Payment synchronization failed.';
      return res.status(502).json({ error: message });
    }
  });

  // Customer or Kiosk attaches/updates payment proof (screenshot or GCash Ref No.)
  app.post('/api/payment/:sessionId/proof', (req, res) => {
    const { sessionId } = req.params;
    const { customerReceipt, customerRef } = req.body;

    const record = paymentOrders.get(sessionId);
    if (!record) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (customerReceipt) record.customerReceipt = customerReceipt;
    if (customerRef) record.customerRef = customerRef;
    paymentOrders.set(sessionId, record);

    console.log(`[Payment] Proof updated for session ${sessionId}: Ref=${customerRef}`);

    // Forward proof to Owner App
    notifyOwnerApp(`/api/payment/${sessionId}/proof`, 'POST', req.body);

    res.json({ success: true, order: record });
  });

  // 2. Kiosk polls payment approval status (checks local state + checks remote Owner App)
  app.get('/api/payment/:sessionId/status', async (req, res) => {
    const { sessionId } = req.params;
    let record = paymentOrders.get(sessionId);

    // If local status is pending, check if the remote Owner App marked it approved
    if (ownerAppUrl && (!record || record.status === 'pending')) {
      try {
        const ownerStatusUrl = `${ownerAppUrl.replace(/\/+$/, '')}/api/payment/${sessionId}/status`;
        const ownerRes = await fetch(ownerStatusUrl, { signal: AbortSignal.timeout(1800) });
        if (ownerRes.ok) {
          const ownerData = await ownerRes.json();
          if (ownerData && (ownerData.paid || ownerData.status === 'approved')) {
            if (!record) {
              record = {
                sessionId,
                amount: ownerData.amount || 0,
                timestamp: Date.now(),
                status: 'approved',
              };
            }
            record.status = 'approved';
            record.reference = ownerData.reference || `GCASH-APPV-${sessionId.slice(0, 8).toUpperCase()}`;
            record.approvedAt = ownerData.approvedAt || Date.now();
            record.notes = ownerData.notes || 'Approved on Remote Owner App';
            paymentOrders.set(sessionId, record);
            console.log(`[Payment] Order ${sessionId} verified approved from Remote Owner App!`);
            publishPaymentStatus(record);
          }
        }
      } catch {
        // quiet timeout
      }
    }

    if (!record) {
      return res.json({ paid: false, status: 'not_found' });
    }

    if (record.status === 'approved') {
      return res.json({
        paid: true,
        status: 'approved',
        amount: record.amount,
        reference: record.reference,
        approvedAt: record.approvedAt,
      });
    }

    return res.json({
      paid: false,
      status: record.status,
      amount: record.amount,
    });
  });

  // 3. Owner App approves payment
  app.post('/api/payment/:sessionId/approve', (req, res) => {
    const { sessionId } = req.params;
    const { reference, notes, amount } = req.body;

    let record = paymentOrders.get(sessionId);
    if (!record) {
      record = {
        sessionId,
        amount: Number(amount) || 0,
        timestamp: Date.now(),
        status: 'pending',
      };
    }

    record.status = 'approved';
    record.reference = reference || `GCASH-APPV-${Date.now().toString(36).toUpperCase()}`;
    record.approvedAt = Date.now();
    record.notes = notes || 'Approved by Kiosk Owner';
    paymentOrders.set(sessionId, record);
    publishPaymentStatus(record);

    console.log(`[Payment] Order APPROVED by Owner for session ${sessionId}, Ref: ${record.reference}`);

    // Notify remote Owner App in case approval was triggered from alternate client
    notifyOwnerApp(`/api/payment/${sessionId}/approve`, 'POST', req.body);

    res.json({ success: true, order: record });
  });

  app.post('/api/payment/:sessionId/manual-confirm', (req, res) => {
    const expectedToken = process.env.GCASH_CONFIRM_TOKEN || '';
    const providedToken = String(req.header('X-GCash-Confirm-Token') || '');
    const expectedBuffer = Buffer.from(expectedToken);
    const providedBuffer = Buffer.from(providedToken);
    if (!expectedToken) {
      return res.status(503).json({ error: 'Manual GCash confirmation is not configured.' });
    }
    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      return res.status(401).json({ error: 'Invalid GCash confirmation credentials.' });
    }

    const { sessionId } = req.params;
    const record = paymentOrders.get(sessionId);
    if (!record) {
      return res.status(404).json({ error: 'No pending kiosk payment exists for this session.' });
    }
    if (record.status !== 'pending') {
      return res.status(409).json({ error: 'This kiosk payment is no longer pending.' });
    }
    if (!Number.isFinite(record.amount) || record.amount <= 0) {
      return res.status(400).json({ error: 'The pending payment has an invalid amount.' });
    }

    record.status = 'approved';
    record.method = 'gcash';
    record.amountPaid = record.amount;
    record.reference = `MANUAL-GCASH-${Date.now().toString(36).toUpperCase()}`;
    record.approvedAt = Date.now();
    record.notes = 'Manually verified by kiosk operator.';
    paymentOrders.set(sessionId, record);
    publishPaymentStatus(record);

    console.log(`[Payment] GCash manually confirmed for session ${sessionId}`);
    notifyOwnerApp(`/api/payment/${sessionId}/approve`, 'POST', {
      amount: record.amount,
      reference: record.reference,
      notes: record.notes,
    });
    return res.json({ success: true, order: record });
  });

  app.post('/api/payment/:sessionId/manual-reject', (req, res) => {
    const expectedToken = process.env.GCASH_CONFIRM_TOKEN || '';
    const providedToken = String(req.header('X-GCash-Confirm-Token') || '');
    const expectedBuffer = Buffer.from(expectedToken);
    const providedBuffer = Buffer.from(providedToken);
    if (!expectedToken) {
      return res.status(503).json({ error: 'Manual GCash confirmation is not configured.' });
    }
    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      return res.status(401).json({ error: 'Invalid GCash confirmation credentials.' });
    }

    const { sessionId } = req.params;
    const record = paymentOrders.get(sessionId);
    if (!record) {
      return res.status(404).json({ error: 'No pending kiosk payment exists for this session.' });
    }
    if (record.status !== 'pending') {
      return res.status(409).json({ error: 'This kiosk payment is no longer pending.' });
    }

    record.status = 'rejected';
    record.method = 'gcash';
    record.notes = 'GCash payment rejected by kiosk operator.';
    paymentOrders.set(sessionId, record);
    publishPaymentStatus(record);
    console.log(`[Payment] GCash manually rejected for session ${sessionId}`);
    notifyOwnerApp(`/api/payment/${sessionId}/reject`, 'POST', { notes: record.notes });
    return res.json({ success: true, order: record });
  });

  // 4. Owner App rejects/cancels payment
  app.post('/api/payment/:sessionId/reject', (req, res) => {
    const { sessionId } = req.params;
    const record = paymentOrders.get(sessionId);
    if (record) {
      record.status = 'rejected';
      paymentOrders.set(sessionId, record);
      publishPaymentStatus(record);
    }
    notifyOwnerApp(`/api/payment/${sessionId}/reject`, 'POST', req.body);
    res.json({ success: true });
  });

  // 5. Owner Dashboard endpoints: support all path conventions
  const getOrdersHandler = (_req: express.Request, res: express.Response) => {
    const orders = Array.from(paymentOrders.values()).sort((a, b) => b.timestamp - a.timestamp);
    const pending = orders.filter((o) => o.status === 'pending');
    res.json({ orders, pending, total: orders.length });
  };

  app.get('/api/kiosk/pending-payments', getOrdersHandler);
  app.get('/api/payment/pending', getOrdersHandler);
  app.get('/api/orders', getOrdersHandler);
  app.get('/api/orders/pending', getOrdersHandler);

  // Mobile QR Upload: Smartphone sends the chosen document/image
  app.post('/api/upload/:sessionId', printUpload.single('file') as any, (req, res) => {
    const { sessionId } = req.params;
    let fileName = req.body?.fileName;
    let fileDataUrl = req.body?.fileDataUrl;

    if (req.file) {
      fileName = req.file.originalname || 'uploaded_document';
      const mime = req.file.mimetype || 'application/octet-stream';
      fileDataUrl = `data:${mime};base64,${req.file.buffer.toString('base64')}`;
    }

    if (!fileName || !fileDataUrl) {
      return res.status(400).json({ error: 'fileName and fileDataUrl (or file) are required' });
    }

    sessionUploads.set(sessionId, {
      fileName,
      fileDataUrl,
      timestamp: Date.now(),
    });

    console.log(`[Kiosk Bridge] Document uploaded for session ${sessionId}: "${fileName}"`);
    return res.json({ success: true, sessionId, fileName });
  });

  // Kiosk Terminal Polling: Check if mobile phone uploaded a file for this session
  app.get('/api/session/:sessionId/file', (req, res) => {
    const { sessionId } = req.params;
    const data = sessionUploads.get(sessionId);

    if (!data) {
      return res.json({ uploaded: false });
    }

    return res.json({
      uploaded: true,
      fileName: data.fileName,
      fileDataUrl: data.fileDataUrl,
      timestamp: data.timestamp,
    });
  });

  // Clean up session document once loaded into kiosk memory
  app.delete('/api/session/:sessionId/file', (req, res) => {
    const { sessionId } = req.params;
    sessionUploads.delete(sessionId);
    return res.json({ success: true });
  });

  // Bluetooth Kiosk Beacon & Receiver Activation
  app.post('/api/bluetooth/enable', (_req, res) => {
    return res.json({
      success: true,
      status: 'enabled',
      deviceName: 'PrintPoint-Vendo-Kiosk',
      pairingPin: '0000',
      message: 'Bluetooth service standby. Kiosk ready to accept file transmissions.',
    });
  });

  // Recent Kiosk Uploads queue endpoint (Enforces 30-min auto-deletion)
  app.get('/api/recent_uploads', (_req, res) => {
    const now = Date.now();
    const THIRTY_MINUTES_MS = 30 * 60 * 1000;

    // Auto-delete expired files older than 30 minutes
    for (const [sid, item] of sessionUploads.entries()) {
      if (item.timestamp && now - item.timestamp > THIRTY_MINUTES_MS) {
        sessionUploads.delete(sid);
      }
    }

    const files = Array.from(sessionUploads.entries())
      .filter(([_, item]) => !item.timestamp || now - item.timestamp <= THIRTY_MINUTES_MS)
      .map(([sid, item]) => {
        const ageMs = item.timestamp ? now - item.timestamp : 0;
        const minutesLeft = Math.max(1, Math.ceil((THIRTY_MINUTES_MS - ageMs) / 60000));
        return {
          sessionId: sid,
          name: item.fileName,
          url: `/api/session/${encodeURIComponent(sid)}/file`,
          timestamp: item.timestamp,
          expiresInMinutes: minutesLeft,
        };
      });

    return res.json({ success: true, files });
  });

  // Sandboxed External USB Flash Drive scanner
  // Scans auto-mounted drives in /media/pi or /media/usb without exposing the host OS filesystem
  app.get('/api/usb/files', (_req, res) => {
    const supportedExtensions = ['.pdf', '.docx', '.doc', '.jpg', '.jpeg', '.png'];
    const possibleMountPaths = ['/media/pi', '/media/usb', '/media', '/mnt/usb'];
    const files: Array<{ name: string; relativePath: string; size: number }> = [];

    for (const mountRoot of possibleMountPaths) {
      try {
        if (!fs.existsSync(mountRoot)) continue;
        const subdirs = fs.readdirSync(mountRoot, { withFileTypes: true });
        for (const item of subdirs) {
          if (item.isDirectory()) {
            const drivePath = path.join(mountRoot, item.name);
            try {
              const driveFiles = fs.readdirSync(drivePath);
              for (const df of driveFiles) {
                const ext = path.extname(df).toLowerCase();
                if (supportedExtensions.includes(ext)) {
                  const stat = fs.statSync(path.join(drivePath, df));
                  files.push({ name: df, relativePath: `${item.name}/${df}`, size: stat.size });
                }
              }
            } catch {
              // ignore unreadable dirs
            }
          }
        }
      } catch {
        // quiet
      }
    }

    return res.json({
      success: true,
      usbMounted: files.length > 0,
      count: files.length,
      files,
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Kiosk Server] Ready and listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
