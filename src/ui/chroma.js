// Runtime chroma-key. Unit portraits are authored on a solid #FF007F (magenta)
// background; this turns that background transparent in the browser via a canvas,
// so the source PNGs never need pre-processing. The result is cached as a data
// URL per image path, and processing happens once — repeated renders are free.
//
// Tolerance is sized to the actual art: the "magenta" backgrounds aren't a flat
// exact color — they vary per file and carry a slight gradient/noise (corners
// range ~#f53280 .. #fe007a, up to ~70 away from the nominal #FF007F). Measuring
// the six portraits showed the band 70–90 from the key is EMPTY (no character
// pixels live there), so TOL=80 removes every background cleanly with margin and
// without eating the art. Bump KEY/TOL here if you change the keying color.

const KEY = { r: 0xff, g: 0x00, b: 0x7f }; // #FF007F (nominal)
const TOL = 80;                            // max color distance treated as background
const TOL2 = TOL * TOL;

/** path -> Promise<dataURL>. One conversion per image, then reused. */
const cache = new Map();

/**
 * Return a Promise of a transparent-background data URL for an image path.
 * @param {string} src
 * @returns {Promise<string>}
 */
export function chromaKeyed(src) {
  let p = cache.get(src);
  if (!p) {
    p = convert(src);
    cache.set(src, p);
  }
  return p;
}

function convert(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const frame = ctx.getImageData(0, 0, w, h);
        const px = frame.data;
        for (let i = 0; i < px.length; i += 4) {
          const dr = px[i] - KEY.r;
          const dg = px[i + 1] - KEY.g;
          const db = px[i + 2] - KEY.b;
          if (dr * dr + dg * dg + db * db <= TOL2) px[i + 3] = 0; // make transparent
        }
        ctx.putImageData(frame, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error(`chroma: failed to load ${src}`));
    img.src = src;
  });
}
