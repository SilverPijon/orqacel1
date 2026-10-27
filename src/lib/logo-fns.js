import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import { httpError, requireCompanyContext } from "@/lib/tenant.server";
import {
  LOGO_MAX_BYTES,
  LOGO_SIGNED_URL_TTL,
  base64FromBytes,
  fetchPrivateFileBytes,
  isPrivateFileRef,
  readCompanyLogo,
  sniffLogoType,
} from "@/lib/logo.server";

// The company is always the caller's own active membership from the server-side session; a
// company id sent by the browser is never accepted. The logo reference itself never leaves
// the server: the browser only ever receives a short-lived signed URL or image data.
async function readActiveCompanyLogo(context, minimumRole) {
  const session = await requireCompanyContext(context, minimumRole);
  const service = context.getBase44().asServiceRole;
  const company = await service.entities.Company.get(session.activeCompany.id).catch(() => null);
  if (!company) throw httpError(404, "Company not found", "NOT_FOUND");
  return { session, service, logo: readCompanyLogo(company) };
}

export const setCompanyLogo = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ file_uri: z.string().min(1).max(600) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;
    const fileUri = data.file_uri.trim();

    if (!isPrivateFileRef(fileUri)) {
      throw httpError(400, "The logo must be an uploaded private file", "BAD_FILE_REF");
    }

    // The file's own bytes decide the type and the size, so a renamed or disguised file is
    // rejected here rather than stored.
    const bytes = await fetchPrivateFileBytes(service, fileUri);
    if (!bytes || !bytes.length) {
      throw httpError(400, "The uploaded file could not be read", "FILE_UNREADABLE");
    }
    if (bytes.length > LOGO_MAX_BYTES) {
      throw httpError(413, "The logo must be 2 MB or smaller", "FILE_TOO_LARGE");
    }
    const contentType = sniffLogoType(bytes);
    if (!contentType) {
      throw httpError(415, "Only PNG, JPG or WebP images are supported", "UNSUPPORTED_FILE");
    }

    const updated_at = new Date().toISOString();
    await service.entities.Company.update(session.activeCompany.id, {
      logo_file_uri: fileUri,
      logo_content_type: contentType,
      logo_size: bytes.length,
      logo_updated_at: updated_at,
    });

    return { has_logo: true, content_type: contentType, size: bytes.length, updated_at };
  });

export const removeCompanyLogo = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({}))
  .handler(async ({ context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;

    // Platform storage has no delete primitive: clearing the reference is what removes the
    // logo from every screen. The superseded object stays in storage, unreferenced.
    await service.entities.Company.update(session.activeCompany.id, {
      logo_file_uri: null,
      logo_content_type: null,
      logo_size: null,
      logo_updated_at: new Date().toISOString(),
    });

    return { has_logo: false };
  });

export const getCompanyLogoUrl = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const { service, logo } = await readActiveCompanyLogo(context);
    if (!logo) return { signed_url: null, content_type: null, updated_at: null };

    const { signed_url } = await service.integrations.Core.CreateFileSignedUrl({
      file_uri: logo.file_uri,
      expires_in: LOGO_SIGNED_URL_TTL,
    });

    return {
      signed_url: signed_url || null,
      content_type: logo.content_type,
      updated_at: logo.updated_at,
    };
  });

// The logo as an embeddable data image, ready for the quotation PDF step in a later phase.
export const getCompanyLogoData = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const { service, logo } = await readActiveCompanyLogo(context);
    if (!logo) return { data_url: null, content_type: null };

    const bytes = await fetchPrivateFileBytes(service, logo.file_uri);
    const contentType = bytes ? sniffLogoType(bytes) : null;
    if (!bytes || !contentType) return { data_url: null, content_type: null };

    return {
      data_url: `data:${contentType};base64,${base64FromBytes(bytes)}`,
      content_type: contentType,
    };
  });