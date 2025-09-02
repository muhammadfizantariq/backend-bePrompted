import fs from 'fs';
import path from 'path';

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function loadModuleSafe(name) {
  try {
    const mod = await import(name);
    return mod?.default ?? mod;
  } catch (e) {
    if (e && (e.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find package|Cannot find module/i.test(String(e.message)))) {
      return null;
    }
    throw e;
  }
}

function htmlToPdfWithWk(html, outPath, wkhtmltopdf) {
  return new Promise((resolve, reject) => {
    ensureDir(outPath);
    // wkhtmltopdf can accept HTML string directly
    wkhtmltopdf(html, {
      output: outPath,
      pageSize: 'A4',
      printMediaType: true,
      marginTop: '20mm',
      marginBottom: '20mm',
      marginLeft: '15mm',
      marginRight: '15mm'
    }, (err) => {
      if (err) return reject(err);
      resolve(outPath);
    });
  });
}

export async function htmlToPdf(html, outPath) {
  ensureDir(outPath);

  // Try Puppeteer first
  try {
    const puppeteer = await loadModuleSafe('puppeteer');
    if (!puppeteer) throw new Error('Puppeteer not installed');
    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu'
      ]
    };
    const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE_PATH;
    if (execPath) launchOptions.executablePath = execPath;

    const browser = await puppeteer.launch(launchOptions);
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.pdf({
        path: outPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' }
      });
      return outPath;
    } finally {
      await browser.close();
    }
  } catch (e) {
    // Fallback to wkhtmltopdf
    try {
      const wkhtmltopdfModule = await loadModuleSafe('wkhtmltopdf');
      if (!wkhtmltopdfModule) {
        throw new Error('wkhtmltopdf not installed');
      }
      // If a custom binary path is provided, configure it
      const binPath = process.env.WKHTMLTOPDF_PATH || process.env.WKHTMLTOPDF_BIN;
      const wk = binPath ? wkhtmltopdfModule.command(binPath) : wkhtmltopdfModule;
      return await htmlToPdfWithWk(html, outPath, wk);
    } catch (wkErr) {
      // Surface combined error with helpful guidance
      const combined = new Error(`HTML->PDF failed. ${e?.message || ''} | wkhtmltopdf: ${wkErr?.message || ''}. Install either puppeteer or wkhtmltopdf, or set WKHTMLTOPDF_PATH.`);
      combined.puppeteerError = e;
      combined.wkhtmltopdfError = wkErr;
      throw combined;
    }
  }
}

export default htmlToPdf;
