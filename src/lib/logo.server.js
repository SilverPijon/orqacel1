// Server-only helpers for company logo storage. Never import this module in browser code:
// it reads private files and validates them by their own bytes.

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_SIGNED_URL_TTL = 600;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50];

function matches(bytes, offset, signature) {
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) return false;
  }
  return true;
}

// The stored content type comes from the file itself, never from what the browser declared.
// SVG, GIF and everything else fall through to null and are rejected.
export function sniffLogoType(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (matches(bytes, 0, PNG_SIGNATURE)) return "image/png";
  if (matches(bytes, 0, JPEG_SIGNATURE)) return "image/jpeg";
  if (matches(bytes, 0, RIFF_SIGNATURE) && matches(bytes, 8, WEBP_SIGNATURE)) return "image/webp";
  return null;
}

// A logo reference must be an opaque private-storage reference, not a URL pointing somewhere
// the app does not control.
export function isPrivateFileRef(ref) {
  if (typeof ref !== "string") return false;
  const value = ref.trim();
  if (!value || value.length > 600) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  if (/^(data|blob|file):/i.test(value)) return false;
  if (value.startsWith("//")) return false;
  return true;
}

// Reads a private file's bytes through a short-lived signed URL. Needs a service-role client.
export async function fetchPrivateFileBytes(service, fileUri) {
  const { signed_url } = await service.integrations.Core.CreateFileSignedUrl({
    file_uri: fileUri,
    expires_in: 300,
  });
  if (!signed_url) return null;
  const response = await fetch(signed_url);
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

export function base64FromBytes(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function readCompanyLogo(company) {
  if (!company || !company.logo_file_uri) return null;
  return {
    file_uri: company.logo_file_uri,
    content_type: company.logo_content_type || null,
    size: Number(company.logo_size || 0),
    updated_at: company.logo_updated_at || null,
  };
}