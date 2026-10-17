import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { defineConfig, Plugin } from 'vite';

interface PaymentRecord {
  sessionId: string;
  amount: number;
  fileName?: string;
  pageCount?: number;
  copies?: number;
  colorMode?: string;
  timestamp: number;
  status: 'pending' | 'approved' | 'rejected';
  reference?: string;
  approvedAt?: number;
  notes?: string;
  orderScreenshot?: string;
  customerReceipt?: string;
  customerRef?: string;
}

const sessionUploads = new Map<
  string,
  { fileName: string; fileDataUrl: string; timestamp: number }
>();
const printDocumentsDir = process.env.PRINT_DOCUMENTS_DIR || './uploads';
fs.mkdirSync(printDocumentsDir, { recursive: true });

function removeExpiredPrintDocuments() {
  const expiry = Date.now() - 30 * 60 * 1000;
  for (const sessionName of fs.readdirSync(printDocumentsDir)) {
    const sessionDir = path.join(printDocumentsDir, sessionName);
    if (!fs.statSync(sessionDir).isDirectory()) continue;
    if (fs.statSync(sessionDir).mtimeMs < expiry) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      console.log(`[Upload Cleanup] Removed expired documents for ${sessionName}`);
    }
  }
}

const ORDERS_FILE = '/tmp/kiosk_orders.json';

function loadOrdersFromDisk(): Map<string, PaymentRecord> {
  const map = new Map<string, PaymentRecord>();
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      const raw = fs.readFileSync(ORDERS_FILE, 'utf-8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && item.sessionId) {
            map.set(item.sessionId, item);
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to load orders from disk:', err);
  }
  return map;
}

function saveOrdersToDisk(map: Map<string, PaymentRecord>) {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(Array.from(map.values()), null, 2));
  } catch (err) {
    console.error('Failed to save orders to disk:', err);
  }
}

const paymentOrders = loadOrdersFromDisk();

function getKioskUploadOrigin(hostHeader?: string, forwardedProtocol?: string) {
  const configuredOrigin = process.env.KIOSK_PUBLIC_URL?.trim();
  if (configuredOrigin) return configuredOrigin.replace(/\/+$/, '');

  const host = hostHeader?.split(',')[0].trim();
  const protocol = forwardedProtocol?.split(',')[0].trim() || 'http';
  if (host && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)) {
    return `${protocol}://${host}`;
  }

  const addresses = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries || [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
  const address = addresses.find((ip) => !ip.startsWith('172.17.')) || addresses[0];
  return address ? `http://${address}:3000` : `http://${host || 'localhost:3000'}`;
}

let ownerAppUrl =
  process.env.OWNER_APP_URL ||
  'https://ais-dev-c6d32e42tdbjv5z6yuynjk-604002314892.asia-southeast1.run.app';

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

function kioskApiPlugin(): Plugin {
  return {
    name: 'kiosk-api',
    configureServer(server) {
      const cleanupTimer = setInterval(removeExpiredPrintDocuments, 2 * 60 * 1000);
      server.httpServer?.once('close', () => clearInterval(cleanupTimer));
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();

        const urlObj = new URL(req.url, 'http://localhost:3000');
        const pathname = urlObj.pathname;

        if (pathname === '/api/kiosk/upload-origin' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ origin: getKioskUploadOrigin(req.headers.host, req.headers['x-forwarded-proto'] as string) }));
          return;
        }

        try {
          const fullInfo = `${new Date().toISOString()} ${req.method} ${pathname} (query: ${urlObj.search})\n`;
          fs.appendFileSync('/tmp/kiosk_requests.log', fullInfo);
        } catch {}

        // Helper to read JSON request body
        const readJsonBody = (): Promise<any> => {
          return new Promise((resolve) => {
            let body = '';
            req.on('data', (chunk) => {
              body += chunk;
            });
            req.on('end', () => {
              try {
                resolve(JSON.parse(body || '{}'));
              } catch {
                resolve({});
              }
            });
          });
        };

        // 1. Health check
        if (pathname === '/api/health') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              status: 'ok',
              time: new Date().toISOString(),
              ownerAppUrl,
              kioskUrl: 'https://ais-dev-gvqgfzsddvwzvo4ks5rgyw-604002314892.asia-southeast1.run.app',
            })
          );
          return;
        }

        // 2. Owner App URL inspection and updating
        if (pathname === '/api/kiosk/owner-url') {
          if (req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                ownerAppUrl,
                kioskUrl: 'https://ais-dev-gvqgfzsddvwzvo4ks5rgyw-604002314892.asia-southeast1.run.app',
                kioskSharedUrl: 'https://ais-pre-gvqgfzsddvwzvo4ks5rgyw-604002314892.asia-southeast1.run.app',
              })
            );
            return;
          }
          if (req.method === 'POST') {
            const body = await readJsonBody();
            if (body.url && typeof body.url === 'string') {
              ownerAppUrl = body.url.trim();
              console.log(`[Owner Sync] Updated ownerAppUrl to: ${ownerAppUrl}`);
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, ownerAppUrl }));
            return;
          }
        }

        // 3. Father GCash QR Storage & Status
        const publicDir = path.join(process.cwd(), 'public');
        if (!fs.existsSync(publicDir)) {
          fs.mkdirSync(publicDir, { recursive: true });
        }

        if (pathname === '/api/kiosk/save-qr' && req.method === 'POST') {
          const body = await readJsonBody();
          const { imageData } = body;
          if (!imageData || typeof imageData !== 'string') {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'imageData required' }));
            return;
          }
          const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          const targetPath = path.join(publicDir, 'father-gcash-qr.png');
          fs.writeFileSync(targetPath, buffer);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, url: '/father-gcash-qr.png', timestamp: Date.now() }));
          return;
        }

        if (pathname === '/api/kiosk/qr-status' && req.method === 'GET') {
          const targetPath = path.join(publicDir, 'father-gcash-qr.png');
          const exists = fs.existsSync(targetPath);
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              hasQR: exists,
              url: exists ? `/father-gcash-qr.png?v=${fs.statSync(targetPath).mtimeMs}` : null,
            })
          );
          return;
        }

        // 0. Enable CORS for cross-origin communication with Owner App
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }

        // Helper to format an order for any Owner App schema
        const formatOrderForApp = (o: PaymentRecord) => ({
          id: o.sessionId,
          sessionId: o.sessionId,
          orderId: o.sessionId,
          amount: o.amount,
          totalAmount: o.amount,
          price: o.amount,
          total_price: o.amount,
          fileName: o.fileName || 'Document.pdf',
          documentName: o.fileName || 'Document.pdf',
          file: o.fileName || 'Document.pdf',
          title: o.fileName || 'Document.pdf',
          pageCount: o.pageCount || 1,
          pages: o.pageCount || 1,
          totalPages: o.pageCount || 1,
          total_pages: o.pageCount || 1,
          copies: o.copies || 1,
          colorMode: o.colorMode || 'bw',
          color_mode: o.colorMode || 'bw',
          color: o.colorMode === 'color',
          isColor: o.colorMode === 'color',
          orderScreenshot: o.orderScreenshot,
          screenshot: o.orderScreenshot,
          receipt: o.orderScreenshot,
          receiptUrl: o.orderScreenshot,
          customerReceipt: o.customerReceipt,
          customerRef: o.customerRef,
          reference: o.reference || o.customerRef,
          status: o.status,
          timestamp: o.timestamp,
          createdAt: new Date(o.timestamp).toISOString(),
          time: new Date(o.timestamp).toLocaleTimeString(),
          notes: o.notes,
          approvedAt: o.approvedAt,
        });

        // 4. Kiosk notifies server of pending order (includes order screenshot)
        if (
          ((pathname.startsWith('/api/payment/') && pathname.endsWith('/pending')) ||
            pathname === '/api/payment/pending' ||
            pathname === '/api/kiosk/pending') &&
          req.method === 'POST'
        ) {
          const parts = pathname.split('/');
          const body = await readJsonBody();
          const sessionId = parts[3] || body.sessionId || body.id || `sess_${Date.now().toString(36)}`;

          const record: PaymentRecord = {
            sessionId,
            amount: Number(body.amount) || Number(body.price) || 0,
            fileName: body.fileName || body.documentName || 'Document.pdf',
            pageCount: body.pageCount || body.pages || 1,
            copies: body.copies || 1,
            colorMode: body.colorMode || 'bw',
            orderScreenshot: body.orderScreenshot || body.screenshot || undefined,
            customerReceipt: body.customerReceipt || undefined,
            customerRef: body.customerRef || undefined,
            timestamp: Date.now(),
            status: 'pending',
          };

          paymentOrders.set(sessionId, record);
          saveOrdersToDisk(paymentOrders);
          console.log(`[Payment] Pending order registered for ${sessionId}: ₱${record.amount} (Screenshot: ${Boolean(record.orderScreenshot)})`);

          notifyOwnerApp(`/api/payment/${sessionId}/pending`, 'POST', body);

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, order: formatOrderForApp(record) }));
          return;
        }

        // 5. Customer submits proof (screenshot or GCash Ref No.)
        if (pathname.startsWith('/api/payment/') && pathname.endsWith('/proof') && req.method === 'POST') {
          const parts = pathname.split('/');
          const sessionId = parts[3];
          const body = await readJsonBody();

          let record = paymentOrders.get(sessionId);
          if (!record) {
            record = {
              sessionId,
              amount: Number(body.amount) || 10,
              timestamp: Date.now(),
              status: 'pending',
            };
          }

          if (body.customerReceipt) record.customerReceipt = body.customerReceipt;
          if (body.customerRef) record.customerRef = body.customerRef;
          paymentOrders.set(sessionId, record);
          saveOrdersToDisk(paymentOrders);

          notifyOwnerApp(`/api/payment/${sessionId}/proof`, 'POST', body);

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, order: formatOrderForApp(record) }));
          return;
        }

        // 6. Kiosk polls payment approval status (checks local state + checks remote Owner App)
        if (pathname.startsWith('/api/payment/') && pathname.endsWith('/status')) {
          const parts = pathname.split('/');
          const sessionId = parts[3];

          if (req.method === 'GET') {
            let record = paymentOrders.get(sessionId);

            // If not found, auto-register it using query params so it immediately appears in Owner App
            if (!record) {
              const amountQuery = Number(urlObj.searchParams.get('amount')) || 10.0;
              const pagesQuery = Number(urlObj.searchParams.get('pages')) || 1;
              const copiesQuery = Number(urlObj.searchParams.get('copies')) || 1;
              const colorQuery = urlObj.searchParams.get('color') || 'bw';
              const fileQuery = urlObj.searchParams.get('file') || `${pagesQuery} page(s) Document`;

              record = {
                sessionId,
                amount: amountQuery,
                fileName: fileQuery,
                pageCount: pagesQuery,
                copies: copiesQuery,
                colorMode: colorQuery,
                timestamp: Date.now(),
                status: 'pending',
              };
              paymentOrders.set(sessionId, record);
              saveOrdersToDisk(paymentOrders);
              console.log(`[Payment] Auto-registered pending session from poll: ${sessionId} (₱${record.amount})`);
            }

            // If still pending, check remote Owner App
            if (ownerAppUrl && record.status === 'pending') {
              try {
                const ownerStatusUrl = `${ownerAppUrl.replace(/\/+$/, '')}/api/payment/${sessionId}/status`;
                const ownerRes = await fetch(ownerStatusUrl, { signal: AbortSignal.timeout(1800) });
                if (ownerRes.ok) {
                  const ownerData = await ownerRes.json();
                  if (ownerData && (ownerData.paid || ownerData.status === 'approved')) {
                    record.status = 'approved';
                    record.reference = ownerData.reference || `GCASH-APPV-${sessionId.slice(0, 8).toUpperCase()}`;
                    record.approvedAt = ownerData.approvedAt || Date.now();
                    record.notes = ownerData.notes || 'Approved on Remote Owner App';
                    paymentOrders.set(sessionId, record);
                    saveOrdersToDisk(paymentOrders);
                    console.log(`[Payment] Order ${sessionId} verified approved from Remote Owner App!`);
                  }
                }
              } catch {
                // quiet timeout
              }
            }

            res.setHeader('Content-Type', 'application/json');
            if (record.status === 'approved') {
              res.end(
                JSON.stringify({
                  paid: true,
                  status: 'approved',
                  amount: record.amount,
                  reference: record.reference,
                  approvedAt: record.approvedAt,
                })
              );
            } else {
              res.end(JSON.stringify({ paid: false, status: record.status, amount: record.amount }));
            }
            return;
          }

          if (req.method === 'DELETE') {
            paymentOrders.delete(sessionId);
            saveOrdersToDisk(paymentOrders);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
            return;
          }
        }

        // 7. Owner App approves payment (supports all possible path conventions)
        const isApproveRoute =
          (pathname.startsWith('/api/payment/') && pathname.endsWith('/approve')) ||
          (pathname.startsWith('/api/payment/') && pathname.endsWith('/confirm')) ||
          (pathname.startsWith('/api/kiosk/approve/')) ||
          (pathname.startsWith('/api/kiosk/orders/') && pathname.endsWith('/approve')) ||
          (pathname.startsWith('/api/orders/') && pathname.endsWith('/approve')) ||
          pathname === '/api/orders/approve' ||
          pathname === '/api/payment/approve' ||
          pathname === '/api/kiosk/pending-payments/approve';

        if (isApproveRoute && req.method === 'POST') {
          const body = await readJsonBody();
          const segments = pathname.split('/').filter(Boolean);
          // Extract sessionId from URL or body
          let sessionId = body.sessionId || body.id || body.orderId;
          if (!sessionId) {
            for (const seg of segments) {
              if (paymentOrders.has(seg)) {
                sessionId = seg;
                break;
              }
            }
          }
          if (!sessionId && segments.length >= 3) {
            sessionId = segments[2] === 'approve' ? segments[1] : segments[2];
          }

          let record = sessionId ? paymentOrders.get(sessionId) : null;
          if (!record) {
            // Find most recent pending order if not identified
            const pendingOrders = Array.from(paymentOrders.values()).filter((o) => o.status === 'pending');
            if (pendingOrders.length > 0) {
              record = pendingOrders[0];
              sessionId = record.sessionId;
            } else {
              sessionId = sessionId || `sess_${Date.now().toString(36)}`;
              record = {
                sessionId,
                amount: Number(body.amount) || 10.0,
                timestamp: Date.now(),
                status: 'pending',
              };
            }
          }

          record.status = 'approved';
          record.reference = body.reference || `GCASH-APPV-${Date.now().toString(36).toUpperCase()}`;
          record.approvedAt = Date.now();
          record.notes = body.notes || 'Approved by Kiosk Owner App';
          paymentOrders.set(sessionId!, record);
          saveOrdersToDisk(paymentOrders);

          console.log(`[Payment] Order APPROVED for session ${sessionId}, Ref: ${record.reference}`);
          notifyOwnerApp(`/api/payment/${sessionId}/approve`, 'POST', body);

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, order: formatOrderForApp(record) }));
          return;
        }

        // 8. Owner App rejects payment
        if (pathname.startsWith('/api/payment/') && pathname.endsWith('/reject') && req.method === 'POST') {
          const parts = pathname.split('/');
          const sessionId = parts[3];
          const body = await readJsonBody();

          const record = paymentOrders.get(sessionId);
          if (record) {
            record.status = 'rejected';
            paymentOrders.set(sessionId, record);
            saveOrdersToDisk(paymentOrders);
          }
          notifyOwnerApp(`/api/payment/${sessionId}/reject`, 'POST', body);

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true }));
          return;
        }

        // 9. Quick Test Order endpoints (triggered by "+ Quick Test Kiosk Order" button in Owner App)
        if (
          (pathname === '/api/kiosk/test-order' ||
            pathname === '/api/test-order' ||
            pathname === '/api/orders/test' ||
            pathname === '/api/payment/test' ||
            (pathname === '/api/kiosk/pending-payments' && req.method === 'POST'))
        ) {
          const body = await readJsonBody();
          const testId = 'test_' + Date.now().toString(36);
          const testOrder: PaymentRecord = {
            sessionId: testId,
            amount: Number(body.amount) || 15.0,
            fileName: body.fileName || 'Sample_Document.pdf',
            pageCount: body.pageCount || 3,
            copies: body.copies || 1,
            colorMode: body.colorMode || 'bw',
            timestamp: Date.now(),
            status: 'pending',
            notes: 'Created via Cashier Quick Test button',
          };
          paymentOrders.set(testId, testOrder);
          saveOrdersToDisk(paymentOrders);
          console.log(`[Payment] Created quick test order: ${testId} for ₱${testOrder.amount}`);

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, order: formatOrderForApp(testOrder) }));
          return;
        }

        // 10. Owner Dashboard: Fetch orders across all common URL routes
        if (
          (pathname === '/api/kiosk/pending-payments' ||
            pathname === '/api/payment/pending' ||
            pathname === '/api/orders' ||
            pathname === '/api/orders/pending') &&
          req.method === 'GET'
        ) {
          const orders = Array.from(paymentOrders.values()).sort((a, b) => b.timestamp - a.timestamp);
          const formattedOrders = orders.map(formatOrderForApp);
          const formattedPending = formattedOrders.filter((o) => o.status === 'pending');
          const approvedOrders = formattedOrders.filter((o) => o.status === 'approved');

          const todayGcash = approvedOrders.reduce((sum, o) => sum + (o.amount || 0), 0);
          const todayPages = approvedOrders.reduce((sum, o) => sum + ((o.pageCount || 1) * (o.copies || 1)), 0);

          // Support clients that expect an array directly via format=array query or raw endpoint
          if (urlObj.searchParams.get('format') === 'array') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(formattedPending));
            return;
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              orders: formattedOrders,
              pending: formattedPending,
              pendingOrders: formattedPending,
              pendingPayments: formattedPending,
              data: formattedPending,
              total: formattedOrders.length,
              totalPending: formattedPending.length,
              count: formattedPending.length,
              todayGcash,
              todayPages,
              shiftTotal: todayGcash,
              shiftPages: todayPages,
            })
          );
          return;
        }

        // 10. Mobile QR Document Upload (POST /api/upload/:sessionId)
        if (pathname.startsWith('/api/upload/') && req.method === 'POST') {
          const sessionId = pathname.replace('/api/upload/', '');
          const parsed = await readJsonBody();
          if (!parsed.fileName || !parsed.fileDataUrl) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'fileName and fileDataUrl required' }));
            return;
          }
          sessionUploads.set(sessionId, {
            fileName: parsed.fileName,
            fileDataUrl: parsed.fileDataUrl,
            timestamp: Date.now(),
          });
          const sessionDir = path.join(printDocumentsDir, sessionId.replace(/[^a-zA-Z0-9_-]/g, '_'));
          fs.mkdirSync(sessionDir, { recursive: true });
          const safeFileName = parsed.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
          const dataMatch = parsed.fileDataUrl.match(/^data:[^;]+;base64,(.+)$/s);
          if (dataMatch) {
            fs.writeFileSync(path.join(sessionDir, safeFileName), Buffer.from(dataMatch[1], 'base64'));
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, sessionId, fileName: parsed.fileName }));
          return;
        }

        // 11. Kiosk Terminal Session Polling (GET/DELETE /api/session/:sessionId/file)
        if (pathname.startsWith('/api/session/') && pathname.endsWith('/file')) {
          const parts = pathname.split('/');
          const sessionId = parts[3];

          if (req.method === 'GET') {
            const data = sessionUploads.get(sessionId);
            res.setHeader('Content-Type', 'application/json');
            if (!data) {
              res.end(JSON.stringify({ uploaded: false }));
            } else {
              res.end(
                JSON.stringify({
                  uploaded: true,
                  fileName: data.fileName,
                  fileDataUrl: data.fileDataUrl,
                  timestamp: data.timestamp,
                })
              );
            }
            return;
          }

          if (req.method === 'DELETE') {
            sessionUploads.delete(sessionId);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
            return;
          }
        }

        if (pathname.startsWith('/api/upload/') && pathname.endsWith('/delete') && req.method === 'DELETE') {
          const sessionId = pathname.slice('/api/upload/'.length, -'/delete'.length);
          const sessionDir = path.join(printDocumentsDir, sessionId.replace(/[^a-zA-Z0-9_-]/g, '_'));
          sessionUploads.delete(sessionId);
          fs.rmSync(sessionDir, { recursive: true, force: true });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, deleted: true }));
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), kioskApiPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
