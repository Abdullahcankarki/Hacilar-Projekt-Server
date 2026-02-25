import express, { Request, Response } from 'express';
import https from 'https';
import http from 'http';

const imageProxyRouter = express.Router();

/**
 * GET /api/image-proxy?url=ENCODED_URL
 * Lädt ein Bild von einer externen URL (z.B. Google Drive) und gibt es weiter
 */
imageProxyRouter.get('/image-proxy', async (req: Request, res: Response) => {
  try {
    const imageUrl = req.query.url as string;

    if (!imageUrl) {
      return res.status(400).send('URL parameter is required');
    }

    // Dekodiere die URL
    const decodedUrl = decodeURIComponent(imageUrl);


    const urlObj = new URL(decodedUrl);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 10000,
    };

    let responseSent = false;

    const proxyReq = protocol.request(options, (proxyRes) => {
      // Folge Redirects
      if (proxyRes.statusCode === 301 || proxyRes.statusCode === 302 || proxyRes.statusCode === 303 || proxyRes.statusCode === 307) {
        const redirectUrl = proxyRes.headers.location;
        if (redirectUrl) {
          responseSent = true;
          // Rekursiv aufrufen mit der neuen URL
          res.redirect(307, `/api/image-proxy?url=${encodeURIComponent(redirectUrl)}`);
          return;
        }
      }

      if (responseSent) return;
      responseSent = true;

      // Setze Content-Type Header
      const contentType = proxyRes.headers['content-type'] || 'image/jpeg';
      res.set('Content-Type', contentType);

      // Cache-Header setzen (1 Tag)
      res.set('Cache-Control', 'public, max-age=86400');

      // CORS Header
      res.set('Access-Control-Allow-Origin', '*');

      // Pipe die Response
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (error: any) => {
      if (responseSent) return;
      responseSent = true;
      console.error('[ImageProxy] Fehler beim Laden des Bildes:', error.message);
      res.status(500).send('Failed to load image');
    });

    proxyReq.on('timeout', () => {
      if (responseSent) return;
      responseSent = true;
      console.error('[ImageProxy] Timeout beim Laden des Bildes');
      proxyReq.destroy();
      res.status(504).send('Image load timeout');
    });

    proxyReq.end();
  } catch (error: any) {
    console.error('[ImageProxy] Fehler:', error.message);
    res.status(500).send('Failed to load image');
  }
});

export default imageProxyRouter;
