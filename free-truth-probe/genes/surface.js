'use strict';
/*
 * GENOE — SURFACE GENES (S14): measurer of the WebKit surface, not the wire.
 * ---------------------------------------------------------------------------
 * Serves a single collector page on plain http (localhost only). The page
 * snapshots navigator/screen/webgl-origin/font-draft/timing genes and writes
 * the JSON into the DOM; the driver (vein-s) reads it back. Safari gets NO
 * userAgentData — that absence is itself a measured, honest signal.
 *
 * PORT 10904 (http). Collector is run INSIDE real Safari, so every value is
 * a measured truth from the oracle runner, not a declaration.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const COLLECTOR_JS = `
(function(){
  function webgl(){
    var out = { supported:false };
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if(!gl){ return out; }
      out.supported = true;
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      var gv = ext ? ext.UNMASKED_VENDOR_WEBGL : 0x1f00;
      var gr = ext ? ext.UNMASKED_RENDERER_WEBGL : 0x1f01;
      out.vendor = String(gl.getParameter(gv));
      out.renderer = String(gl.getParameter(gr));
      out.maxTextureSize = gl.getParameter(0x0D33);
      out.webglVersion = '1';
      var gl2 = c.getContext('webgl2');
      out.webgl2 = !!gl2 && !!gl2.getParameter;
    } catch(e){ out.error = String(e); }
    return out;
  }
  function fonts(){
    var draft = ['-apple-system','Helvetica Neue','Arial','Courier New','Times New Roman','Menlo','Monaco','Verdana','Tahoma','Georgia','Palatino','Comic Sans MS','Impact','Zapfino'];
    var out = {};
    try {
      for (var i=0;i<draft.length;i++){
        out[draft[i]] = document.fonts ? document.fonts.check('16px "' + draft[i] + '"') : null;
      }
    } catch(e){ out.error = String(e); }
    return out;
  }
  var s = {};
  s.userAgent = navigator.userAgent;
  s.platform = navigator.platform;
  s.vendor = navigator.vendor;
  s.language = navigator.language;
  s.languages = navigator.languages;
  s.hardwareConcurrency = navigator.hardwareConcurrency;
  s.deviceMemory = navigator.deviceMemory;
  s.maxTouchPoints = navigator.maxTouchPoints;
  s.webdriver = navigator.webdriver;
  s.plugins = (function(){ try { var n=[],p=navigator.plugins; for(var i=0;i<p.length;i++){n.push(p[i].name);} return n;}catch(e){return [];} })();
  s.mimeTypes = navigator.mimeTypes.length;
  s.userAgentData = (typeof navigator.userAgentData !== 'undefined') ? String(navigator.userAgentData.brands && navigator.userAgentData.brands.map(function(b){return b.brand+'@'+b.version;}).join(',')) : null;
  s.screen = { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight, colorDepth: screen.colorDepth, orientation: (screen.orientation && screen.orientation.type) || null };
  s.window = { innerWidth: window.innerWidth, innerHeight: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight, dpr: window.devicePixelRatio, deviceMemory: navigator.deviceMemory };
  s.webgl = webgl();
  s.fonts = fonts();
  s.canvasFp = (function(){ try { var c=document.createElement('canvas'); c.width=300;c.height=150; var g=c.getContext('2d'); g.textBaseline='top'; g.font='14px Arial'; g.fillText('GENOE-SURFACE-'+Math.random(),6,6); return c.toDataURL().length; } catch(e){ return null; } })();
  document.body.textContent = JSON.stringify(s);
})();
`;

const PAGE = '<!doctype html><html><body><script>' + COLLECTOR_JS + '<\/script></body></html>';

function startSurfaceServer({ port = 10904, timeoutMs = 45000, onRequest } = {}) {
  return new Promise((resolve, reject) => {
    const hit = new Promise((res) => setTimeout(() => { server.close(); reject(new Error('surface server timeout')); }, timeoutMs));
    const server = http.createServer((req, res) => {
      if (req.url === '/surface' || req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(PAGE);
      } else {
        res.writeHead(404); res.end();
      }
    });
    server.on('error', (e) => reject(e));
    server.listen(port, '::', () => { onRequest && onRequest(); hit; resolve(server); });
  });
}

function saveSurface(surface, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(surface, null, 2) + '\n');
}

module.exports = { PAGE, COLLECTOR_JS, startSurfaceServer, saveSurface };