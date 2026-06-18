/**
 * PDF extraction helpers for link-summarizer.
 * Detects PDF URLs by extension/path/content-type and extracts text via pdftotext.
 */

import { execSync } from "node:child_process";
import { writeFile, unlink, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const MAX_CONTENT_CHARS = 80_000;
const MAX_PDF_BYTES = 100_000_000;

const PDF_EXT_RE = /\.pdf(?:[?#].*)?$/i;
const PDF_PATH_RE = /\/pdf\/[\d.]+(?:v\d+)?(?:[?#].*)?$/i;
const PDF_CT_RE = /^application\/pdf/i;

export function isPdfUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return PDF_EXT_RE.test(parsed.pathname) || PDF_PATH_RE.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function extractPdfTitle(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 10);
  return lines[0] ?? "(PDF document)";
}

export async function checkPdfContentType(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const resp = await fetch(url, {
      method: "HEAD",
      signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PiSummarizer/1.0)" },
      redirect: "follow",
    });
    return PDF_CT_RE.test(resp.headers.get("content-type") ?? "");
  } catch {
    return false;
  }
}

/* eslint-disable-next-line complexity */
export async function tryExtractPdf(
  url: string,
  signal?: AbortSignal,
): Promise<{ title: string; text: string } | null> {
  const urlLooksLikePdf = isPdfUrl(url) || (await checkPdfContentType(url, signal));

  if (!urlLooksLikePdf) return null;

  try {
    execSync("which pdftotext", { stdio: "ignore", timeout: 5_000 });
  } catch {
    return { title: "(PDF document)", text: "pdftotext not installed." };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PiSummarizer/1.0)" },
      redirect: "follow",
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalSize += value.length;
      if (totalSize > MAX_PDF_BYTES) {
        reader.cancel();
        return null;
      }
    }
  } catch {
    return null;
  }

  const pdfBuffer = Buffer.concat(chunks);
  let tmpDir: string | null = null;
  let tmpPath: string | null = null;

  try {
    tmpDir = await mkdtemp(join(tmpdir(), "pi-pdf-"));
    tmpPath = join(tmpDir, "document.pdf");
    await writeFile(tmpPath, pdfBuffer);

    const text = execSync(`pdftotext -layout "${tmpPath}" -`, {
      encoding: "utf-8",
      maxBuffer: MAX_CONTENT_CHARS * 2,
      timeout: 30_000,
    }).trim();

    if (!text)
      return { title: "(PDF document)", text: "PDF appears to contain no extractable text." };
    return { title: extractPdfTitle(text), text };
  } catch {
    return null;
  } finally {
    if (tmpPath)
      try {
        await unlink(tmpPath);
      } catch {
        /* best effort */
      }
    if (tmpDir)
      try {
        await rm(tmpDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
  }
}
