// Document font for generated PDFs: Noto Sans, under the SIL Open Font License 1.1, which
// permits embedding in documents. It covers Latin extended (Estonian, Baltic, Polish), Cyrillic
// and Greek, so every language the app supports renders as real, selectable text.
//
// It is fetched on first use instead of being bundled: the two weights are about 1.1 MB, which
// would otherwise be shipped to every visitor for a feature most sessions never use. Noto comes
// from the official googlefonts/noto-fonts repository, with a second host tried if the first is
// unreachable. Nothing is cached beyond the browser session.
const SOURCES = {
  normal: [
    "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Regular.ttf",
    "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf",
  ],
  bold: [
    "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Bold.ttf",
    "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf",
  ],
};

export const PDF_FONT_FAMILY = "NotoSans";
export const PDF_FONT_FILES = { normal: "NotoSans-Regular.ttf", bold: "NotoSans-Bold.ttf" };

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function fetchFont(urls) {
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 4096) return toBase64(buffer);
    } catch {
      /* try the next host */
    }
  }
  return null;
}

let pending = null;

// Returns { normal, bold } as base64, or null when the font could not be retrieved. The regular
// weight is required; bold is optional and simply falls back to regular if it is unavailable.
export async function loadPdfFonts() {
  if (!pending) {
    pending = (async () => {
      const [normal, bold] = await Promise.all([fetchFont(SOURCES.normal), fetchFont(SOURCES.bold)]);
      return normal ? { normal, bold } : null;
    })();
  }
  const fonts = await pending;
  if (!fonts) pending = null; // a failed attempt is not remembered, so a retry can succeed
  return fonts;
}