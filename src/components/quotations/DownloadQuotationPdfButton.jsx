import React, { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getCompanyLogoData } from "@/lib/logo-fns";
import { generateQuotationPdf } from "@/lib/pdf/quotationPdf";
import { useSession } from "@/lib/SessionContext";
import { useI18n } from "@/lib/i18n/I18nContext";

// Logos are stored as PNG, JPG or WebP; a PDF embeds PNG. The image is converted and scaled down
// to print resolution here: roughly 400 dpi at the size a logo occupies on the page, which also
// keeps the generated file small (the logo is the only part of the document with real weight).
// A logo that cannot be prepared is skipped rather than blocking the document.
const MAX_LOGO_WIDTH = 640;

function prepareLogo(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const naturalWidth = image.naturalWidth || 1;
        const naturalHeight = image.naturalHeight || 1;
        const scale = Math.min(1, MAX_LOGO_WIDTH / naturalWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve({ dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height });
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

// Builds the PDF in the browser from data the signed-in member is already allowed to read: the
// quotation and its client come from the page's own query, the company from the session, and the
// logo as image data from a server function that never returns the private storage reference.
export default function DownloadQuotationPdfButton({ quotation, client, currency }) {
  const { t, lang } = useI18n();
  const { activeCompany } = useSession();
  const fetchLogo = useServerFn(getCompanyLogoData);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      let logo = null;
      if (activeCompany?.has_logo) {
        const data = await fetchLogo();
        if (data?.data_url) logo = await prepareLogo(data.data_url);
      }
      const doc = await generateQuotationPdf({
        quotation,
        client,
        company: activeCompany,
        logo,
        t,
        lang,
        currency,
      });
      doc.save(`${quotation.number || "quotation"}.pdf`);
    } catch {
      toast.error(t("quotations.pdf_error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" className="gap-2" disabled={busy} onClick={download}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {busy ? t("quotations.generating_pdf") : t("quotations.download_pdf")}
    </Button>
  );
}