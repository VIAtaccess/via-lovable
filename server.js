const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'via-puppeteer-renderer' });
});

// Render page with Puppeteer
app.post('/render', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL é obrigatória' });
  }

  let browser;
  try {
    console.log(`[Puppeteer] Rendering: ${url}`);

    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--no-first-run',
        '--no-zygote',
      ],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.setViewport({ width: 1920, height: 1080 });

    // Navigate and wait for network to be idle
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Wait a bit more for JS frameworks to finish rendering
    await new Promise((r) => setTimeout(r, 2000));

    const html = await page.content();
    const finalUrl = page.url();

    console.log(`[Puppeteer] Success. HTML length: ${html.length}`);

    res.json({ html, finalUrl });
  } catch (error) {
    console.error(`[Puppeteer] Error:`, error.message);
    res.status(500).json({ error: `Erro ao renderizar: ${error.message}` });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Puppeteer renderer running on port ${PORT}`);
});
