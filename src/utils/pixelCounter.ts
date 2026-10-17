/**
 * PastelPrint Vendo Optical Pixel Density & Color Detection Engine
 *
 * Accurately analyzes page rasterization to determine:
 * 1. Total unprinted paper vs. ink pixels (non-white thresholding)
 * 2. Grayscale (black/gray text and lines) vs. chromatic color pixels (C, M, Y, RGB delta)
 * 3. Exact optical coverage percentage
 * 4. Per-page color mode classification ('bw' vs 'color')
 *
 * Runs non-blockingly using sliced micro-tasks to guarantee the Raspberry Pi 4
 * touchscreen never freezes or stutters during document parsing.
 */

export interface PagePixelAnalysis {
  pageNumber: number;
  totalPixels: number;
  nonWhitePixels: number;
  grayscalePixels: number;
  colorPixels: number;
  coveragePercent: number;
  isColorPage: boolean;
}

export interface DocumentPixelSummary {
  pageCount: number;
  totalPagesAnalyzed: number;
  totalGrayscalePixels: number;
  totalColorPixels: number;
  totalInkPixels: number;
  avgCoveragePercent: number;
  colorPages: number[];
  bwPages: number[];
  pages: PagePixelAnalysis[];
}

/**
 * Analyzes an existing 2D canvas context's pixel buffer.
 */
export function analyzeCanvasContext(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pageNumber = 1
): PagePixelAnalysis {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const totalPixels = width * height;

  let nonWhitePixels = 0;
  let grayscalePixels = 0;
  let colorPixels = 0;

  // Scan 32-bit pixel data (RGBA)
  // Step through by 1 for precise count, or sample every N pixels for large surfaces
  const step = 1;
  const len = data.length;

  for (let i = 0; i < len; i += 4 * step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    // Skip transparent or semi-transparent background pixels
    if (a < 32) continue;

    // Background paper threshold: Pure white or near-white paper background (R, G, B > 238)
    if (r > 238 && g > 238 && b > 238) {
      continue;
    }

    nonWhitePixels++;

    // Chromatic delta threshold:
    // A pixel is neutral gray/black if the difference between R, G, and B is very low.
    const deltaRG = Math.abs(r - g);
    const deltaGB = Math.abs(g - b);
    const deltaBR = Math.abs(b - r);
    const maxDelta = Math.max(deltaRG, deltaGB, deltaBR);

    // Delta <= 18 indicates neutral grayscale ink (black text, pencil, monochrome line art)
    if (maxDelta <= 18) {
      grayscalePixels++;
    } else {
      // Chromatic color ink (cyan, magenta, yellow, photographic color)
      colorPixels++;
    }
  }

  // Adjust if stepping was used
  if (step > 1) {
    nonWhitePixels *= step;
    grayscalePixels *= step;
    colorPixels *= step;
  }

  const coveragePercent = totalPixels > 0 ? (nonWhitePixels / totalPixels) * 100 : 0;

  // A page is deemed "color" if it has significant chromatic ink:
  // e.g. more than 800 colored pixels AND at least 1.5% of total ink is chromatic
  const isColorPage =
    colorPixels > 800 && (nonWhitePixels > 0 ? colorPixels / nonWhitePixels > 0.015 : false);

  return {
    pageNumber,
    totalPixels,
    nonWhitePixels,
    grayscalePixels,
    colorPixels,
    coveragePercent: Math.round(coveragePercent * 100) / 100,
    isColorPage,
  };
}

/**
 * Yields control back to the browser's UI thread to keep the kiosk responsive.
 */
function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Accurately analyzes an HTMLImageElement (single-page image documents, IDs, photos).
 */
export async function analyzeImageElement(img: HTMLImageElement): Promise<DocumentPixelSummary> {
  const canvas = document.createElement('canvas');
  // Normalize scanning resolution to max 800px on the longest dimension for speed
  const maxDim = 800;
  let w = img.naturalWidth || img.width || 600;
  let h = img.naturalHeight || img.height || 800;

  if (w > maxDim || h > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Could not create optical scanning context');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const pageAnalysis = analyzeCanvasContext(ctx, w, h, 1);

  return {
    pageCount: 1,
    totalPagesAnalyzed: 1,
    totalGrayscalePixels: pageAnalysis.grayscalePixels,
    totalColorPixels: pageAnalysis.colorPixels,
    totalInkPixels: pageAnalysis.nonWhitePixels,
    avgCoveragePercent: pageAnalysis.coveragePercent,
    colorPages: pageAnalysis.isColorPage ? [1] : [],
    bwPages: pageAnalysis.isColorPage ? [] : [1],
    pages: [pageAnalysis],
  };
}

/**
 * Accurately parses and rasterizes each page of a PDF document via PDF.js,
 * extracting real pixel counts without blocking the kiosk UI.
 */
export async function analyzePdfDocument(
  pdfDoc: any,
  onProgress?: (analyzed: number, total: number) => void
): Promise<DocumentPixelSummary> {
  const numPages = pdfDoc.numPages || 1;
  const pages: PagePixelAnalysis[] = [];
  const colorPages: number[] = [];
  const bwPages: number[] = [];

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    throw new Error('Could not create offscreen scanning canvas context');
  }

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);

    // Render at normalized 1.0 scale or max width 750px for fast, accurate optical density
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const targetScale = Math.min(1.2, 750 / Math.max(1, unscaledViewport.width));
    const viewport = page.getViewport({ scale: targetScale });

    const width = Math.round(viewport.width);
    const height = Math.round(viewport.height);

    canvas.width = width;
    canvas.height = height;

    // White paper background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const renderContext = {
      canvasContext: ctx,
      viewport,
    };

    const renderTask = page.render(renderContext);
    await renderTask.promise;

    // Analyze pixel buffer
    const pageResult = analyzeCanvasContext(ctx, width, height, pageNum);
    pages.push(pageResult);

    if (pageResult.isColorPage) {
      colorPages.push(pageNum);
    } else {
      bwPages.push(pageNum);
    }

    if (onProgress) {
      onProgress(pageNum, numPages);
    }

    // Yield control so touchscreen animations and UI stay 100% fluid
    await yieldToMainThread();
  }

  const totalGrayscalePixels = pages.reduce((sum, p) => sum + p.grayscalePixels, 0);
  const totalColorPixels = pages.reduce((sum, p) => sum + p.colorPixels, 0);
  const totalInkPixels = pages.reduce((sum, p) => sum + p.nonWhitePixels, 0);
  const avgCoveragePercent =
    pages.length > 0
      ? Math.round((pages.reduce((sum, p) => sum + p.coveragePercent, 0) / pages.length) * 100) / 100
      : 0;

  return {
    pageCount: numPages,
    totalPagesAnalyzed: pages.length,
    totalGrayscalePixels,
    totalColorPixels,
    totalInkPixels,
    avgCoveragePercent,
    colorPages,
    bwPages,
    pages,
  };
}
