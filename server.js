const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'via-puppeteer-renderer' });
});

// Render page with Puppeteer (existing endpoint)
app.post('/render', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL é obrigatória' });

  let browser;
  try {
    console.log(`[Puppeteer] Rendering: ${url}`);
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--disable-default-apps', '--disable-sync', '--no-first-run', '--no-zygote'],
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));
    const html = await page.content();
    const finalUrl = page.url();
    console.log(`[Puppeteer] Success. HTML length: ${html.length}`);
    res.json({ html, finalUrl });
  } catch (error) {
    console.error(`[Puppeteer] Error:`, error.message);
    res.status(500).json({ error: `Erro ao renderizar: ${error.message}` });
  } finally {
    if (browser) await browser.close();
  }
});

// Full WCAG analysis endpoint
app.post('/analyze', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL é obrigatória' });

  let browser;
  try {
    console.log(`[Analyze] Starting WCAG analysis: ${url}`);
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--disable-default-apps', '--disable-sync', '--no-first-run', '--no-zygote'],
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    const finalUrl = page.url();
    const html = await page.content();

    // Run all WCAG analyses inside the browser context
    const analysisResult = await page.evaluate((pageUrl) => {
      // ===== Helper functions =====
      const getElId = (el) => el.getAttribute('id') || '';
      const getElClasses = (el) => Array.from(el.classList);
      const snippet = (el, max = 500) => el.outerHTML ? el.outerHTML.slice(0, max) : '';

      const resolveImageSrc = (src, baseUrl) => {
        if (!src) return '';
        if (src.startsWith('data:')) return src;
        if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) {
          return src.startsWith('//') ? 'https:' + src : src;
        }
        try { return new URL(src, baseUrl).href; } catch { return src; }
      };

      const getAccessibleName = (el) => {
        const ariaLabel = el.getAttribute('aria-label')?.trim();
        if (ariaLabel) return ariaLabel;
        const ariaLabelledBy = el.getAttribute('aria-labelledby')?.trim();
        if (ariaLabelledBy) {
          const referenced = ariaLabelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim() || '').filter(Boolean).join(' ');
          if (referenced) return referenced;
        }
        const title = el.getAttribute('title')?.trim();
        if (title) return title;
        const text = (el.textContent || '').trim();
        if (text) return text;
        const img = el.querySelector('img[alt]');
        if (img) { const alt = img.getAttribute('alt')?.trim(); if (alt) return alt; }
        const svg = el.querySelector('svg[aria-label]');
        if (svg) return svg.getAttribute('aria-label')?.trim() || '';
        return '';
      };

      const countByStatus = (items) => ({
        total: items.length,
        approved: items.filter(i => i.status === 'approved').length,
        warnings: items.filter(i => i.status === 'warning').length,
        errors: items.filter(i => i.status === 'error').length,
      });

      const sortByStatus = (items) => {
        const order = { error: 0, warning: 1, approved: 2 };
        return [...items].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
      };

      // ===== 1. analyzeImages =====
      const analyzeImages = () => {
        const results = [];
        // img elements
        document.querySelectorAll('img').forEach((img) => {
          const alt = img.getAttribute('alt');
          const hasAlt = img.hasAttribute('alt');
          const altEmpty = hasAlt && (alt === null || alt.trim() === '');
          let status = 'approved';
          if (!hasAlt) status = 'error';
          else if (altEmpty) status = 'warning';
          results.push({ src: resolveImageSrc(img.getAttribute('src') || '', pageUrl), alt, hasAlt, altEmpty, id: getElId(img), classes: getElClasses(img), width: img.getAttribute('width') || '', height: img.getAttribute('height') || '', status, htmlSnippet: snippet(img) });
        });
        // input type=image
        document.querySelectorAll('input[type="image"]').forEach((el) => {
          const alt = el.getAttribute('alt');
          const hasAlt = el.hasAttribute('alt');
          const altEmpty = hasAlt && (alt === null || alt.trim() === '');
          results.push({ src: resolveImageSrc(el.getAttribute('src') || '', pageUrl), alt, hasAlt, altEmpty, id: getElId(el), classes: getElClasses(el), width: el.getAttribute('width') || '', height: el.getAttribute('height') || '', status: !hasAlt ? 'error' : altEmpty ? 'warning' : 'approved', htmlSnippet: snippet(el) });
        });
        // SVG
        document.querySelectorAll('svg').forEach((svg) => {
          const ariaLabel = svg.getAttribute('aria-label')?.trim();
          const ariaLabelledBy = svg.getAttribute('aria-labelledby')?.trim();
          const roleImg = svg.getAttribute('role') === 'img';
          const titleEl = svg.querySelector('title');
          const titleText = titleEl?.textContent?.trim() || '';
          const ariaHidden = svg.getAttribute('aria-hidden') === 'true';
          if (ariaHidden) { results.push({ src: '(inline SVG)', alt: '(decorativo - aria-hidden)', hasAlt: true, altEmpty: false, id: getElId(svg), classes: getElClasses(svg), width: '', height: '', status: 'approved', htmlSnippet: snippet(svg) }); return; }
          const accessibleName = ariaLabel || titleText || '';
          const hasName = !!accessibleName || !!ariaLabelledBy;
          if (roleImg && !hasName) { results.push({ src: '(inline SVG)', alt: null, hasAlt: false, altEmpty: false, id: getElId(svg), classes: getElClasses(svg), width: '', height: '', status: 'error', htmlSnippet: snippet(svg) }); }
          else if (!roleImg && !hasName && !ariaHidden) { results.push({ src: '(inline SVG)', alt: null, hasAlt: false, altEmpty: false, id: getElId(svg), classes: getElClasses(svg), width: '', height: '', status: 'warning', htmlSnippet: snippet(svg) }); }
          else { results.push({ src: '(inline SVG)', alt: accessibleName || '(com nome acessível)', hasAlt: true, altEmpty: false, id: getElId(svg), classes: getElClasses(svg), width: '', height: '', status: 'approved', htmlSnippet: snippet(svg) }); }
        });
        // canvas
        document.querySelectorAll('canvas').forEach((canvas) => {
          const ariaLabel = canvas.getAttribute('aria-label')?.trim();
          const fallbackText = canvas.textContent?.trim() || '';
          const hasName = !!ariaLabel || !!fallbackText;
          results.push({ src: '(canvas)', alt: ariaLabel || fallbackText || null, hasAlt: hasName, altEmpty: false, id: getElId(canvas), classes: getElClasses(canvas), width: canvas.getAttribute('width') || '', height: canvas.getAttribute('height') || '', status: hasName ? 'approved' : 'error', htmlSnippet: snippet(canvas) });
        });
        // role=img
        document.querySelectorAll('[role="img"]:not(svg):not(img)').forEach((el) => {
          const ariaLabel = el.getAttribute('aria-label')?.trim();
          const title = el.getAttribute('title')?.trim();
          const hasName = !!ariaLabel || !!el.getAttribute('aria-labelledby')?.trim() || !!title;
          results.push({ src: '(role="img")', alt: ariaLabel || title || null, hasAlt: hasName, altEmpty: false, id: getElId(el), classes: getElClasses(el), width: '', height: '', status: hasName ? 'approved' : 'error', htmlSnippet: snippet(el) });
        });
        // bg images
        document.querySelectorAll('[style]').forEach((el) => {
          const style = el.getAttribute('style') || '';
          const bgMatch = style.match(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i);
          if (bgMatch) {
            const ariaLabel = el.getAttribute('aria-label')?.trim();
            const role = el.getAttribute('role');
            const hasName = !!ariaLabel || role === 'img';
            results.push({ src: resolveImageSrc(bgMatch[1], pageUrl), alt: ariaLabel || null, hasAlt: hasName, altEmpty: false, id: getElId(el), classes: getElClasses(el), width: '', height: '', status: hasName ? 'approved' : 'error', htmlSnippet: snippet(el) });
          }
        });
        // BONUS: Check computed background images (Puppeteer advantage!)
        document.querySelectorAll('div, section, header, footer, main, aside, article, span').forEach((el) => {
          try {
            const computed = window.getComputedStyle(el);
            const bgImage = computed.backgroundImage;
            if (bgImage && bgImage !== 'none' && !el.getAttribute('style')?.includes('background-image')) {
              const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
              if (urlMatch) {
                const ariaLabel = el.getAttribute('aria-label')?.trim();
                const role = el.getAttribute('role');
                const hasName = !!ariaLabel || role === 'img';
                results.push({ src: resolveImageSrc(urlMatch[1], pageUrl), alt: ariaLabel || null, hasAlt: hasName, altEmpty: false, id: getElId(el), classes: getElClasses(el), width: '', height: '', status: hasName ? 'approved' : 'warning', htmlSnippet: snippet(el, 300) });
              }
            }
          } catch(e) {}
        });
        return results;
      };

      // ===== 2. analyzeMedia =====
      const analyzeMedia = () => {
        const results = [];
        // 1. <video> elements
        document.querySelectorAll('video').forEach((video) => {
          const tracks = video.querySelectorAll('track');
          const trackKinds = Array.from(tracks).map(t => t.getAttribute('kind') || 'subtitles');
          const hasTracks = tracks.length > 0;
          const hasControls = video.hasAttribute('controls');
          const autoplay = video.hasAttribute('autoplay');
          const src = video.getAttribute('src') || video.querySelector('source')?.getAttribute('src') || '';
          const issues = [];
          if (!hasTracks) issues.push('Sem elemento <track> para legendas ou audiodescrição');
          if (!trackKinds.includes('captions') && !trackKinds.includes('subtitles') && hasTracks) issues.push('Nenhuma track de legendas');
          if (!trackKinds.includes('descriptions')) issues.push('Sem audiodescrição (<track kind="descriptions">)');
          if (autoplay && !hasControls) issues.push('Autoplay ativado sem controles visíveis');
          if (!hasControls) issues.push('Vídeo sem controles nativos');
          let status = 'approved';
          if (issues.length > 0) status = issues.some(i => i.includes('Sem elemento') || i.includes('sem controles')) ? 'error' : 'warning';
          results.push({ type: 'video', src, hasControls, autoplay, hasTracks, trackKinds, issues, status, htmlSnippet: snippet(video) });
        });

        // 2. <audio> elements
        document.querySelectorAll('audio').forEach((audio) => {
          const hasControls = audio.hasAttribute('controls');
          const autoplay = audio.hasAttribute('autoplay');
          const src = audio.getAttribute('src') || audio.querySelector('source')?.getAttribute('src') || '';
          const issues = [];
          if (autoplay && !hasControls) issues.push('Autoplay ativado sem controles visíveis');
          issues.push('Verifique se há transcrição textual disponível para este áudio');
          results.push({ type: 'audio', src, hasControls, autoplay, hasTracks: false, trackKinds: [], issues, status: (autoplay && !hasControls) ? 'error' : 'warning', htmlSnippet: snippet(audio) });
        });

        // 3. Iframes with video embeds (YouTube, Vimeo, etc.)
        document.querySelectorAll('iframe').forEach((iframe) => {
          const src = iframe.getAttribute('src') || iframe.getAttribute('data-src') || '';
          const isVideo = /youtube|youtu\.be|vimeo|dailymotion|wistia|tiktok|facebook.*video|twitch|streamable|loom|vidyard|brightcove|jwplayer|kaltura|panopto|mediasite|sproutvideo/i.test(src);
          if (!isVideo) return;
          const title = iframe.getAttribute('title');
          const issues = [];
          if (!title || title.trim() === '') issues.push('Iframe de vídeo sem atributo title descritivo');
          issues.push('Vídeo incorporado — verifique legendas na plataforma de origem');
          issues.push('Verifique se audiodescrição está disponível');
          results.push({ type: 'video', src, hasControls: true, autoplay: /autoplay/i.test(src), hasTracks: false, trackKinds: [], issues, status: (!title || title.trim() === '') ? 'error' : 'warning', htmlSnippet: snippet(iframe) });
        });

        // 4. <object> and <embed> with video/audio
        document.querySelectorAll('object, embed').forEach((el) => {
          const src = el.getAttribute('data') || el.getAttribute('src') || '';
          const type = el.getAttribute('type') || '';
          const isVideo = /video|mp4|webm|ogv|avi|mov|flv|wmv/i.test(src) || /video/i.test(type);
          const isAudio = /audio|mp3|wav|ogg|midi|aac|flac/i.test(src) || /audio/i.test(type);
          if (!isVideo && !isAudio) return;
          const mediaType = isVideo ? 'video' : 'audio';
          const issues = [];
          issues.push(`Elemento <${el.tagName.toLowerCase()}> com ${mediaType} — verifique acessibilidade e controles`);
          const title = el.getAttribute('title')?.trim();
          if (!title) issues.push('Sem atributo title descritivo');
          results.push({ type: mediaType, src, hasControls: false, autoplay: false, hasTracks: false, trackKinds: [], issues, status: 'warning', htmlSnippet: snippet(el) });
        });

        // 5. Custom video players (div-based with video-related classes/attributes)
        const videoPlayerSelectors = [
          '[class*="video-player"]', '[class*="video-container"]', '[class*="video-wrapper"]',
          '[class*="player-container"]', '[class*="media-player"]', '[class*="video_player"]',
          '[data-video]', '[data-video-id]', '[data-youtube]', '[data-vimeo]',
          '[class*="plyr"]', '[class*="vjs"]', '[class*="jwplayer"]', '[class*="mejs"]',
          '.video-js', '.flowplayer', '.mediaelement',
        ];
        const videoPlayerEls = document.querySelectorAll(videoPlayerSelectors.join(','));
        videoPlayerEls.forEach((el) => {
          // Skip if already has a video/iframe child (already analyzed)
          if (el.querySelector('video, iframe')) return;
          const issues = [];
          issues.push('Player de vídeo customizado detectado — verifique legendas e audiodescrição');
          issues.push('Verifique se os controles são acessíveis por teclado');
          const src = el.getAttribute('data-video') || el.getAttribute('data-src') || el.getAttribute('data-video-id') || '';
          results.push({ type: 'video', src: src || '(player customizado)', hasControls: false, autoplay: false, hasTracks: false, trackKinds: [], issues, status: 'warning', htmlSnippet: snippet(el, 400) });
        });

        // 6. Links to media files
        document.querySelectorAll('a[href]').forEach((a) => {
          const href = a.getAttribute('href') || '';
          const isVideoLink = /\.(mp4|webm|ogv|avi|mov|flv|wmv|m4v|mkv)(\?|$)/i.test(href);
          const isAudioLink = /\.(mp3|wav|ogg|aac|flac|m4a|wma)(\?|$)/i.test(href);
          if (!isVideoLink && !isAudioLink) return;
          const mediaType = isVideoLink ? 'video' : 'audio';
          const text = a.textContent?.trim() || '';
          const issues = [];
          issues.push(`Link para arquivo de ${mediaType} — verifique se há alternativa acessível`);
          if (isVideoLink) {
            issues.push('Verifique se legendas e audiodescrição estão disponíveis');
          } else {
            issues.push('Verifique se há transcrição textual disponível');
          }
          results.push({ type: mediaType, src: href, hasControls: false, autoplay: false, hasTracks: false, trackKinds: [], issues, status: 'warning', htmlSnippet: snippet(a, 300) });
        });

        // If no media found at all, report as approved (no media = no violation)
        if (results.length === 0) {
          results.push({ type: 'video', src: '', hasControls: true, autoplay: false, hasTracks: true, trackKinds: [], issues: ['Nenhum elemento de mídia encontrado na página'], status: 'approved', htmlSnippet: '' });
        }

        return results;
      };

      // ===== 3. analyzeStructure =====
      const analyzeStructure = () => {
        const results = [];
        // Input labels
        document.querySelectorAll('input, select, textarea').forEach((el) => {
          const type = el.getAttribute('type') || 'text';
          if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) return;
          const id = el.getAttribute('id');
          const ariaLabel = el.getAttribute('aria-label');
          const ariaLabelledBy = el.getAttribute('aria-labelledby');
          const title = el.getAttribute('title');
          const placeholder = el.getAttribute('placeholder');
          const hasLabel = id ? document.querySelector(`label[for="${id}"]`) !== null : false;
          const wrappedInLabel = el.closest('label') !== null;
          const tag = el.tagName.toLowerCase();
          const identifier = id ? `#${id}` : (el.getAttribute('name') ? `[name="${el.getAttribute('name')}"]` : `<${tag} type="${type}">`);
          if (hasLabel || wrappedInLabel || ariaLabel || ariaLabelledBy) {
            results.push({ type: 'input-no-label', status: 'approved', element: identifier, detail: `Campo ${identifier} possui label associado`, issues: [], htmlSnippet: snippet(el, 300) });
          } else if (title || placeholder) {
            results.push({ type: 'input-no-label', status: 'warning', element: identifier, detail: `Campo ${identifier} sem label adequado`, issues: [title ? 'Usa atributo title em vez de <label>' : 'Usa apenas placeholder como rótulo'], htmlSnippet: snippet(el, 300) });
          } else {
            results.push({ type: 'input-no-label', status: 'error', element: identifier, detail: `Campo ${identifier} sem nenhum rótulo acessível`, issues: ['Campo sem <label>, aria-label ou aria-labelledby'], htmlSnippet: snippet(el, 300) });
          }
        });
        // Tables
        document.querySelectorAll('table').forEach((table, idx) => {
          const ths = table.querySelectorAll('th');
          const caption = table.querySelector('caption');
          const identifier = `Tabela #${idx + 1}`;
          const issues = [];
          if (ths.length === 0) {
            issues.push('Tabela sem células de cabeçalho <th>');
            if (!caption) issues.push('Tabela sem elemento <caption>');
            results.push({ type: 'table-no-th', status: 'error', element: identifier, detail: `${identifier} sem cabeçalhos`, issues, htmlSnippet: snippet(table) });
          } else {
            const thsWithoutScope = Array.from(ths).filter(th => !th.getAttribute('scope'));
            if (thsWithoutScope.length > 0) issues.push(`${thsWithoutScope.length} <th> sem atributo scope`);
            if (!caption) issues.push('Tabela sem elemento <caption>');
            results.push({ type: 'table-no-th', status: issues.length > 0 ? 'warning' : 'approved', element: identifier, detail: `${identifier} – ${ths.length} cabeçalhos encontrados`, issues, htmlSnippet: snippet(table) });
          }
        });
        // Headings
        const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        let prevLevel = 0;
        const levels = Array.from(headings).map(h => parseInt(h.tagName[1]));
        headings.forEach((heading, i) => {
          const level = levels[i];
          const text = (heading.textContent || '').trim().slice(0, 80);
          const tag = heading.tagName.toLowerCase();
          const issues = [];
          if (i === 0 && level !== 1) issues.push(`Primeiro heading deveria ser <h1>, é <${tag}>`);
          if (level > prevLevel + 1 && prevLevel > 0) issues.push(`Pulo de nível: <h${prevLevel}> → <${tag}>`);
          if (level === 1 && levels.filter(l => l === 1).length > 1 && i > 0) issues.push('Múltiplos <h1> na página');
          if (!text) issues.push('Heading vazio');
          results.push({ type: 'heading-order', status: issues.length > 0 ? (issues.some(x => x.includes('Pulo') || x.includes('vazio')) ? 'error' : 'warning') : 'approved', element: `<${tag}> "${text}"`, detail: issues.length > 0 ? issues[0] : `Heading <${tag}> correto`, issues, htmlSnippet: snippet(heading, 300) });
          prevLevel = level;
        });
        // Landmarks
        const landmarkSelectors = [
          { selector: 'header, [role="banner"]', name: 'banner' },
          { selector: 'nav, [role="navigation"]', name: 'navigation' },
          { selector: 'main, [role="main"]', name: 'main' },
          { selector: 'footer, [role="contentinfo"]', name: 'contentinfo' },
          { selector: 'aside, [role="complementary"]', name: 'complementary' },
          { selector: '[role="search"], search', name: 'search' },
        ];
        landmarkSelectors.forEach(({ selector, name }) => {
          const elements = document.querySelectorAll(selector);
          elements.forEach((el, idx) => {
            const ariaLabel = el.getAttribute('aria-label')?.trim();
            const tag = el.tagName.toLowerCase();
            const issues = [];
            if (elements.length > 1 && !ariaLabel && !el.getAttribute('aria-labelledby')?.trim()) issues.push(`Múltiplos landmarks "${name}" sem aria-label`);
            results.push({ type: 'landmark', status: issues.length > 0 ? 'warning' : 'approved', element: `<${tag}> ${name} #${idx + 1}`, detail: ariaLabel ? `Landmark "${name}" com label: "${ariaLabel}"` : `Landmark "${name}" presente`, issues, htmlSnippet: snippet(el, 300) });
          });
        });
        if (!document.querySelector('main, [role="main"]')) results.push({ type: 'landmark', status: 'error', element: 'main', detail: 'Landmark <main> ausente', issues: ['Página sem <main>'], htmlSnippet: '' });
        // Sections
        document.querySelectorAll('section, article').forEach((el) => {
          const tag = el.tagName.toLowerCase();
          const ariaLabel = el.getAttribute('aria-label')?.trim();
          const heading = el.querySelector('h1, h2, h3, h4, h5, h6');
          const hasName = !!ariaLabel || !!el.getAttribute('aria-labelledby')?.trim() || !!heading;
          results.push({ type: 'section', status: hasName ? 'approved' : 'warning', element: `<${tag}>`, detail: hasName ? `<${tag}> identificável` : `<${tag}> sem heading ou aria-label`, issues: hasName ? [] : [`<${tag}> deve conter heading ou aria-label`], htmlSnippet: snippet(el, 300) });
        });
        return results;
      };

      // ===== 4. analyzeSequence =====
      const analyzeSequence = () => {
        const results = [];
        const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        let lastLevel = 0;
        headings.forEach((heading, idx) => {
          const level = parseInt(heading.tagName[1]);
          const text = (heading.textContent || '').trim().slice(0, 80);
          const tag = heading.tagName.toLowerCase();
          const issues = [];
          if (idx === 0 && level !== 1) issues.push(`Primeiro heading é <${tag}> em vez de <h1>`);
          else if (level > lastLevel + 1 && lastLevel > 0) issues.push(`Pulo na hierarquia: <h${lastLevel}> → <${tag}>`);
          results.push({ element: `<${tag}> "${text}"`, issue: issues.length > 0 ? issues[0] : `Heading <${tag}> em sequência correta`, status: issues.length > 0 ? 'error' : 'approved', htmlSnippet: snippet(heading, 300), details: issues.join('; ') || `Nível ${level}` });
          lastLevel = level;
        });
        document.querySelectorAll('[tabindex]').forEach((el) => {
          const tabindex = parseInt(el.getAttribute('tabindex') || '0');
          if (tabindex > 0) results.push({ element: el.tagName.toLowerCase(), issue: `tabindex="${tabindex}" — altera ordem natural`, status: 'error', htmlSnippet: snippet(el, 300), details: 'Tabindex positivo' });
        });
        document.querySelectorAll('[style]').forEach((el) => {
          const style = el.getAttribute('style') || '';
          const orderMatch = style.match(/\border\s*:\s*(-?\d+)/);
          if (orderMatch && parseInt(orderMatch[1]) !== 0) results.push({ element: el.tagName.toLowerCase(), issue: `CSS order: ${orderMatch[1]}`, status: 'warning', htmlSnippet: snippet(el, 300) });
          if (/flex-direction\s*:\s*(row-reverse|column-reverse)/i.test(style)) results.push({ element: el.tagName.toLowerCase(), issue: 'flex-direction reverse', status: 'warning', htmlSnippet: snippet(el, 300) });
        });
        if (results.length === 0) results.push({ element: 'page', issue: 'Nenhum elemento de sequência encontrado', status: 'warning', htmlSnippet: '' });
        return results;
      };

      // ===== 5. analyzeSensory =====
      const analyzeSensory = () => {
        const results = [];
        const seen = new Set();
        const patterns = [
          { pattern: /\b(bot[aã]o\s+redondo|[ií]cone\s+redondo|c[ií]rculo|quadrado|tri[aâ]ngulo|seta|estrela)\b/i, type: 'shape', issue: 'Referência a forma visual' },
          { pattern: /\b(bot[aã]o\s+(vermelho|verde|azul|amarelo|laranja|roxo|preto|branco|cinza))\b/i, type: 'color', issue: 'Referência a cor para identificar elemento' },
          { pattern: /\b(clique\s+no\s+(vermelho|verde|azul))\b/i, type: 'color', issue: 'Instrução depende de cor' },
          { pattern: /\b(no\s+canto\s+(superior|inferior)\s*(direito|esquerdo)?)\b/i, type: 'location', issue: 'Referência a localização visual' },
          { pattern: /\b([àa]\s+(direita|esquerda)\s+d[aoe])\b/i, type: 'location', issue: 'Referência a posição visual relativa' },
          { pattern: /\b(acima|abaixo)\s+d[aoe]/i, type: 'location', issue: 'Referência a posição visual' },
          { pattern: /\b(quando\s+ouvir\s+(o\s+)?(som|bip|sinal|apito))\b/i, type: 'sound', issue: 'Instrução depende de percepção sonora' },
        ];
        document.querySelectorAll('p, li, td, th, span, label, a, button, h1, h2, h3, h4, h5, h6, figcaption').forEach((el) => {
          const text = el.textContent?.trim() || '';
          if (!text || text.length < 5 || text.length > 500) return;
          for (const { pattern, type, issue } of patterns) {
            const match = text.match(pattern);
            if (match) {
              const key = `${type}:${match[0].toLowerCase()}:${text.slice(0, 80)}`;
              if (seen.has(key)) continue;
              seen.add(key);
              results.push({ element: el.tagName.toLowerCase(), text: text.slice(0, 200), issue, status: 'warning', htmlSnippet: snippet(el, 400), sensoryType: type });
            }
          }
        });
        if (results.length === 0) results.push({ element: 'page', text: '', issue: 'Nenhuma referência exclusivamente sensorial detectada', status: 'approved', htmlSnippet: '', sensoryType: 'shape' });
        return results;
      };

      // ===== 6. analyzeColor (with computed styles!) =====
      const analyzeColor = () => {
        const results = [];
        const seen = new Set();
        const addResult = (r) => { const key = `${r.colorType}:${r.element}:${r.text.slice(0, 60)}`; if (seen.has(key)) return; seen.add(key); results.push(r); };

        // Links
        document.querySelectorAll('a[href]').forEach((el) => {
          const text = el.textContent?.trim() || '';
          if (!text) return;
          // Puppeteer advantage: check computed text-decoration
          try {
            const computed = window.getComputedStyle(el);
            const textDecoration = computed.textDecorationLine || computed.textDecoration || '';
            const hasUnderline = textDecoration.includes('underline');
            if (!hasUnderline) {
              addResult({ element: 'a', text: text.slice(0, 200), issue: 'Link sem sublinhado visual — pode ser distinguido apenas por cor.', status: 'warning', htmlSnippet: snippet(el, 400), colorType: 'link' });
            } else {
              addResult({ element: 'a', text: text.slice(0, 200), issue: 'Link com distinção visual adequada.', status: 'approved', htmlSnippet: snippet(el, 400), colorType: 'link' });
            }
          } catch(e) {
            addResult({ element: 'a', text: text.slice(0, 200), issue: 'Link verificado.', status: 'approved', htmlSnippet: snippet(el, 400), colorType: 'link' });
          }
        });

        // Error messages
        document.querySelectorAll('[class*="error"], [class*="erro"], [class*="invalid"], [class*="danger"]').forEach((el) => {
          const text = el.textContent?.trim() || '';
          if (!text || text.length < 3) return;
          const hasIcon = el.querySelector('svg, img, i, [class*="icon"]');
          const hasAriaRole = el.hasAttribute('role') || el.hasAttribute('aria-live');
          if (!hasIcon && !hasAriaRole) addResult({ element: el.tagName.toLowerCase(), text: text.slice(0, 200), issue: 'Mensagem de erro pode depender apenas de cor vermelha.', status: 'warning', htmlSnippet: snippet(el, 400), colorType: 'error-indicator' });
        });

        // Status indicators
        document.querySelectorAll('[class*="status"], [class*="badge"], [class*="dot"], [class*="indicator"]').forEach((el) => {
          const text = el.textContent?.trim() || '';
          const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || '';
          if (!text && !ariaLabel) addResult({ element: el.tagName.toLowerCase(), text: '(sem texto)', issue: 'Indicador de status sem texto — informação apenas por cor.', status: 'error', htmlSnippet: snippet(el, 400), colorType: 'status' });
        });

        // BONUS: Contrast ratio check (Puppeteer advantage!)
        const checkContrast = (fg, bg) => {
          const luminance = (r, g, b) => {
            const [rs, gs, bs] = [r, g, b].map(c => { c = c / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
            return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
          };
          const parseColor = (color) => {
            const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (match) return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
            return null;
          };
          const fgRgb = parseColor(fg);
          const bgRgb = parseColor(bg);
          if (!fgRgb || !bgRgb) return null;
          const l1 = luminance(...fgRgb);
          const l2 = luminance(...bgRgb);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        };

        // Sample text elements for contrast
        const textElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, a, li, td, th, label, button');
        let contrastChecked = 0;
        textElements.forEach((el) => {
          if (contrastChecked >= 50) return; // limit
          const text = el.textContent?.trim() || '';
          if (!text || text.length < 2) return;
          try {
            const computed = window.getComputedStyle(el);
            const fg = computed.color;
            const bg = computed.backgroundColor;
            if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return;
            const ratio = checkContrast(fg, bg);
            if (ratio !== null && ratio < 4.5) {
              const fontSize = parseFloat(computed.fontSize);
              const fontWeight = parseInt(computed.fontWeight) || 400;
              const isLargeText = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
              const minRatio = isLargeText ? 3 : 4.5;
              if (ratio < minRatio) {
                addResult({ element: el.tagName.toLowerCase(), text: text.slice(0, 100), issue: `Contraste insuficiente: ${ratio.toFixed(2)}:1 (mínimo ${minRatio}:1). Cor: ${fg}, Fundo: ${bg}`, status: ratio < 3 ? 'error' : 'warning', htmlSnippet: snippet(el, 400), colorType: 'text-element' });
                contrastChecked++;
              }
            }
          } catch(e) {}
        });

        if (results.length === 0) results.push({ element: 'page', text: '', issue: 'Nenhum problema de cor detectado', status: 'approved', htmlSnippet: '', colorType: 'general' });
        return results;
      };

      // ===== 7. analyzeAudioControl =====
      const analyzeAudioControl = () => {
        const results = [];
        document.querySelectorAll('audio').forEach((audio) => {
          const autoplay = audio.hasAttribute('autoplay');
          const hasControls = audio.hasAttribute('controls');
          const muted = audio.hasAttribute('muted');
          const src = audio.getAttribute('src') || audio.querySelector('source')?.getAttribute('src') || '';
          if (autoplay && !hasControls && !muted) results.push({ element: 'audio', src, issue: 'Áudio com autoplay sem controles e sem mute.', status: 'error', htmlSnippet: snippet(audio), controlType: 'autoplay-no-controls' });
          else if (autoplay && !muted) results.push({ element: 'audio', src, issue: 'Áudio com autoplay sem muted.', status: 'warning', htmlSnippet: snippet(audio), controlType: 'autoplay-no-mute' });
          else if (!autoplay && hasControls) results.push({ element: 'audio', src, issue: 'Áudio com controles e sem autoplay — OK.', status: 'approved', htmlSnippet: snippet(audio), controlType: 'approved' });
        });
        document.querySelectorAll('video').forEach((video) => {
          const autoplay = video.hasAttribute('autoplay');
          const muted = video.hasAttribute('muted');
          const hasControls = video.hasAttribute('controls');
          const src = video.getAttribute('src') || video.querySelector('source')?.getAttribute('src') || '';
          if (autoplay && !muted && !hasControls) results.push({ element: 'video', src, issue: 'Vídeo com autoplay sem muted e sem controles.', status: 'error', htmlSnippet: snippet(video), controlType: 'autoplay-no-controls' });
          else if (autoplay && !muted) results.push({ element: 'video', src, issue: 'Vídeo com autoplay sem muted.', status: 'warning', htmlSnippet: snippet(video), controlType: 'autoplay-no-mute' });
        });
        if (results.length === 0) results.push({ element: 'page', src: '', issue: 'Nenhum áudio com autoplay detectado.', status: 'approved', htmlSnippet: '', controlType: 'approved' });
        return results;
      };

      // ===== 8. analyzeKeyboard =====
      const analyzeKeyboard = () => {
        const results = [];
        const seen = new Set();
        const addResult = (r) => { const key = `${r.keyboardType}:${r.htmlSnippet.slice(0, 80)}`; if (seen.has(key)) return; seen.add(key); results.push(r); };

        // Native focusable
        document.querySelectorAll('button, input[type="submit"], input[type="button"], input[type="reset"]').forEach((el) => {
          const name = el.getAttribute('aria-label')?.trim() || el.textContent?.trim() || el.getAttribute('value')?.trim() || `<${el.tagName.toLowerCase()}>`;
          addResult({ element: el.tagName.toLowerCase(), issue: `Botão "${name.slice(0, 60)}" — acessível por teclado.`, status: 'approved', htmlSnippet: snippet(el, 300), keyboardType: 'approved' });
        });
        document.querySelectorAll('a[href]').forEach((el) => {
          const text = el.textContent?.trim() || el.getAttribute('aria-label')?.trim() || '(link)';
          addResult({ element: 'a', issue: `Link "${text.slice(0, 60)}" — acessível por teclado.`, status: 'approved', htmlSnippet: snippet(el, 300), keyboardType: 'approved' });
        });
        // Click handlers without keyboard (inline attributes)
        document.querySelectorAll('[onclick], [onmousedown], [onmouseup]').forEach((el) => {
          const tag = el.tagName.toLowerCase();
          if (['a', 'button', 'input', 'select', 'textarea', 'summary'].includes(tag)) return;
          const hasTabindex = el.hasAttribute('tabindex');
          const hasRole = el.hasAttribute('role');
          if (!hasTabindex && !hasRole) addResult({ element: tag, issue: `<${tag}> com onclick mas sem tabindex/role — não focável.`, status: 'error', htmlSnippet: snippet(el), keyboardType: 'non-focusable-interactive' });
        });

        // REACT/SPA DETECTION: Check for elements with cursor:pointer computed style that are not natively focusable
        const nonInteractiveTags = ['div', 'span', 'li', 'td', 'tr', 'p', 'section', 'article', 'header', 'footer', 'aside', 'figure', 'figcaption', 'label'];
        document.querySelectorAll(nonInteractiveTags.join(',')).forEach((el) => {
          try {
            const computed = window.getComputedStyle(el);
            const cursor = computed.cursor;
            if (cursor !== 'pointer') return;
            const tag = el.tagName.toLowerCase();
            // Skip if it has proper keyboard accessibility
            const hasTabindex = el.hasAttribute('tabindex');
            const hasRole = el.hasAttribute('role');
            const isNativelyFocusable = el.tagName === 'LABEL' && el.querySelector('input, select, textarea');
            if (hasTabindex || hasRole || isNativelyFocusable) return;
            // Skip tiny/invisible elements
            const rect = el.getBoundingClientRect();
            if (rect.width < 5 || rect.height < 5) return;
            // Skip if it wraps a button/link (the child handles interaction)
            if (el.querySelector('a[href], button, input[type="button"], input[type="submit"]')) return;
            // Check for React event listeners via __reactProps or __reactFiber
            const hasReactEvents = Object.keys(el).some(k => k.startsWith('__reactProps') || k.startsWith('__reactFiber') || k.startsWith('__reactEvents'));
            const hasClickListener = hasReactEvents || el.getAttribute('onclick');
            if (hasClickListener || cursor === 'pointer') {
              const text = (el.textContent || '').trim().slice(0, 60);
              addResult({ element: tag, issue: `<${tag}> com cursor:pointer "${text}" — interativo mas sem tabindex/role, inacessível por teclado.`, status: 'error', htmlSnippet: snippet(el, 300), keyboardType: 'non-focusable-interactive' });
            }
          } catch(e) {}
        });

        // Roles without tabindex
        document.querySelectorAll('[role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"]').forEach((el) => {
          const tag = el.tagName.toLowerCase();
          if (['a', 'button', 'input', 'select', 'textarea'].includes(tag)) return;
          if (!el.hasAttribute('tabindex')) addResult({ element: tag, issue: `<${tag}> com role="${el.getAttribute('role')}" sem tabindex.`, status: 'error', htmlSnippet: snippet(el), keyboardType: 'non-focusable-interactive' });
          else addResult({ element: tag, issue: `<${tag}> com role e tabindex — OK.`, status: 'approved', htmlSnippet: snippet(el, 300), keyboardType: 'approved' });
        });
        // Draggable
        document.querySelectorAll('[draggable="true"]').forEach((el) => {
          if (!el.hasAttribute('onkeydown') && !el.hasAttribute('aria-grabbed')) addResult({ element: el.tagName.toLowerCase(), issue: 'Draggable sem handler de teclado.', status: 'error', htmlSnippet: snippet(el), keyboardType: 'draggable' });
        });
        // BONUS: Check actual focusability (Puppeteer advantage)
        document.querySelectorAll('[role="button"], [role="link"], [role="tab"]').forEach((el) => {
          const tag = el.tagName.toLowerCase();
          if (['a', 'button', 'input'].includes(tag)) return;
          const tabIndex = el.tabIndex;
          if (tabIndex < 0) addResult({ element: tag, issue: `<${tag}> com tabIndex=${tabIndex} — removido da ordem de tabulação.`, status: 'warning', htmlSnippet: snippet(el, 300), keyboardType: 'non-focusable-interactive' });
        });
        if (results.length === 0) results.push({ element: 'page', issue: 'Nenhum problema de teclado detectado.', status: 'approved', htmlSnippet: '', keyboardType: 'approved' });
        return results;
      };

      // ===== 9. analyzeKeyboardTrap =====
      const analyzeKeyboardTrap = () => {
        const results = [];
        // 1. Check onfocus that forces focus back
        document.querySelectorAll('[onfocus]').forEach((el) => {
          const onfocus = el.getAttribute('onfocus') || '';
          if (/\.focus\(\)|return\s+false|event\.preventDefault/i.test(onfocus)) results.push({ element: el.tagName.toLowerCase(), issue: 'onfocus pode forçar foco — possível bloqueio.', status: 'error', htmlSnippet: snippet(el), trapType: 'focus-trap' });
        });
        // 2. Check onblur that forces focus back
        document.querySelectorAll('[onblur]').forEach((el) => {
          const onblur = el.getAttribute('onblur') || '';
          if (/\.focus\(\)|return\s+false|event\.preventDefault/i.test(onblur)) results.push({ element: el.tagName.toLowerCase(), issue: 'onblur reforça foco — impede saída por teclado.', status: 'error', htmlSnippet: snippet(el), trapType: 'focus-trap' });
        });
        // 3. Check onkeydown that prevents Tab navigation
        document.querySelectorAll('[onkeydown]').forEach((el) => {
          const handler = el.getAttribute('onkeydown') || '';
          if (/preventDefault|return\s+false/i.test(handler) && /Tab|keyCode\s*===?\s*9/i.test(handler)) {
            results.push({ element: el.tagName.toLowerCase(), issue: 'onkeydown bloqueia Tab — armadilha de teclado detectada.', status: 'error', htmlSnippet: snippet(el), trapType: 'tab-trap' });
          }
        });
        // 4. Check focusable elements with tabindex that might trap (React pattern)
        document.querySelectorAll('[tabindex]').forEach((el) => {
          const props = el.__reactProps$;
          if (!props) {
            // Check for React internal props
            const keys = Object.keys(el);
            const reactPropsKey = keys.find(k => k.startsWith('__reactProps$'));
            if (reactPropsKey) {
              const rProps = el[reactPropsKey];
              if (rProps && rProps.onKeyDown) {
                const fnStr = rProps.onKeyDown.toString();
                if (/preventDefault|stopPropagation/i.test(fnStr) && /Tab|key/i.test(fnStr)) {
                  results.push({ element: el.tagName.toLowerCase(), issue: 'React onKeyDown pode bloquear Tab — possível armadilha de teclado.', status: 'error', htmlSnippet: snippet(el), trapType: 'react-tab-trap' });
                }
              }
            }
          }
        });
        // 5. Check iframes without title (can trap focus)
        document.querySelectorAll('iframe').forEach((el) => {
          const title = el.getAttribute('title')?.trim();
          const src = el.getAttribute('src') || '';
          if (!title) {
            results.push({ element: 'iframe', issue: 'iframe sem title — pode criar armadilha de foco sem contexto para o usuário.', status: 'warning', htmlSnippet: snippet(el), trapType: 'iframe-no-title' });
          }
          // Blank or javascript iframes
          if (src === 'about:blank' || src.startsWith('javascript:') || !src) {
            results.push({ element: 'iframe', issue: 'iframe com src vazio/about:blank — pode capturar foco sem conteúdo útil.', status: 'warning', htmlSnippet: snippet(el), trapType: 'iframe-blank' });
          }
        });
        // 6. Check dialogs/modals
        document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog').forEach((el) => {
          const hasClose = el.querySelector('button[aria-label*="close" i], button[aria-label*="fechar" i], button[class*="close" i], [data-dismiss]');
          if (!hasClose) results.push({ element: el.tagName.toLowerCase(), issue: 'Modal sem botão de fechar visível.', status: 'warning', htmlSnippet: snippet(el), trapType: 'no-escape' });
          else results.push({ element: el.tagName.toLowerCase(), issue: 'Modal com mecanismo de fechar — OK.', status: 'approved', htmlSnippet: snippet(el), trapType: 'approved' });
        });
        if (results.length === 0) results.push({ element: 'page', issue: 'Nenhum bloqueio de teclado detectado.', status: 'approved', htmlSnippet: '', trapType: 'approved' });
        return results;
      };


      // ===== 9b. analyzeKeyboardShortcuts (WCAG 2.1.4) =====
      const analyzeKeyboardShortcuts = () => {
        const results = [];

        // 1. Check accesskey attributes — single-char shortcuts that can't be remapped by users
        document.querySelectorAll('[accesskey]').forEach((el) => {
          const key = el.getAttribute('accesskey') || '';
          const name = el.textContent?.trim().slice(0, 60) || el.tagName.toLowerCase();
          if (key.length === 1) {
            results.push({
              element: el.tagName.toLowerCase(),
              issue: `accesskey="${key}" — atalho de tecla única que pode conflitar com tecnologias assistivas`,
              status: 'warning',
              htmlSnippet: snippet(el),
              shortcutType: 'accesskey',
            });
          }
        });

        // 2. Check inline onkeydown/onkeypress handlers for single-key detection
        document.querySelectorAll('[onkeydown], [onkeypress], [onkeyup]').forEach((el) => {
          const handler = (el.getAttribute('onkeydown') || '') + (el.getAttribute('onkeypress') || '') + (el.getAttribute('onkeyup') || '');
          // Detect patterns like event.key === 's' or e.keyCode == 83 (single char)
          const singleKeyPattern = /\.key\s*===?\s*['"][a-zA-Z0-9]['"]|\.keyCode\s*===?\s*\d{2}\b|\.which\s*===?\s*\d{2}\b/;
          if (singleKeyPattern.test(handler)) {
            results.push({
              element: el.tagName.toLowerCase(),
              issue: 'Handler de teclado inline detecta tecla única — pode causar acionamento acidental',
              status: 'warning',
              htmlSnippet: snippet(el),
              shortcutType: 'inline-handler',
            });
          }
        });

        // 3. Check for single-char tabindex + key handlers (common pattern)
        document.querySelectorAll('[tabindex][onkeydown], [tabindex][onkeypress]').forEach((el) => {
          if (!results.some(r => r.htmlSnippet === snippet(el))) {
            results.push({
              element: el.tagName.toLowerCase(),
              issue: 'Elemento com tabindex e handler de teclado — verifique se atalhos podem ser desativados',
              status: 'warning',
              htmlSnippet: snippet(el),
              shortcutType: 'tabindex-handler',
            });
          }
        });

        if (results.length === 0) {
          results.push({
            element: 'page',
            issue: 'Nenhum atalho de tecla única detectado — OK.',
            status: 'approved',
            htmlSnippet: '',
            shortcutType: 'approved',
          });
        }

        return results;
      };

      // ===== 9c. analyzeTimeLimits (WCAG 2.2.1) =====
      const analyzeTimeLimits = () => {
        const results = [];

        // 1. Check <meta http-equiv="refresh">
        document.querySelectorAll('meta[http-equiv="refresh"]').forEach((el) => {
          const content = el.getAttribute('content') || '';
          const timeMatch = content.match(/^(\d+)/);
          const time = timeMatch ? parseInt(timeMatch[1]) : 0;
          if (time > 0) {
            results.push({
              element: 'meta',
              issue: `Meta refresh com redirecionamento em ${time}s — usuário não pode controlar o tempo`,
              status: 'error',
              htmlSnippet: snippet(el),
              timeLimitType: 'meta-refresh',
            });
          }
        });

        // 2. Check for session timeout patterns in scripts
        document.querySelectorAll('script:not([src])').forEach((el) => {
          const code = el.textContent || '';
          // setTimeout/setInterval with redirect or reload
          const hasTimeout = /setTimeout\s*\([^,]+,\s*(\d{4,})\)/i.test(code);
          const hasRedirect = /location\s*[.=]|window\.location|document\.location|\.href\s*=/i.test(code);
          const hasReload = /location\.reload|window\.location\.reload/i.test(code);
          if (hasTimeout && (hasRedirect || hasReload)) {
            results.push({
              element: 'script',
              issue: 'Script com timeout que redireciona/recarrega — pode limitar tempo do usuário',
              status: 'warning',
              htmlSnippet: code.slice(0, 400),
              timeLimitType: 'script-timeout',
            });
          }

          // Auto-slideshow / carousel with auto-advance
          const hasAutoPlay = /autoplay|auto-play|autoSlide|autoAdvance|slideInterval|setInterval/i.test(code);
          const hasSlide = /slide|carousel|banner|swiper|slick/i.test(code);
          if (hasAutoPlay && hasSlide) {
            results.push({
              element: 'script',
              issue: 'Carrossel/slider com avanço automático detectado — verifique se o usuário pode pausar',
              status: 'warning',
              htmlSnippet: code.slice(0, 400),
              timeLimitType: 'auto-carousel',
            });
          }
        });

        // 3. Check for countdown/timer elements
        document.querySelectorAll('[class*="countdown"], [class*="timer"], [id*="countdown"], [id*="timer"], [data-countdown], [data-timer]').forEach((el) => {
          results.push({
            element: el.tagName.toLowerCase(),
            issue: 'Elemento de contagem regressiva/temporizador — verifique se o usuário pode estender o tempo',
            status: 'warning',
            htmlSnippet: snippet(el),
            timeLimitType: 'countdown',
          });
        });

        // 4. Check for auto-updating content (live regions with timers)
        document.querySelectorAll('[aria-live]').forEach((el) => {
          const live = el.getAttribute('aria-live');
          if (live === 'polite' || live === 'assertive') {
            results.push({
              element: el.tagName.toLowerCase(),
              issue: `Região aria-live="${live}" — conteúdo dinâmico (verifique se há controle de tempo)`,
              status: 'approved',
              htmlSnippet: snippet(el),
              timeLimitType: 'live-region',
            });
          }
        });

        if (results.length === 0) {
          results.push({
            element: 'page',
            issue: 'Nenhum limite de tempo detectado — OK.',
            status: 'approved',
            htmlSnippet: '',
            timeLimitType: 'approved',
          });
        }

        return results;
      };

      // ===== 9d. analyzeMovingContent (WCAG 2.2.2) =====
      const analyzeMovingContent = () => {
        const results = [];

        // 1. Check marquee elements (obsolete but still used)
        document.querySelectorAll('marquee').forEach((el) => {
          results.push({
            element: 'marquee',
            issue: 'Elemento <marquee> — conteúdo em movimento sem controle de pausa',
            status: 'error',
            htmlSnippet: snippet(el),
            movingType: 'marquee',
          });
        });

        // 2. Check blink elements
        document.querySelectorAll('blink').forEach((el) => {
          results.push({
            element: 'blink',
            issue: 'Elemento <blink> — conteúdo piscante sem controle',
            status: 'error',
            htmlSnippet: snippet(el),
            movingType: 'blink',
          });
        });

        // 3. Autoplay videos without controls
        document.querySelectorAll('video').forEach((el) => {
          const autoplay = el.hasAttribute('autoplay');
          const hasControls = el.hasAttribute('controls');
          if (autoplay && !hasControls) {
            results.push({
              element: 'video',
              issue: 'Vídeo com autoplay sem atributo controls — usuário não pode pausar',
              status: 'error',
              htmlSnippet: snippet(el),
              movingType: 'video-autoplay',
            });
          } else if (autoplay && hasControls) {
            results.push({
              element: 'video',
              issue: 'Vídeo com autoplay mas com controls — usuário pode pausar',
              status: 'warning',
              htmlSnippet: snippet(el),
              movingType: 'video-autoplay',
            });
          }
        });

        // 4. GIF images (animated content without pause control)
        document.querySelectorAll('img[src*=".gif"], img[data-src*=".gif"]').forEach((el) => {
          results.push({
            element: 'img',
            issue: 'Imagem GIF animada — verifique se há mecanismo para pausar a animação',
            status: 'warning',
            htmlSnippet: snippet(el),
            movingType: 'gif',
          });
        });

        // 5. CSS animations on large elements (potential auto-moving content)
        document.querySelectorAll('[class*="animate"], [class*="scroll"], [class*="marquee"], [class*="ticker"], [class*="slide"], [class*="carousel"], [class*="swiper"]').forEach((el) => {
          const style = window.getComputedStyle(el);
          const animName = style.animationName;
          const animDuration = parseFloat(style.animationDuration) || 0;
          const animIteration = style.animationIterationCount;

          if (animName && animName !== 'none' && animIteration === 'infinite') {
            results.push({
              element: el.tagName.toLowerCase(),
              issue: `Animação CSS infinita "${animName}" — verifique se o usuário pode pausar`,
              status: 'warning',
              htmlSnippet: snippet(el),
              movingType: 'css-animation',
            });
          }
        });

        // 6. Auto-updating content (news tickers, stock tickers, etc.)
        document.querySelectorAll('[class*="ticker"], [class*="news-scroll"], [class*="auto-update"], [class*="live-feed"]').forEach((el) => {
          if (!results.some(r => r.htmlSnippet === snippet(el))) {
            results.push({
              element: el.tagName.toLowerCase(),
              issue: 'Conteúdo com atualização automática detectado — verifique se pode ser pausado',
              status: 'warning',
              htmlSnippet: snippet(el),
              movingType: 'auto-update',
            });
          }
        });

        if (results.length === 0) {
          results.push({
            element: 'page',
            issue: 'Nenhum conteúdo em movimento automático detectado — OK.',
            status: 'approved',
            htmlSnippet: '',
            movingType: 'approved',
          });
        }

        return results;
      };

      // ===== 9e. analyzeFlashing (WCAG 2.3.1) =====
      const analyzeFlashing = () => {
        const results = [];

        // 1. Check blink elements
        document.querySelectorAll('blink').forEach((el) => {
          results.push({ element: 'blink', issue: 'Elemento <blink> pode causar flashes — risco de epilepsia', status: 'error', htmlSnippet: snippet(el), flashType: 'blink' });
        });

        // 2. CSS animations with very fast duration (potential flashing)
        document.querySelectorAll('*').forEach((el) => {
          const style = window.getComputedStyle(el);
          const animName = style.animationName;
          const animDuration = parseFloat(style.animationDuration) || 0;
          const animIteration = style.animationIterationCount;
          // Flash threshold: animation < 333ms (3 per second) and infinite
          if (animName && animName !== 'none' && animDuration > 0 && animDuration < 0.334 && animIteration === 'infinite') {
            results.push({ element: el.tagName.toLowerCase(), issue: `Animação "${animName}" com ${Math.round(1/animDuration)}Hz — possível flash >3x/s`, status: 'error', htmlSnippet: snippet(el), flashType: 'fast-animation' });
          }
        });

        // 3. Inline styles with rapid blinking
        document.querySelectorAll('[style]').forEach((el) => {
          const style = el.getAttribute('style') || '';
          if (/animation.*blink|@keyframes.*opacity|text-decoration.*blink/i.test(style)) {
            results.push({ element: el.tagName.toLowerCase(), issue: 'Estilo inline com efeito de piscar — verifique frequência', status: 'warning', htmlSnippet: snippet(el), flashType: 'inline-blink' });
          }
        });

        // 4. Scripts with rapid DOM toggling patterns
        document.querySelectorAll('script:not([src])').forEach((el) => {
          const code = el.textContent || '';
          if (/setInterval\s*\([^,]+,\s*([1-9]\d?|[12]\d{2}|3[0-2]\d|33[0-3])\)/.test(code)) {
            const match = code.match(/setInterval\s*\([^,]+,\s*(\d+)\)/);
            if (match && parseInt(match[1]) < 334) {
              results.push({ element: 'script', issue: `setInterval com ${match[1]}ms — possível flash >3x/s`, status: 'warning', htmlSnippet: code.slice(0, 400), flashType: 'script-interval' });
            }
          }
        });

        if (results.length === 0) {
          results.push({ element: 'page', issue: 'Nenhum conteúdo com flash rápido detectado — OK.', status: 'approved', htmlSnippet: '', flashType: 'approved' });
        }
        return results;
      };

      // ===== 9f. analyzeFocusOrder (WCAG 2.4.3) =====
      const analyzeFocusOrder = () => {
        const results = [];
        const focusable = Array.from(document.querySelectorAll(
          'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex], [contenteditable="true"], details, summary, iframe, audio[controls], video[controls]'
        ));

        // 1. Check each focusable element for positive tabindex
        focusable.forEach((el) => {
          const tabindex = parseInt(el.getAttribute('tabindex') || '0');
          if (tabindex > 0) {
            results.push({ element: el.tagName.toLowerCase(), issue: `tabindex="${tabindex}" — altera ordem natural de foco`, status: 'error', htmlSnippet: snippet(el), focusType: 'positive-tabindex' });
          }
        });

        // 2. Check visual order vs DOM order for focusable elements in flex/grid containers
        document.querySelectorAll('[style*="order"], [style*="flex-direction: row-reverse"], [style*="flex-direction: column-reverse"]').forEach((el) => {
          const focusChildren = el.querySelectorAll('a[href], button, input, select, textarea, [tabindex]');
          if (focusChildren.length > 1) {
            results.push({ element: el.tagName.toLowerCase(), issue: 'Container com CSS order/reverse contém elementos focáveis — ordem visual pode divergir do DOM', status: 'warning', htmlSnippet: snippet(el), focusType: 'css-order' });
          }
        });

        // 3. Check modals/dialogs for focus management
        document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog').forEach((el) => {
          const focusableInModal = el.querySelectorAll('a[href], button, input, select, textarea, [tabindex]');
          const hasAutofocus = el.querySelector('[autofocus]');
          const hasTabindexNeg = el.querySelector('[tabindex="-1"]');
          if (focusableInModal.length > 0 && !hasAutofocus && !hasTabindexNeg && !el.hasAttribute('tabindex')) {
            results.push({ element: el.tagName.toLowerCase(), issue: 'Modal sem gerenciamento de foco (sem autofocus ou tabindex) — foco pode não mover para o modal', status: 'warning', htmlSnippet: snippet(el), focusType: 'modal-focus' });
          } else if (focusableInModal.length > 0) {
            results.push({ element: el.tagName.toLowerCase(), issue: 'Modal com gerenciamento de foco — OK', status: 'approved', htmlSnippet: snippet(el), focusType: 'modal-focus' });
          }
        });

        // 4. Check for skip-to-content as first focusable
        if (focusable.length > 0) {
          const first = focusable[0];
          const isSkipLink = first.tagName === 'A' && (first.getAttribute('href') || '').startsWith('#') && (first.textContent || '').toLowerCase().match(/skip|pular|ir para|saltar/);
          if (isSkipLink) {
            results.push({ element: 'a', issue: 'Skip link como primeiro elemento focável — boa prática', status: 'approved', htmlSnippet: snippet(first), focusType: 'skip-link' });
          }
        }

        // 5. Report total focusable elements
        if (focusable.length > 0) {
          results.push({ element: 'page', issue: `${focusable.length} elementos focáveis encontrados na página`, status: 'approved', htmlSnippet: '', focusType: 'summary' });
        }

        if (results.length === 0) {
          results.push({ element: 'page', issue: 'Nenhum problema de ordem de foco detectado — OK.', status: 'approved', htmlSnippet: '', focusType: 'approved' });
        }
        return results;
      };

      // ===== 9g. analyzePointerGestures (WCAG 2.5.1) =====
      const analyzePointerGestures = () => {
        const results = [];

        // 1. Check for touch/gesture event handlers (inline)
        document.querySelectorAll('[ontouchstart], [ontouchmove], [ontouchend], [ongesturestart], [ongesturechange], [ongestureend]').forEach((el) => {
          const hasClick = el.hasAttribute('onclick') || el.tagName === 'BUTTON' || el.tagName === 'A';
          results.push({
            element: el.tagName.toLowerCase(),
            issue: hasClick ? 'Elemento com gesto de toque E alternativa de clique — OK' : 'Elemento com gesto de toque sem alternativa de clique simples',
            status: hasClick ? 'approved' : 'warning',
            htmlSnippet: snippet(el),
            gestureType: 'touch-event',
          });
        });

        // 2. Check for drag-and-drop without alternatives
        document.querySelectorAll('[draggable="true"], [ondragstart], [ondrag], [ondrop]').forEach((el) => {
          results.push({
            element: el.tagName.toLowerCase(),
            issue: 'Elemento com drag-and-drop — verifique se há alternativa de clique/teclado',
            status: 'warning',
            htmlSnippet: snippet(el),
            gestureType: 'drag-drop',
          });
        });

        // 3. REACT/SPA: Detect swipe/gesture libraries via data attributes and classes
        document.querySelectorAll('[data-swipeable], [class*="swipe"], [class*="gesture"], [class*="pinch"], [class*="drag"]').forEach((el) => {
          const tag = el.tagName.toLowerCase();
          if (['a', 'button', 'input'].includes(tag)) return;
          results.push({
            element: tag,
            issue: 'Elemento com classe/atributo de gesto complexo — verifique se há alternativa de clique simples',
            status: 'warning',
            htmlSnippet: snippet(el),
            gestureType: 'complex-gesture',
          });
        });

        // 4. Check for pinch/zoom custom handlers in scripts
        document.querySelectorAll('script:not([src])').forEach((el) => {
          const code = el.textContent || '';
          if (/pinch|gesture|swipe|pan[A-Z]|hammer\.js|touchmove.*scale/i.test(code)) {
            results.push({
              element: 'script',
              issue: 'Script com gestos complexos (pinch/swipe/pan) — verifique se há alternativa simples',
              status: 'warning',
              htmlSnippet: code.slice(0, 400),
              gestureType: 'complex-gesture',
            });
          }
        });

        // 5. Check maps/canvas that commonly require gestures
        document.querySelectorAll('canvas, [class*="map"], [id*="map"], [class*="leaflet"], [class*="mapbox"], [class*="google-map"]').forEach((el) => {
          results.push({
            element: el.tagName.toLowerCase(),
            issue: 'Mapa/Canvas detectado — estes elementos frequentemente requerem gestos complexos, verifique alternativas',
            status: 'warning',
            htmlSnippet: snippet(el),
            gestureType: 'map-canvas',
          });
        });

        if (results.length === 0) {
          results.push({ element: 'page', issue: 'Nenhum gesto complexo detectado — OK.', status: 'approved', htmlSnippet: '', gestureType: 'approved' });
        }
        return results;
      };

      // ===== 9h. analyzePointerCancellation (WCAG 2.5.2) =====
      const analyzePointerCancellation = () => {
        const results = [];

        // Check for mousedown/touchstart handlers without mouseup/touchend (action on press, not release)
        document.querySelectorAll('[onmousedown]').forEach((el) => {
          const hasMouseup = el.hasAttribute('onmouseup') || el.hasAttribute('onclick');
          results.push({
            element: el.tagName.toLowerCase(),
            issue: hasMouseup ? 'onmousedown com onclick/onmouseup — cancelamento possível' : 'onmousedown sem onclick/onmouseup — ação pode ocorrer ao pressionar, sem possibilidade de cancelar',
            status: hasMouseup ? 'approved' : 'warning',
            htmlSnippet: snippet(el),
            pointerType: 'mousedown',
          });
        });

        document.querySelectorAll('[ontouchstart]').forEach((el) => {
          const hasTouchEnd = el.hasAttribute('ontouchend') || el.hasAttribute('onclick');
          if (!results.some(r => r.htmlSnippet === snippet(el))) {
            results.push({
              element: el.tagName.toLowerCase(),
              issue: hasTouchEnd ? 'touchstart com touchend/click — cancelamento possível' : 'touchstart sem alternativa de soltar — ação sem cancelamento',
              status: hasTouchEnd ? 'approved' : 'warning',
              htmlSnippet: snippet(el),
              pointerType: 'touchstart',
            });
          }
        });

        // REACT/SPA: Detect elements with onMouseDown React prop via __reactProps
        const nonInteractiveTags = ['div', 'span', 'li', 'td', 'section', 'article'];
        document.querySelectorAll(nonInteractiveTags.join(',')).forEach((el) => {
          try {
            const reactPropsKey = Object.keys(el).find(k => k.startsWith('__reactProps'));
            if (!reactPropsKey) return;
            const reactProps = el[reactPropsKey];
            if (reactProps && reactProps.onMouseDown && !reactProps.onClick) {
              results.push({
                element: el.tagName.toLowerCase(),
                issue: 'Elemento React com onMouseDown sem onClick — ação ao pressionar, sem cancelamento',
                status: 'warning',
                htmlSnippet: snippet(el, 300),
                pointerType: 'react-mousedown',
              });
            }
          } catch(e) {}
        });

        // Check scripts for mousedown-only patterns
        document.querySelectorAll('script:not([src])').forEach((el) => {
          const code = el.textContent || '';
          const hasMousedown = /addEventListener\s*\(\s*['"]mousedown['"]/.test(code);
          const hasMouseup = /addEventListener\s*\(\s*['"]mouseup['"]/.test(code);
          const hasClick = /addEventListener\s*\(\s*['"]click['"]/.test(code);
          if (hasMousedown && !hasMouseup && !hasClick) {
            results.push({
              element: 'script',
              issue: 'Script usa mousedown sem mouseup/click — ação pode não ser cancelável',
              status: 'warning',
              htmlSnippet: code.slice(0, 400),
              pointerType: 'script-mousedown',
            });
          }
        });

        if (results.length === 0) {
          results.push({ element: 'page', issue: 'Nenhum problema de cancelamento de ponteiro detectado — OK.', status: 'approved', htmlSnippet: '', pointerType: 'approved' });
        }
        return results;
      };

      // ===== 9i. analyzeLabelInName (WCAG 2.5.3) =====
      const analyzeLabelInName = () => {
        const results = [];

        document.querySelectorAll('button, [role="button"], a[href], input[type="submit"], input[type="button"], input[type="reset"]').forEach((el) => {
          const visibleText = (el.textContent || '').trim().toLowerCase();
          const ariaLabel = (el.getAttribute('aria-label') || '').trim().toLowerCase();
          const ariaLabelledby = el.getAttribute('aria-labelledby');
          let accessibleName = ariaLabel;

          if (ariaLabelledby) {
            const labelEl = document.getElementById(ariaLabelledby);
            if (labelEl) accessibleName = (labelEl.textContent || '').trim().toLowerCase();
          }

          if (!visibleText || !accessibleName) return; // Skip if no visible text or no accessible name to compare

          if (accessibleName && visibleText && !accessibleName.includes(visibleText)) {
            results.push({
              element: el.tagName.toLowerCase(),
              issue: `Nome acessível "${ariaLabel || accessibleName}" não contém o texto visível "${visibleText.slice(0, 40)}"`,
              status: 'error',
              htmlSnippet: snippet(el),
              labelType: 'mismatch',
            });
          } else if (accessibleName && visibleText) {
            results.push({
              element: el.tagName.toLowerCase(),
              issue: `Nome acessível contém texto visível — OK`,
              status: 'approved',
              htmlSnippet: snippet(el),
              labelType: 'match',
            });
          }
        });

        if (results.length === 0) {
          results.push({ element: 'page', issue: 'Nenhum elemento com nome acessível divergente detectado — OK.', status: 'approved', htmlSnippet: '', labelType: 'approved' });
        }
        return results;
      };

      // ===== 9j. analyzeMotionActuation (WCAG 2.5.4) =====
      const analyzeMotionActuation = () => {
        const results = [];

        // Check for devicemotion/deviceorientation event listeners in scripts
        document.querySelectorAll('script:not([src])').forEach((el) => {
          const code = el.textContent || '';
          if (/devicemotion|deviceorientation|accelerometer|gyroscope/i.test(code)) {
            const hasButton = /button|click|tap|alternativ/i.test(code);
            results.push({
              element: 'script',
              issue: hasButton ? 'Função por movimento com possível alternativa de botão' : 'Função ativada por movimento do dispositivo — verifique se há alternativa de botão',
              status: hasButton ? 'approved' : 'warning',
              htmlSnippet: code.slice(0, 400),
              motionType: 'device-motion',
            });
          }
          if (/shake|tilt|rotate.*device/i.test(code)) {
            results.push({
              element: 'script',
              issue: 'Detecção de chacoalhar/inclinar dispositivo — verifique se há alternativa de interface',
              status: 'warning',
              htmlSnippet: code.slice(0, 400),
              motionType: 'shake-tilt',
            });
          }
        });

        if (results.length === 0) {
          results.push({ element: 'page', issue: 'Nenhuma função por movimento detectada — OK.', status: 'approved', htmlSnippet: '', motionType: 'approved' });
        }
        return results;
      };

      // ===== 9k. analyzeConsistentHelp (WCAG 3.2.6) =====
      const analyzeConsistentHelp = () => {
        const results = [];
        const helpPatterns = /ajuda|help|suporte|support|faq|contato|contact|chat|atendimento|sac/i;
        const helpLinks = document.querySelectorAll('a[href], button');
        let foundHelp = false;
        helpLinks.forEach((el) => {
          const text = (el.textContent || '').trim();
          const ariaLabel = el.getAttribute('aria-label') || '';
          if (helpPatterns.test(text) || helpPatterns.test(ariaLabel)) {
            foundHelp = true;
            results.push({
              element: el.tagName.toLowerCase(),
              issue: `Link/botão de ajuda "${text.slice(0, 40)}" encontrado — verifique se aparece consistentemente em todas as páginas`,
              status: 'approved',
              htmlSnippet: snippet(el),
              helpType: 'help-link',
            });
          }
        });
        // Check for chat widgets
        document.querySelectorAll('[class*="chat"], [id*="chat"], [class*="intercom"], [class*="zendesk"], [class*="tawk"], [class*="crisp"], [class*="drift"]').forEach((el) => {
          if (!foundHelp) foundHelp = true;
          results.push({
            element: el.tagName.toLowerCase(),
            issue: 'Widget de chat/suporte detectado — verifique se aparece em todas as páginas',
            status: 'approved',
            htmlSnippet: snippet(el),
            helpType: 'chat-widget',
          });
        });
        if (!foundHelp) {
          results.push({ element: 'page', issue: 'Nenhum link de ajuda/contato/suporte encontrado na página', status: 'error', htmlSnippet: '', helpType: 'missing' });
        }
        return results;
      };

      // ===== 9n. analyzeErrorIdentification (WCAG 3.3.1) =====
      const analyzeErrorIdentification = () => {
        const results = [];
        document.querySelectorAll('form').forEach((form) => {
          const inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');
          const hasRequired = form.querySelectorAll('[required], [aria-required="true"]');
          const hasErrorMsg = form.querySelectorAll('[class*="error"], [class*="invalid"], [role="alert"], [aria-live="polite"], [aria-live="assertive"]');
          
          inputs.forEach((input) => {
            const name = input.getAttribute('name') || input.getAttribute('id') || input.tagName.toLowerCase();
            const isRequired = input.hasAttribute('required') || input.getAttribute('aria-required') === 'true';
            const hasDescribedby = input.hasAttribute('aria-describedby');
            const hasInvalid = input.getAttribute('aria-invalid');
            const issues = [];
            
            // Required field without error feedback mechanism
            if (isRequired && !hasDescribedby) {
              issues.push('Campo obrigatório sem aria-describedby para mensagem de erro');
            }
            if (isRequired && !hasInvalid) {
              issues.push('Campo obrigatório sem aria-invalid para indicar estado de erro');
            }
            
            // Field marked invalid without associated error message
            if (hasInvalid === 'true' && !hasDescribedby) {
              issues.push('Campo com aria-invalid="true" mas sem aria-describedby — erro não é descrito');
            }
            
            if (issues.length > 0) {
              results.push({ element: input.tagName.toLowerCase(), issue: issues[0], status: 'error', htmlSnippet: snippet(input), errorType: 'missing-error-feedback' });
            }
          });

          // Form with required fields but no error display mechanism
          if (hasRequired.length > 0 && hasErrorMsg.length === 0) {
            results.push({ element: 'form', issue: 'Formulário com campos obrigatórios mas sem área de mensagem de erro visível', status: 'error', htmlSnippet: snippet(form), errorType: 'no-error-container' });
          }

          // Form with inputs but NO required and NO aria-invalid — no error identification at all
          if (inputs.length > 0 && hasRequired.length === 0) {
            const anyInvalid = form.querySelectorAll('[aria-invalid]');
            if (anyInvalid.length === 0) {
              results.push({ element: 'form', issue: 'Formulário sem indicação de campos obrigatórios (required/aria-required) — erros não serão identificados', status: 'warning', htmlSnippet: snippet(form), errorType: 'no-required-fields' });
            }
          }
        });

        // Check standalone inputs with aria-invalid but no associated error message
        document.querySelectorAll('input[aria-invalid="true"]:not(form input), select[aria-invalid="true"]:not(form select), textarea[aria-invalid="true"]:not(form textarea)').forEach((input) => {
          const hasDescribedby = input.hasAttribute('aria-describedby');
          if (!hasDescribedby) {
            results.push({ element: input.tagName.toLowerCase(), issue: 'Campo com aria-invalid="true" mas sem aria-describedby — erro não é descrito ao usuário', status: 'error', htmlSnippet: snippet(input), errorType: 'invalid-no-description' });
          }
        });

        if (results.length === 0) {
          results.push({ element: 'page', issue: 'Nenhum formulário encontrado para análise de erros.', status: 'approved', htmlSnippet: '', errorType: 'no-forms' });
        }
        return results;
      };

      // ===== 9o. analyzeLabelsInstructions (WCAG 3.3.2) =====
      const analyzeLabelsInstructions = () => {
        const results = [];
        document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea').forEach((el) => {
          const id = el.getAttribute('id');
          const name = el.getAttribute('name') || '';
          const type = el.getAttribute('type') || el.tagName.toLowerCase();
          const ariaLabel = el.getAttribute('aria-label')?.trim();
          const ariaLabelledby = el.getAttribute('aria-labelledby');
          const placeholder = el.getAttribute('placeholder')?.trim();
          const title = el.getAttribute('title')?.trim();
          const hasLabel = id ? document.querySelector(`label[for="${id}"]`) : null;
          const parentLabel = el.closest('label');
          
          const hasAccessibleName = ariaLabel || ariaLabelledby || hasLabel || parentLabel || title;
          
          if (!hasAccessibleName && !placeholder) {
            results.push({ element: el.tagName.toLowerCase(), issue: `Campo "${name || type}" sem label, aria-label ou placeholder`, status: 'error', htmlSnippet: snippet(el), labelInstType: 'no-label' });
          } else if (!hasAccessibleName && placeholder) {
            results.push({ element: el.tagName.toLowerCase(), issue: `Campo "${name || type}" usa apenas placeholder como rótulo — placeholder desaparece ao digitar`, status: 'warning', htmlSnippet: snippet(el), labelInstType: 'placeholder-only' });
          } else if (hasAccessibleName) {
            results.push({ element: el.tagName.toLowerCase(), issue: `Campo "${name || type}" com rótulo acessível — OK`, status: 'approved', htmlSnippet: snippet(el), labelInstType: 'has-label' });
          }
        });
        if (results.length === 0) {
          results.push({ element: 'page', issue: 'Nenhum campo de formulário encontrado.', status: 'approved', htmlSnippet: '', labelInstType: 'no-inputs' });
        }
        return results;
      };

      // ===== 9p. analyzeRedundantEntry (WCAG 3.3.7) =====
      const analyzeRedundantEntry = () => {
        const results = [];
        
        // Semantic groups: fields that ask for the same info
        const SEMANTIC_GROUPS = {
          email: /email|e-mail|correio/i,
          phone: /phone|tel|telefone|celular|fone/i,
          name: /name|nome/i,
          address: /address|endereco|endereço|logradouro/i,
          password: /password|senha|pass/i,
          cpf: /cpf|documento/i,
          city: /city|cidade/i,
          state: /state|estado|uf/i,
          zip: /zip|cep|postal/i,
        };

        document.querySelectorAll('form').forEach((form) => {
          const inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])');
          const names = new Map();
          const semanticMap = new Map();
          
          inputs.forEach((input) => {
            const name = (input.getAttribute('name') || '').toLowerCase();
            const type = input.getAttribute('type') || 'text';
            const autocomplete = input.getAttribute('autocomplete');
            const label = input.closest('label')?.textContent?.trim()?.toLowerCase() || '';
            const placeholder = (input.getAttribute('placeholder') || '').toLowerCase();
            const identifier = name || label || placeholder;
            
            if (!identifier) return;
            
            // Check exact duplicate names
            if (name && names.has(name)) {
              results.push({ element: 'input', issue: `Campo "${name}" aparece mais de uma vez no mesmo formulário — entrada redundante`, status: 'error', htmlSnippet: snippet(input), redundantType: 'duplicate-name' });
            }
            if (name) names.set(name, true);
            
            // Check for confirm/repeat fields
            if (/confirm|confirma|repeat|repet|verify|verific|novamente|again|re-?enter|redigit/i.test(identifier)) {
              results.push({ element: 'input', issue: `Campo "${identifier}" pede confirmação redundante — considere usar autocomplete`, status: 'error', htmlSnippet: snippet(input), redundantType: 'confirm-field' });
            }
            
            // Check semantic similarity (e.g., email1 + email2)
            for (const [group, regex] of Object.entries(SEMANTIC_GROUPS)) {
              if (regex.test(identifier)) {
                if (semanticMap.has(group)) {
                  results.push({ element: 'input', issue: `Múltiplos campos de "${group}" no mesmo formulário — possível entrada redundante (${semanticMap.get(group)} e ${identifier})`, status: 'error', htmlSnippet: snippet(input), redundantType: 'semantic-duplicate' });
                } else {
                  semanticMap.set(group, identifier);
                }
                break;
              }
            }
            
            // Check for autocomplete support
            if (['text', 'email', 'tel', 'url'].includes(type) && !autocomplete) {
              const suggestedAutocomplete = /email/i.test(identifier) ? 'email' : /phone|tel/i.test(identifier) ? 'tel' : /name|nome/i.test(identifier) ? 'name' : null;
              if (suggestedAutocomplete) {
                results.push({ element: 'input', issue: `Campo "${identifier}" sem autocomplete="${suggestedAutocomplete}" — autocomplete evita entrada redundante`, status: 'warning', htmlSnippet: snippet(input), redundantType: 'no-autocomplete' });
              }
            }
          });
        });
        if (results.length === 0) {
          results.push({ element: 'page', issue: 'Nenhuma entrada redundante detectada — OK.', status: 'approved', htmlSnippet: '', redundantType: 'approved' });
        }
        return results;
      };

      // ===== 10. analyzeLinks =====
      const analyzeLinks = () => {
        const results = [];
        const GENERIC = ['clique aqui', 'click here', 'saiba mais', 'leia mais', 'read more', 'learn more', 'ver mais', 'more', 'aqui', 'here', 'link', 'acesse', 'confira', 'veja', 'ver', 'mais', 'detalhes', 'info', 'baixar', 'download', 'ok', 'ir'];
        document.querySelectorAll('a').forEach((anchor) => {
          const href = anchor.getAttribute('href') || '';
          const rawText = (anchor.textContent || '').trim();
          const ariaLabel = anchor.getAttribute('aria-label')?.trim() || '';
          const title = anchor.getAttribute('title')?.trim() || '';
          const imgs = anchor.querySelectorAll('img');
          const svgs = anchor.querySelectorAll('svg');
          const hasImage = imgs.length > 0 || svgs.length > 0;
          const opensNewTab = anchor.getAttribute('target') === '_blank';
          let accessibleName = rawText || ariaLabel || title;
          if (!accessibleName && hasImage) {
            const imgAlts = Array.from(imgs).map(img => img.getAttribute('alt')?.trim() || '').filter(Boolean);
            const svgLabels = Array.from(svgs).map(svg => svg.getAttribute('aria-label')?.trim() || '').filter(Boolean);
            accessibleName = [...imgAlts, ...svgLabels].join(' ');
          }
          const issues = [];
          if (!href || href === '#' || href.startsWith('javascript:')) issues.push(!href ? 'Link sem href' : href === '#' ? 'Link com href="#"' : 'Link com href="javascript:"');
          if (!accessibleName) issues.push('Link sem texto acessível');
          if (accessibleName && GENERIC.includes(accessibleName.toLowerCase())) issues.push(`Texto genérico "${accessibleName}"`);
          if (hasImage && !rawText && !ariaLabel) {
            const noAlt = Array.from(imgs).filter(img => !img.getAttribute('alt')?.trim());
            if (noAlt.length > 0) issues.push('Link com imagem sem alt');
          }
          if (opensNewTab && !rawText.includes('nova') && !ariaLabel.includes('nova')) issues.push('Abre em nova aba sem indicação');
          let status = 'approved';
          if (issues.some(i => i.includes('sem texto') || i.includes('sem href'))) status = 'error';
          else if (issues.length > 0) status = issues.some(i => i.includes('genérico') || i.includes('sem alt')) ? 'error' : 'warning';
          results.push({ href, text: accessibleName || '(vazio)', status, issues, htmlSnippet: snippet(anchor, 400), hasImage, opensNewTab });
        });
        return results;
      };

      // ===== 11. analyzeInteractives =====
      const analyzeInteractives = () => {
        const results = [];
        const INTERACTIVE_ROLES = ['button', 'link', 'tab', 'switch', 'checkbox', 'radio', 'slider', 'spinbutton', 'combobox', 'listbox', 'menu', 'menuitem'];
        document.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"]').forEach((el) => {
          const tag = el.tagName.toLowerCase();
          let name = tag === 'input' ? (el.getAttribute('value')?.trim() || el.getAttribute('aria-label')?.trim() || '') : getAccessibleName(el);
          const issues = [];
          if (!name) issues.push('Botão sem nome acessível');
          results.push({ type: 'button', element: el.getAttribute('id') ? `#${el.getAttribute('id')}` : `<${tag}>`, status: name ? 'approved' : 'error', issues, htmlSnippet: snippet(el, 400), accessibleName: name || '(vazio)' });
        });
        document.querySelectorAll('iframe').forEach((iframe) => {
          const title = iframe.getAttribute('title')?.trim() || '';
          const issues = [];
          if (!title) issues.push('Iframe sem title');
          results.push({ type: 'iframe', element: iframe.getAttribute('src')?.slice(0, 60) || '(sem src)', status: title ? 'approved' : 'error', issues, htmlSnippet: snippet(iframe, 400), accessibleName: title || '(vazio)' });
        });
        const roleSelector = INTERACTIVE_ROLES.map(r => `[role="${r}"]`).join(',');
        document.querySelectorAll(roleSelector).forEach((el) => {
          const tag = el.tagName.toLowerCase();
          if (['button', 'a', 'input', 'select', 'textarea'].includes(tag)) return;
          const role = el.getAttribute('role') || '';
          const name = getAccessibleName(el);
          const issues = [];
          if (!name) issues.push(`role="${role}" sem nome acessível`);
          results.push({ type: 'role-element', element: el.getAttribute('id') ? `#${el.getAttribute('id')}` : `<${tag} role="${role}">`, status: name ? 'approved' : 'error', issues, htmlSnippet: snippet(el, 400), accessibleName: name || '(vazio)' });
        });
        document.querySelectorAll('select').forEach((select) => {
          const id = select.getAttribute('id');
          const ariaLabel = select.getAttribute('aria-label')?.trim();
          const hasLabel = id ? document.querySelector(`label[for="${id}"]`) !== null : false;
          const name = ariaLabel || (hasLabel ? 'label' : select.closest('label') ? 'label' : '');
          const issues = [];
          if (!name) issues.push('Select sem label');
          results.push({ type: 'select', element: id ? `#${id}` : '<select>', status: name ? 'approved' : 'error', issues, htmlSnippet: snippet(select, 400), accessibleName: name || '(vazio)' });
        });
        document.querySelectorAll('details').forEach((details) => {
          const summary = details.querySelector('summary');
          const issues = [];
          if (!summary) issues.push('<details> sem <summary>');
          else if (!summary.textContent?.trim()) issues.push('<summary> vazio');
          results.push({ type: 'details', element: '<details>', status: summary?.textContent?.trim() ? 'approved' : 'error', issues, htmlSnippet: snippet(details, 400), accessibleName: summary?.textContent?.trim() || '(vazio)' });
        });
        return results;
      };

      // ===== 12. analyzePageMeta =====
      const analyzePageMeta = () => {
        const results = [];
        const VALID_LANGS = ['aa','ab','af','ak','am','an','ar','as','av','ay','az','ba','be','bg','bh','bi','bm','bn','bo','br','bs','ca','ce','ch','co','cr','cs','cu','cv','cy','da','de','dv','dz','ee','el','en','eo','es','et','eu','fa','ff','fi','fj','fo','fr','fy','ga','gd','gl','gn','gu','gv','ha','he','hi','ho','hr','ht','hu','hy','hz','ia','id','ie','ig','ii','ik','io','is','it','iu','ja','jv','ka','kg','ki','kj','kk','kl','km','kn','ko','kr','ks','ku','kv','kw','ky','la','lb','lg','li','ln','lo','lt','lu','lv','mg','mh','mi','mk','ml','mn','mr','ms','mt','my','na','nb','nd','ne','ng','nl','nn','no','nr','nv','ny','oc','oj','om','or','os','pa','pi','pl','ps','pt','qu','rm','rn','ro','ru','rw','sa','sc','sd','se','sg','si','sk','sl','sm','sn','so','sq','sr','ss','st','su','sv','sw','ta','te','tg','th','ti','tk','tl','tn','to','tr','ts','tt','tw','ty','ug','uk','ur','uz','ve','vi','vo','wa','wo','xh','yi','yo','za','zh','zu'];
        // Language
        const lang = document.documentElement?.getAttribute('lang')?.trim() || '';
        if (!lang) results.push({ type: 'language', criterionId: '3.1.1', element: '<html>', status: 'error', issues: ['<html> sem atributo lang'], detail: 'Atributo lang ausente', htmlSnippet: `<html>` });
        else {
          const baseLang = lang.split('-')[0].toLowerCase();
          const isValid = VALID_LANGS.includes(baseLang);
          results.push({ type: 'language', criterionId: '3.1.1', element: '<html>', status: isValid ? 'approved' : 'error', issues: isValid ? [] : [`Código "${lang}" inválido`], detail: isValid ? `Idioma: ${lang}` : `Código inválido: ${lang}`, htmlSnippet: `<html lang="${lang}">` });
        }
        // Title
        const titleText = document.title?.trim() || '';
        const GENERIC_TITLES = ['untitled', 'home', 'document', 'page', 'index', 'welcome', 'título', 'sem título', 'new tab', 'nova aba', 'página inicial', 'teste', 'test'];
        if (!titleText) results.push({ type: 'title', criterionId: '2.4.2', element: '<title>', status: 'error', issues: ['Página sem <title>'], detail: '<title> ausente ou vazio', htmlSnippet: '(ausente)' });
        else {
          const isGeneric = GENERIC_TITLES.some(g => titleText.toLowerCase() === g);
          const issues = [];
          if (isGeneric) issues.push(`Título genérico: "${titleText}" — deve descrever o conteúdo específico da página`);
          if (titleText.length < 3) issues.push(`Título muito curto: "${titleText}"`);
          results.push({ type: 'title', criterionId: '2.4.2', element: '<title>', status: issues.length > 0 ? 'error' : 'approved', issues, detail: `Título: "${titleText}"`, htmlSnippet: `<title>${titleText}</title>` });
        }
        // Skip nav
        const skipSelectors = 'a[href="#main"], a[href="#main-content"], a[href="#content"], a[href="#conteudo"], a[href="#skip"]';
        let hasSkipLink = document.querySelectorAll(skipSelectors).length > 0;
        if (!hasSkipLink) document.querySelectorAll('a[href^="#"]').forEach(link => { const text = (link.textContent || '').toLowerCase(); if (text.includes('skip') || text.includes('pular') || text.includes('ir para o conteúdo')) hasSkipLink = true; });
        const hasMainLandmark = !!document.querySelector('main, [role="main"]');
        const skipIssues = [];
        if (!hasSkipLink) skipIssues.push('Nenhum link de "pular navegação"');
        if (!hasMainLandmark) skipIssues.push('Sem <main> ou role="main"');
        results.push({ type: 'skip-nav', criterionId: '2.4.1', element: hasSkipLink ? 'skip-link' : hasMainLandmark ? '<main>' : '(ausente)', status: hasSkipLink && hasMainLandmark ? 'approved' : hasSkipLink || hasMainLandmark ? 'warning' : 'error', issues: skipIssues, detail: [hasSkipLink ? 'Skip-nav ✓' : 'Skip-nav ✗', hasMainLandmark ? '<main> ✓' : '<main> ✗'].join(' · '), htmlSnippet: '' });
        return results;
      };

      // ===== Run all analyses =====
      const images = analyzeImages();
      const media = analyzeMedia();
      const structure = analyzeStructure();
      const sequence = analyzeSequence();
      const sensory = analyzeSensory();
      const color = analyzeColor();
      const audioControl = analyzeAudioControl();
      const keyboard = analyzeKeyboard();
      const keyboardTrap = analyzeKeyboardTrap();
      const keyboardShortcuts = analyzeKeyboardShortcuts();
      const timeLimits = analyzeTimeLimits();
      const movingContent = analyzeMovingContent();
      
      const focusOrder = analyzeFocusOrder();
      const pointerGestures = analyzePointerGestures();
      const pointerCancellation = analyzePointerCancellation();
      const labelInName = analyzeLabelInName();
      const motionActuation = analyzeMotionActuation();
      const consistentHelp = analyzeConsistentHelp();
      const errorIdentification = analyzeErrorIdentification();
      const labelsInstructions = analyzeLabelsInstructions();
      const redundantEntry = analyzeRedundantEntry();
      const links = analyzeLinks();
      const interactives = analyzeInteractives();
      const pageMeta = analyzePageMeta();

      // ===== 13. analyzeStatusMessages (4.1.3) =====
      const analyzeStatusMessages = () => {
        const results = [];
        // 1. Check elements with role="status"
        document.querySelectorAll('[role="status"]').forEach((el) => {
          const text = (el.textContent || '').trim();
          const ariaLive = el.getAttribute('aria-live') || '';
          const issues = [];
          if (!text && !el.children.length) issues.push('role="status" presente mas elemento vazio');
          results.push({ element: el.tagName.toLowerCase(), role: 'status', text: text.slice(0, 200), ariaLive: ariaLive || 'polite (implícito)', issues, status: issues.length > 0 ? 'warning' : 'approved', htmlSnippet: snippet(el, 400) });
        });
        // 2. Check elements with role="alert"
        document.querySelectorAll('[role="alert"]').forEach((el) => {
          const text = (el.textContent || '').trim();
          const ariaLive = el.getAttribute('aria-live') || '';
          const issues = [];
          if (!text && !el.children.length) issues.push('role="alert" presente mas elemento vazio');
          results.push({ element: el.tagName.toLowerCase(), role: 'alert', text: text.slice(0, 200), ariaLive: ariaLive || 'assertive (implícito)', issues, status: issues.length > 0 ? 'warning' : 'approved', htmlSnippet: snippet(el, 400) });
        });
        // 3. Check elements with role="log"
        document.querySelectorAll('[role="log"]').forEach((el) => {
          const text = (el.textContent || '').trim();
          results.push({ element: el.tagName.toLowerCase(), role: 'log', text: text.slice(0, 200), ariaLive: el.getAttribute('aria-live') || 'polite (implícito)', issues: [], status: 'approved', htmlSnippet: snippet(el, 400) });
        });
        // 4. Check elements with role="progressbar"
        document.querySelectorAll('[role="progressbar"]').forEach((el) => {
          const ariaValueNow = el.getAttribute('aria-valuenow');
          const ariaValueText = el.getAttribute('aria-valuetext');
          const ariaLabel = el.getAttribute('aria-label');
          const issues = [];
          if (!ariaValueNow && !ariaValueText) issues.push('Barra de progresso sem aria-valuenow ou aria-valuetext');
          if (!ariaLabel && !el.getAttribute('aria-labelledby')) issues.push('Barra de progresso sem label acessível');
          results.push({ element: el.tagName.toLowerCase(), role: 'progressbar', text: ariaValueText || `${ariaValueNow || '?'}%`, ariaLive: el.getAttribute('aria-live') || '', issues, status: issues.length > 0 ? 'warning' : 'approved', htmlSnippet: snippet(el, 400) });
        });
        // 5. Check aria-live regions
        document.querySelectorAll('[aria-live]').forEach((el) => {
          const role = el.getAttribute('role') || '';
          if (['status', 'alert', 'log', 'progressbar'].includes(role)) return; // already checked
          const ariaLive = el.getAttribute('aria-live') || '';
          const text = (el.textContent || '').trim();
          results.push({ element: el.tagName.toLowerCase(), role: role || '(sem role)', text: text.slice(0, 200), ariaLive, issues: [], status: 'approved', htmlSnippet: snippet(el, 400) });
        });
        // 6. Check forms for error messages without proper live regions
        document.querySelectorAll('form').forEach((form) => {
          const errorMsgs = form.querySelectorAll('[class*="error"], [class*="invalid"], [class*="danger"], .field-error, .form-error, .validation-error, .error-message');
          errorMsgs.forEach((errEl) => {
            const role = errEl.getAttribute('role') || '';
            const ariaLive = errEl.getAttribute('aria-live') || '';
            const hasLiveRegion = role === 'alert' || role === 'status' || !!ariaLive;
            if (!hasLiveRegion) {
              results.push({ element: errEl.tagName.toLowerCase(), role: '(sem role)', text: (errEl.textContent || '').trim().slice(0, 200), ariaLive: '(ausente)', issues: ['Mensagem de erro sem role="alert" ou aria-live — não será anunciada por leitores de tela'], status: 'error', htmlSnippet: snippet(errEl, 400) });
            }
          });
        });
        // 7. Check toast/notification containers
        const toastSelectors = '[class*="toast"], [class*="notification"], [class*="snackbar"], [class*="alert-banner"], [class*="flash-message"]';
        document.querySelectorAll(toastSelectors).forEach((el) => {
          const role = el.getAttribute('role') || '';
          const ariaLive = el.getAttribute('aria-live') || '';
          const hasLiveRegion = role === 'alert' || role === 'status' || !!ariaLive;
          if (!hasLiveRegion) {
            results.push({ element: el.tagName.toLowerCase(), role: '(sem role)', text: (el.textContent || '').trim().slice(0, 200), ariaLive: '(ausente)', issues: ['Notificação/toast sem role ou aria-live — invisível para leitores de tela'], status: 'error', htmlSnippet: snippet(el, 400) });
          }
        });
        if (results.length === 0) {
          // Check if page has any dynamic content indicators
          const hasForms = document.querySelectorAll('form').length > 0;
          const hasButtons = document.querySelectorAll('button, [role="button"]').length > 0;
          const hasDynamicContent = hasForms || hasButtons || document.querySelectorAll('[class*="counter"], [class*="cart"], [class*="count"], [id*="status"], [id*="count"]').length > 0;
          if (hasDynamicContent) {
            results.push({ element: 'page', role: '(nenhum)', text: '', ariaLive: '', issues: ['Página com conteúdo interativo mas sem regiões aria-live ou role="status" — mudanças dinâmicas não serão anunciadas'], status: 'error', htmlSnippet: '' });
          } else {
            results.push({ element: 'page', role: '(nenhum)', text: '', ariaLive: '', issues: [], status: 'approved', htmlSnippet: '' });
          }
        }
        return results;
      };
      const statusMessages = analyzeStatusMessages();

      // Count total DOM elements
      const totalDomElements = document.querySelectorAll('*').length;

      // Build criteria for scoring
      const metaBycriterion = {
        '2.4.2': pageMeta.filter(m => m.criterionId === '2.4.2'),
        '3.1.1': pageMeta.filter(m => m.criterionId === '3.1.1'),
        '2.4.1': pageMeta.filter(m => m.criterionId === '2.4.1'),
      };

      const criteria = [
        { id: '1.1.1', name: 'Conteúdo não textual', wcagLevel: 'A', ...countByStatus(images) },
        { id: '1.2.1', name: 'Áudio/Vídeo pré-gravados', wcagLevel: 'A', ...countByStatus(media) },
        { id: '1.2.2', name: 'Legendas (Pré-gravadas)', wcagLevel: 'A', ...countByStatus((() => {
          const videoMedia = media.filter(m => m.type === 'video');
          if (videoMedia.length === 0) return [{ status: 'approved' }];
          return videoMedia.map(m => ({ ...m, status: (m.trackKinds.includes('captions') || m.trackKinds.includes('subtitles')) ? 'approved' : m.issues.some(i => i.includes('Nenhum elemento')) ? 'approved' : 'error' }));
        })()) },
        { id: '1.2.3', name: 'Audiodescrição (Pré-gravada)', wcagLevel: 'A', ...countByStatus((() => {
          const videoMedia = media.filter(m => m.type === 'video');
          if (videoMedia.length === 0) return [{ status: 'approved' }];
          return videoMedia.map(m => ({ ...m, status: m.trackKinds.includes('descriptions') ? 'approved' : m.issues.some(i => i.includes('Nenhum elemento')) ? 'approved' : 'error' }));
        })()) },
        { id: '1.3.1', name: 'Informação e Relações', wcagLevel: 'A', ...countByStatus(structure) },
        { id: '1.3.2', name: 'Sequência Significativa', wcagLevel: 'A', ...countByStatus(sequence) },
        { id: '1.3.3', name: 'Características Sensoriais', wcagLevel: 'A', ...countByStatus(sensory) },
        { id: '1.4.1', name: 'Uso de Cor', wcagLevel: 'A', ...countByStatus(color) },
        { id: '1.4.2', name: 'Controle de Áudio', wcagLevel: 'A', ...countByStatus(audioControl) },
        { id: '2.1.1', name: 'Teclado', wcagLevel: 'A', ...countByStatus(keyboard) },
        { id: '2.1.2', name: 'Sem Bloqueio de Teclado', wcagLevel: 'A', ...countByStatus(keyboardTrap) },
        { id: '2.1.4', name: 'Atalhos de Teclado', wcagLevel: 'A', ...countByStatus(keyboardShortcuts) },
        { id: '2.2.1', name: 'Tempo Ajustável', wcagLevel: 'A', ...countByStatus(timeLimits) },
        { id: '2.2.2', name: 'Pausar, Parar, Ocultar', wcagLevel: 'A', ...countByStatus(movingContent) },
        
        { id: '2.4.3', name: 'Ordem do Foco', wcagLevel: 'A', ...countByStatus(focusOrder) },
        { id: '2.5.1', name: 'Gestos de Acionamento', wcagLevel: 'A', ...countByStatus(pointerGestures) },
        { id: '2.5.2', name: 'Cancelamento de Ponteiro', wcagLevel: 'A', ...countByStatus(pointerCancellation) },
        { id: '2.5.3', name: 'Rótulo em Nome', wcagLevel: 'A', ...countByStatus(labelInName) },
        { id: '2.5.4', name: 'Atuação em Movimento', wcagLevel: 'A', ...countByStatus(motionActuation) },
        { id: '2.4.1', name: 'Ignorar Blocos', wcagLevel: 'A', ...countByStatus(metaBycriterion['2.4.1']) },
        { id: '2.4.2', name: 'Página com Título', wcagLevel: 'A', ...countByStatus(metaBycriterion['2.4.2']) },
        { id: '2.4.4', name: 'Finalidade do Link', wcagLevel: 'A', ...countByStatus(links) },
        { id: '3.1.1', name: 'Idioma da Página', wcagLevel: 'A', ...countByStatus(metaBycriterion['3.1.1']) },
        { id: '3.2.6', name: 'Ajuda Consistente', wcagLevel: 'A', ...countByStatus(consistentHelp) },
        { id: '3.3.1', name: 'Identificação de Erro', wcagLevel: 'A', ...countByStatus(errorIdentification) },
        { id: '3.3.2', name: 'Rótulos ou Instruções', wcagLevel: 'A', ...countByStatus(labelsInstructions) },
        { id: '3.3.7', name: 'Entrada Redundante', wcagLevel: 'A', ...countByStatus(redundantEntry) },
        { id: '4.1.2', name: 'Nome, Função, Valor', wcagLevel: 'A', ...countByStatus(interactives) },
        { id: '4.1.3', name: 'Mensagens de Status', wcagLevel: 'A', ...countByStatus(statusMessages) },
      ];

      // Calculate score
      const WEIGHTS = { A: 0.333, AA: 0.50, AAA: 0.167 };
      const totalErrors = criteria.reduce((sum, c) => sum + c.errors, 0);
      const totalWarnings = criteria.reduce((sum, c) => sum + c.warnings, 0);
      const totalApproved = criteria.reduce((sum, c) => sum + c.approved, 0);
      const levelACounts = criteria.filter(c => c.wcagLevel === 'A').reduce((sum, c) => sum + c.errors, 0);
      const levelAACounts = criteria.filter(c => c.wcagLevel === 'AA').reduce((sum, c) => sum + c.errors, 0);
      const levelAAACounts = criteria.filter(c => c.wcagLevel === 'AAA').reduce((sum, c) => sum + c.errors, 0);
      const errosPonderados = levelACounts * WEIGHTS.A + levelAACounts * WEIGHTS.AA + levelAAACounts * WEIGHTS.AAA;
      const totalErrosPonderados = errosPonderados + 100;
      const score = Math.round(100 - (errosPonderados / totalErrosPonderados) * 100);
      let level;
      if (score >= 90) level = 'Excelente';
      else if (score >= 70) level = 'Bom';
      else if (score >= 50) level = 'Regular';
      else level = 'Crítico';

      return {
        images: { ...countByStatus(images), items: sortByStatus(images) },
        media: { ...countByStatus(media), items: sortByStatus(media) },
        structure: { ...countByStatus(structure), items: sortByStatus(structure) },
        sequence: { ...countByStatus(sequence), items: sortByStatus(sequence) },
        sensory: { ...countByStatus(sensory), items: sensory },
        color: { ...countByStatus(color), items: color },
        audioControl: { ...countByStatus(audioControl), items: audioControl },
        keyboard: { ...countByStatus(keyboard), items: keyboard },
        keyboardTrap: { ...countByStatus(keyboardTrap), items: keyboardTrap },
        keyboardShortcuts: { ...countByStatus(keyboardShortcuts), items: keyboardShortcuts },
        timeLimits: { ...countByStatus(timeLimits), items: timeLimits },
        movingContent: { ...countByStatus(movingContent), items: movingContent },
        
        focusOrder: { ...countByStatus(focusOrder), items: focusOrder },
        pointerGestures: { ...countByStatus(pointerGestures), items: pointerGestures },
        pointerCancellation: { ...countByStatus(pointerCancellation), items: pointerCancellation },
        labelInName: { ...countByStatus(labelInName), items: labelInName },
        motionActuation: { ...countByStatus(motionActuation), items: motionActuation },
        consistentHelp: { ...countByStatus(consistentHelp), items: consistentHelp },
        errorIdentification: { ...countByStatus(errorIdentification), items: errorIdentification },
        labelsInstructions: { ...countByStatus(labelsInstructions), items: labelsInstructions },
        redundantEntry: { ...countByStatus(redundantEntry), items: redundantEntry },
        links: { ...countByStatus(links), items: sortByStatus(links) },
        interactives: { ...countByStatus(interactives), items: sortByStatus(interactives) },
        pageMeta: { ...countByStatus(pageMeta), items: pageMeta },
        statusMessages: { ...countByStatus(statusMessages), items: statusMessages },
        score: { score, level, criteria, totalErrors, totalWarnings, totalApproved, levelACounts, levelAACounts, levelAAACounts },
        totalDomElements,
      };
    }, url);

    console.log(`[Analyze] Done. Score: ${analysisResult.score.score}%, Elements: ${analysisResult.totalDomElements}`);

    res.json({
      url: finalUrl,
      html: html,
      analysis: analysisResult,
      renderer: 'puppeteer',
      analyzedAt: new Date().toISOString(),
    });

  } catch (error) {
    console.error(`[Analyze] Error:`, error.message);
    res.status(500).json({ error: `Erro na análise: ${error.message}` });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Puppeteer renderer running on port ${PORT}`);
});
