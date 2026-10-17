import React, { useEffect, useState } from 'react';
import { Printer, CheckCircle2, AlertTriangle, LoaderCircle } from 'lucide-react';
import { ColorMode, PaperSize, PricingBreakdown } from '../types';

interface PrintingStepProps {
  sessionId: string;
  pdfUrl: string;
  fileName: string;
  pricing: PricingBreakdown;
  selectedPages: number[];
  paperSize: PaperSize;
  colorMode: ColorMode;
  copies: number;
  reverseOrder: boolean;
  collate: boolean;
  onComplete: (result: Record<string, unknown>) => void;
}

export const PrintingStep: React.FC<PrintingStepProps> = ({
  sessionId,
  pdfUrl,
  fileName,
  pricing,
  selectedPages,
  paperSize,
  colorMode,
  copies,
  reverseOrder,
  collate,
  onComplete,
}) => {
  const totalSheets = pricing.total_sheets_to_feed;
  const [status, setStatus] = useState<'submitting' | 'queued' | 'dispensing' | 'completed' | 'failed'>('submitting');
  const [queueName, setQueueName] = useState('L120-Series');
  const [jobId, setJobId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [dispenseMessage, setDispenseMessage] = useState('');
  const [canRetryPrint, setCanRetryPrint] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let pollTimeout: ReturnType<typeof setTimeout> | undefined;
    let activeSocket: WebSocket | undefined;

    const submitPrintJob = async () => {
      setStatus('submitting');
      setErrorMessage('');
      setJobId('');
      setCanRetryPrint(false);
      try {
        if (!pdfUrl) throw new Error('The uploaded document is no longer available. Return and upload it again.');
        const documentResponse = await fetch(pdfUrl);
        if (!documentResponse.ok) throw new Error('Could not read the uploaded document.');
        let documentBlob = await documentResponse.blob();
        if (documentBlob.type === 'image/webp') {
          const image = await createImageBitmap(documentBlob);
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          canvas.getContext('2d')?.drawImage(image, 0, 0);
          image.close();
          documentBlob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not convert the image for printing.')), 'image/png');
          });
        }
        const mimeType = documentBlob.type || 'application/pdf';
        if (!['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg'].includes(mimeType)) {
          throw new Error('Accepted formats are PDF, DOCX, PNG, and JPEG.');
        }
        const backendOrigin = `${window.location.protocol}//${window.location.hostname}:3001`;
        const retainedDocument = new FormData();
        retainedDocument.append('file', documentBlob, fileName || 'document');
        const retainedResponse = await fetch(
          `${backendOrigin}/api/privacy/store/${encodeURIComponent(sessionId)}`,
          { method: 'POST', body: retainedDocument }
        );
        const retainedResult = await retainedResponse.json().catch(() => ({}));
        if (!retainedResponse.ok) {
          throw new Error(retainedResult.detail || 'Could not securely store the document for your privacy choice.');
        }
        const form = new FormData();
        form.append('document', documentBlob, fileName || `document.${mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : 'jpg'}`);
        form.append('sessionId', sessionId);
        form.append('selectedPages', JSON.stringify(selectedPages));
        form.append('paperSize', paperSize);
        form.append('colorMode', colorMode);
        form.append('copies', String(copies));
        form.append('reverseOrder', String(reverseOrder));
        form.append('collate', String(collate));
        form.append('retry', String(retryCount > 0));

        const response = await fetch('/api/print/submit', { method: 'POST', body: form });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'The printer rejected the print job.');
        if (result.mode === 'simulation') throw new Error('Simulated print mode is disabled. No payment was sent to a simulated printer.');
        if (cancelled) return;
        setJobId(result.requestId || result.jobId || '');
        setQueueName(result.queueName || 'L120-Series');
        setStatus(result.status === 'completed' ? 'completed' : 'queued');

        const pollPrintStatus = async () => {
          if (cancelled) return;
          try {
            const statusResponse = await fetch(`/api/print/status/${encodeURIComponent(sessionId)}`);
            const statusResult = await statusResponse.json().catch(() => ({}));
            if (!statusResponse.ok) throw new Error(statusResult.error || 'Could not read Gutenprint printer status.');
            if (cancelled) return;
            setQueueName(statusResult.queueName || 'L120-Series');
            if (statusResult.mode === 'simulation') throw new Error('Simulated print mode is disabled.');
            setJobId(statusResult.requestId || result.requestId || result.jobId || '');
            if (statusResult.status === 'completed') {
              setStatus('dispensing');
              setDispenseMessage('Dispensing your change...');
              const websocketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
              const socket = new WebSocket(
                `${websocketProtocol}//${window.location.hostname}:3001/ws/${encodeURIComponent(sessionId)}`
              );
              activeSocket = socket;
              let resolveServerReady: () => void = () => {};
              let resolveTransactionComplete: (data: Record<string, unknown>) => void = () => {};
              let completionHandled = false;
              let eventChannelReady = false;
              const serverReady = new Promise<void>((resolve) => { resolveServerReady = resolve; });
              const transactionComplete = new Promise<Record<string, unknown>>((resolve) => {
                resolveTransactionComplete = resolve;
              });
              socket.onmessage = (message) => {
                try {
                  const event = JSON.parse(message.data);
                  if (event.event === 'connection_ack') {
                    eventChannelReady = true;
                    resolveServerReady();
                  } else if (event.event === 'TRANSACTION_COMPLETE') {
                    if (!completionHandled) {
                      completionHandled = true;
                      resolveTransactionComplete(event.data || {});
                      setStatus('completed');
                      onComplete(event.data || {});
                    }
                  } else if (event.event === 'dispensing_change') {
                    setDispenseMessage('Dispensing your change...');
                  } else if (event.event === 'change_dispense_failed' || event.event === 'hopper_error') {
                    setErrorMessage(event.data?.message || 'The hopper could not confirm change delivery.');
                    setStatus('failed');
                  }
                } catch {
                  // Ignore non-event WebSocket messages.
                }
              };
              try {
                try {
                  await Promise.race([
                    new Promise<void>((resolve, reject) => {
                      socket.addEventListener('open', () => resolve(), { once: true });
                      socket.addEventListener('error', () => reject(new Error('Could not connect to transaction updates.')), { once: true });
                    }),
                    new Promise<void>((_, reject) => window.setTimeout(() => reject(new Error('Timed out connecting to transaction updates.')), 5000)),
                  ]);
                  await Promise.race([
                    serverReady,
                    new Promise<void>((_, reject) => window.setTimeout(() => reject(new Error('Transaction update channel was not ready.')), 5000)),
                  ]);
                } catch {
                  eventChannelReady = false;
                }
                const paymentSyncResponse = await fetch(
                  `/api/print/prepare-finalize/${encodeURIComponent(sessionId)}`,
                  { method: 'POST' }
                );
                const paymentSyncResult = await paymentSyncResponse.json().catch(() => ({}));
                if (!paymentSyncResponse.ok) {
                  throw new Error(paymentSyncResult.error || 'Verified payment could not be synchronized with the hardware backend.');
                }

                const finalizeResponse = await fetch(`${backendOrigin}/api/print/finalize`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    session_id: sessionId,
                    job_id: statusResult.requestId || result.requestId || result.jobId || undefined,
                  }),
                });
                const finalizeResult = await finalizeResponse.json().catch(() => ({}));
                if (!finalizeResponse.ok) {
                  throw new Error(finalizeResult.detail || 'Change dispensing could not be confirmed.');
                }
                if (cancelled) return;
                if (!completionHandled) {
                  const completedEvent = eventChannelReady
                    ? await Promise.race([
                        transactionComplete,
                        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 5000)),
                      ])
                    : null;
                  if (!completionHandled && !cancelled) {
                    completionHandled = true;
                    onComplete(completedEvent || finalizeResult);
                  }
                }
                socket.close();
              } catch (error) {
                socket.close();
                if (cancelled) return;
                setErrorMessage(error instanceof Error ? error.message : 'Change dispensing failed.');
                setCanRetryPrint(false);
                setStatus('failed');
              }
              return;
            }
            if (statusResult.status === 'failed') throw new Error(statusResult.error || 'The printer reported that the job failed.');
            setStatus('queued');
            pollTimeout = setTimeout(pollPrintStatus, 1500);
          } catch (error) {
            if (cancelled) return;
            setErrorMessage(error instanceof Error ? error.message : 'Could not read printer status.');
            setCanRetryPrint(true);
            setStatus('failed');
          }
        };
        void pollPrintStatus();
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : 'Could not submit the print job.');
        setCanRetryPrint(true);
        setStatus('failed');
      }
    };

    void submitPrintJob();
    return () => {
      cancelled = true;
      if (pollTimeout) clearTimeout(pollTimeout);
      activeSocket?.close();
    };
  }, [sessionId, pdfUrl, fileName, selectedPages, paperSize, colorMode, copies, reverseOrder, collate, retryCount, onComplete]);

  const isComplete = status === 'completed';
  const isFailed = status === 'failed';
  const isDispensing = status === 'dispensing';

  return (
    <div className="max-w-2xl mx-auto py-16 px-4 text-center">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 sm:p-12 shadow-2xl relative overflow-hidden">
        {/* Glow backdrop */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-emerald-600/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative inline-block mb-6">
          <div className="w-24 h-24 rounded-3xl bg-blue-600/10 border border-blue-500/30 flex items-center justify-center text-blue-400 mx-auto shadow-inner animate-pulse">
            <Printer className="w-12 h-12" />
          </div>
          <span className={`absolute -bottom-2 -right-2 p-1.5 rounded-full ${isFailed ? 'bg-rose-500' : 'bg-emerald-500'} text-slate-950 font-bold`}>
            {isFailed ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          </span>
        </div>

        <h2 className="text-2xl font-black text-white mb-2">
          {isComplete ? 'Transaction Complete' : isFailed ? 'Print or Hardware Error' : isDispensing ? 'Dispensing in Progress' : 'Printing / Dispensing in Progress...'}
        </h2>
        <p className="text-sm text-slate-400 mb-8">
          {isDispensing
            ? dispenseMessage || 'Dispensing your change...'
            : isComplete
            ? `The printer completed the job on ${queueName}.`
            : isFailed
              ? errorMessage
              : status === 'submitting'
                ? `Sending your paid job to the printer on ${queueName}...`
                : `Your paid job is in the printer queue ${queueName}.`}
        </p>

        <div className={`rounded-xl border px-4 py-4 mb-8 font-bold ${isFailed ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
          <div className="flex items-center justify-center gap-2 mb-3">
            {isComplete ? <CheckCircle2 className="w-5 h-5" /> : isFailed ? <AlertTriangle className="w-5 h-5" /> : <LoaderCircle className="w-5 h-5 animate-spin" />}
            <span>
              {isDispensing
                ? 'Waiting for the hardware transaction to finish...'
                : isComplete
                ? `${totalSheets} sheet${totalSheets === 1 ? '' : 's'} sent and completed`
                : isFailed
                  ? 'Print job was not completed'
                  : status === 'submitting'
                    ? 'Submitting print job...'
                    : 'Waiting for printer completion...'}
            </span>
          </div>
          {jobId && <div className="text-xs mt-2">Gutenprint job: {jobId}</div>}
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-left font-mono text-xs text-slate-400 space-y-1">
          <div className="text-emerald-400 font-bold">▶ Payment: CONFIRMED</div>
          <div>▶ Printer queue: {queueName}</div>
          <div>▶ Print job: {isComplete || isDispensing ? 'COMPLETE' : isFailed ? 'FAILED' : status.toUpperCase()}</div>
          {isDispensing && <div>▶ Change: WAITING FOR HOPPER CONFIRMATION</div>}
        </div>
        {isFailed && canRetryPrint && (
          <button
            onClick={() => setRetryCount((current) => current + 1)}
            className="mt-5 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm cursor-pointer"
          >
            Retry Print Job
          </button>
        )}
      </div>
    </div>
  );
};
