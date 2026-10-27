import { PDF_FONT_FILES, PDF_FONT_FAMILY, loadPdfFonts } from "@/lib/pdf/fonts";
import { countryLabel } from "@/lib/constants";
import { formatDate, formatMoney, round2 } from "@/lib/format";
import { hasConfiguredVat } from "@/lib/quotationTax";
import { QUOTATION_STATUS } from "@/lib/statusMeta";

// A4 in millimetres: 210 x 297. The document is drawn directly as vector text, so its words stay
// selectable and searchable, and pagination is line-accurate rather than image-sliced.
const PAGE = { width: 210, height: 297 };
const MARGIN = { top: 18, right: 16, bottom: 22, left: 16 };
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;
const FOOTER_LINE = PAGE.height - MARGIN.bottom;

const INK = [10, 10, 10];
const MUTED = [110, 110, 110];
const SURFACE = [245, 245, 245];
const LINE = [229, 231, 235];
const WHITE = [255, 255, 255];

// Column edges, measured from the left page edge.
const COL = { index: 16, descX: 26, descWidth: 88, qtyRight: 146, unitRight: 172, amountRight: 194 };
const LINE_HEIGHT = 4.4;

// Locale currency and date formatting can emit narrow no-break spaces, and user text can carry
// control characters. Normalising both keeps the drawn text intact instead of dropping glyphs.
// Tab and line breaks are left alone: they carry the text's own structure until it is wrapped.
const SPACE_CHARS = /[\u00a0\u2007\u2009\u202f]/g;
// eslint-disable-next-line no-control-regex -- control characters would otherwise print as missing glyphs
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

const clean = (value) => String(value ?? "").replace(SPACE_CHARS, " ").replace(CONTROL_CHARS, "").trim();

function splitLines(doc, value, width) {
  const text = clean(value);
  if (!text) return [];
  return text
    .split("\n")
    .flatMap((paragraph) => (paragraph.trim() ? doc.splitTextToSize(paragraph.trim(), width) : []));
}

/**
 * Builds the quotation as an A4 PDF and returns the jsPDF document.
 *
 * All figures, dates and text come from the stored quotation, its client record and the active
 * company: nothing is recalculated and no tax treatment is inferred. The logo arrives as image
 * data prepared by the caller, so the private storage reference never leaves the server.
 */
export async function generateQuotationPdf({ quotation, client, company, logo, t, lang = "en", currency = "EUR" }) {
  const fonts = await loadPdfFonts();
  if (!fonts) throw new Error("Document font unavailable");

  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.addFileToVFS(PDF_FONT_FILES.normal, fonts.normal);
  doc.addFont(PDF_FONT_FILES.normal, PDF_FONT_FAMILY, "normal");
  if (fonts.bold) {
    doc.addFileToVFS(PDF_FONT_FILES.bold, fonts.bold);
    doc.addFont(PDF_FONT_FILES.bold, PDF_FONT_FAMILY, "bold");
  }

  const style = (weight, size, color = INK) => {
    doc.setFont(PDF_FONT_FAMILY, weight === "bold" && fonts.bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
  };
  const write = (value, x, y, options) => {
    const text = clean(value);
    if (text) doc.text(text, x, y, options);
  };
  const right = (value, x, y) => write(value, x, y, { align: "right" });
  const rule = (from, to) => {
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.2);
    doc.line(from, y, to, y);
  };

  const companyName = clean(company?.name) || t("app.name");
  const status = QUOTATION_STATUS[quotation.status] || QUOTATION_STATUS.draft;
  const showVat = hasConfiguredVat(quotation);
  const vatRate = Number(quotation.tax_rate || 0);
  const money = (amount) => formatMoney(amount, currency, lang);
  const quantity = (value) => String(Number(value || 0));

  // A value that only repeats one already printed is left out: a customer whose contact person
  // carries the same name as the customer, or a company whose legal name equals its trading name,
  // is not shown twice. Two genuinely different names are both kept.
  const sameText = (first, second) => {
    const value = clean(first).toLowerCase();
    return Boolean(value) && value === clean(second).toLowerCase();
  };

  let y = MARGIN.top;
  let repeatTableHeader = null;

  // `repeatTableHeader: false` keeps the column titles off a page that opens with something other
  // than table rows (the totals block, the notes), where they would sit above unrelated content.
  const pageBreak = ({ repeatTableHeader: repeatRows = true } = {}) => {
    doc.addPage();
    y = MARGIN.top;
    // A slim continuation header keeps every printed page identifiable.
    style("bold", 9);
    write(`${companyName} · ${quotation.number}`, MARGIN.left, y + 3);
    style("normal", 9, MUTED);
    right(quotation.client_name, PAGE.width - MARGIN.right, y + 3);
    y += 6;
    rule(MARGIN.left, PAGE.width - MARGIN.right);
    y += 6;
    if (repeatRows && repeatTableHeader) repeatTableHeader();
  };
  const ensure = (height, options) => {
    if (y + height > FOOTER_LINE) pageBreak(options);
  };

  // --- Masthead: the company's own identity, and the document's identity ---------------------
  const maxLogo = { width: 40, height: 18 };
  let identityX = MARGIN.left;
  if (logo?.dataUrl) {
    const ratio = Math.min(maxLogo.width / logo.width, maxLogo.height / logo.height);
    const width = logo.width * ratio;
    const height = logo.height * ratio;
    try {
      doc.addImage(logo.dataUrl, "PNG", MARGIN.left, y, width, height);
      identityX = MARGIN.left + width + 6;
    } catch {
      /* the company name still carries the identity */
    }
  }
  if (identityX === MARGIN.left) {
    doc.setFillColor(INK[0], INK[1], INK[2]);
    doc.roundedRect(MARGIN.left, y, 14, 14, 2.5, 2.5, "F");
    style("bold", 14, WHITE);
    write(companyName.slice(0, 1).toLocaleUpperCase(lang), MARGIN.left + 7, y + 9.7, { align: "center" });
    identityX = MARGIN.left + 20;
  }

  const identityWidth = Math.max(40, COL.qtyRight - identityX - 10);
  const nameLines = splitLines(doc, companyName, identityWidth).slice(0, 2);
  style("bold", 15);
  nameLines.forEach((line, index) => write(line, identityX, y + 6 + index * 6));
  if (clean(company?.legal_name) && !sameText(company.legal_name, companyName)) {
    style("normal", 9, MUTED);
    write(company.legal_name, identityX, y + 6 + nameLines.length * 6);
  }

  style("normal", 9, MUTED);
  right(t("quotations.document_title"), PAGE.width - MARGIN.right, y + 4);
  style("bold", 14);
  right(quotation.number, PAGE.width - MARGIN.right, y + 10);
  style("normal", 9, MUTED);
  right(t(status.key), PAGE.width - MARGIN.right, y + 15);
  y += 22;
  rule(MARGIN.left, PAGE.width - MARGIN.right);
  y += 6;

  // --- Company contact details (left) and document facts (right) ------------------------------
  const contactWidth = 92;
  const contactLines = [
    company?.address,
    [company?.postal_code, company?.city].filter(Boolean).join(" "),
    company?.country ? countryLabel(company.country, lang) : "",
    company?.email,
    company?.phone,
    company?.website,
    company?.registration_number ? `${t("settings.registration_number")}: ${company.registration_number}` : "",
    company?.tax_number ? `${t("settings.tax_number")}: ${company.tax_number}` : "",
  ]
    .filter(Boolean)
    .flatMap((line) => splitLines(doc, line, contactWidth));

  let contactY = y;
  if (contactLines.length) {
    style("normal", 9, MUTED);
    contactLines.forEach((line) => {
      write(line, MARGIN.left, contactY + 3.5);
      contactY += LINE_HEIGHT;
    });
  }

  let metaY = y + 3.5;
  const metaRow = (label, value) => {
    if (!clean(value)) return;
    style("normal", 9, MUTED);
    write(label, COL.qtyRight - 16, metaY, { align: "right" });
    style("bold", 9);
    right(value, COL.amountRight, metaY);
    metaY += 5;
  };
  // Both dates read exactly as the quotation page shows them, so a date that was never set is
  // presented the same way in the app and on the document instead of vanishing from one of them.
  metaRow(t("quotations.issue_date"), formatDate(quotation.issue_date, lang));
  metaRow(t("quotations.valid_until"), formatDate(quotation.valid_until, lang));
  metaRow(t("common.status"), t(status.key));
  metaRow(t("common.currency"), currency);

  y = Math.max(contactY, metaY) + 5;

  // --- Customer ------------------------------------------------------------------------------
  ensure(24);
  style("normal", 8.5, MUTED);
  write(t("quotations.for_client"), MARGIN.left, y + 3);
  style("bold", 11);
  write(quotation.client_name, MARGIN.left, y + 9);
  const clientLines = [
    sameText(client?.contact_name, quotation.client_name) ? "" : client?.contact_name,
    client?.address,
    [client?.postal_code, client?.city].filter(Boolean).join(" "),
    client?.country ? countryLabel(client.country, lang) : "",
    client?.email,
    client?.phone,
    client?.tax_id ? `${t("settings.tax_number")}: ${client.tax_id}` : "",
  ]
    .filter(Boolean)
    .flatMap((line) => splitLines(doc, line, CONTENT_WIDTH));
  let clientY = y + 13.5;
  if (clientLines.length) {
    style("normal", 9, MUTED);
    clientLines.forEach((line) => {
      write(line, MARGIN.left, clientY);
      clientY += LINE_HEIGHT;
    });
  }
  y = clientY + 4;

  // --- Subject -------------------------------------------------------------------------------
  if (clean(quotation.subject)) {
    style("bold", 11);
    splitLines(doc, quotation.subject, CONTENT_WIDTH).forEach((line) => {
      ensure(6);
      write(line, MARGIN.left, y + 4);
      y += 5.5;
    });
    y += 2;
  }

  // --- Line items ----------------------------------------------------------------------------
  const drawTableHeader = () => {
    doc.setFillColor(SURFACE[0], SURFACE[1], SURFACE[2]);
    doc.rect(MARGIN.left, y, CONTENT_WIDTH, 7, "F");
    style("bold", 8.5, MUTED);
    write("#", COL.index, y + 4.8);
    write(t("common.description"), COL.descX, y + 4.8);
    right(t("common.quantity"), COL.qtyRight, y + 4.8);
    right(t("common.unit_price"), COL.unitRight, y + 4.8);
    right(t("common.amount"), COL.amountRight, y + 4.8);
    y += 7;
    repeatTableHeader = drawTableHeader;
  };

  const items = Array.isArray(quotation.line_items) ? quotation.line_items : [];
  ensure(items.length ? 20 : 14);
  if (!repeatTableHeader) drawTableHeader();

  if (!items.length) {
    style("normal", 9, MUTED);
    write(t("quotations.no_items"), COL.descX, y + 5);
    y += 9;
  } else {
    items.forEach((item, position) => {
      let remaining = splitLines(doc, item.description, COL.descWidth);
      if (!remaining.length) remaining = [""];
      let first = true;
      while (remaining.length) {
        // At most 48 lines per chunk, which always fits a fresh page once the repeated table
        // header is allowed for, so even a description longer than a page cannot overflow.
        const fit = Math.max(1, Math.min(48, Math.floor((FOOTER_LINE - y - 6) / LINE_HEIGHT)));
        const chunk = remaining.slice(0, fit);
        remaining = remaining.slice(fit);
        const rowHeight = chunk.length * LINE_HEIGHT + 2.6;
        if (y + rowHeight > FOOTER_LINE) pageBreak();
        const baseline = y + 4;
        if (first) {
          style("normal", 9);
          write(String(position + 1), COL.index, baseline);
          right(quantity(item.quantity), COL.qtyRight, baseline);
          right(money(item.unit_price), COL.unitRight, baseline);
          right(
            money(round2((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))),
            COL.amountRight,
            baseline,
          );
        }
        style("normal", 9);
        chunk.forEach((line, lineIndex) => write(line, COL.descX, baseline + lineIndex * LINE_HEIGHT));
        y += rowHeight;
        doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
        doc.setLineWidth(0.15);
        doc.line(MARGIN.left, y, PAGE.width - MARGIN.right, y);
        first = false;
      }
    });
  }

  // --- Totals: stored values only, never recalculated ----------------------------------------
  y += 4;
  ensure(showVat ? 26 : 21, { repeatTableHeader: false });
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
  doc.setLineWidth(0.2);
  doc.line(COL.qtyRight - 26, y, COL.amountRight, y);
  y += 6;
  const totalRow = (label, value, weight, size) => {
    style(weight, size);
    write(label, COL.qtyRight - 26, y);
    right(value, COL.amountRight, y);
    y += 5.8;
  };
  totalRow(t("common.subtotal"), money(quotation.subtotal), "normal", 9.5);
  // The VAT line appears only when a rate was actually configured: a deliberate 0% is shown,
  // while a rate nobody ever entered stays off the document instead of printing as 0%.
  if (showVat) totalRow(`${t("common.tax")} (${vatRate}%)`, money(quotation.tax_amount), "normal", 9.5);
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
  doc.line(COL.qtyRight - 26, y - 3.4, COL.amountRight, y - 3.4);
  y += 2;
  totalRow(t("common.total"), money(quotation.total), "bold", 12);

  // --- Notes ---------------------------------------------------------------------------------
  if (clean(quotation.notes)) {
    const noteLines = splitLines(doc, quotation.notes, CONTENT_WIDTH);
    y += 4;
    ensure(16, { repeatTableHeader: false });
    rule(MARGIN.left, PAGE.width - MARGIN.right);
    y += 5;
    style("bold", 8.5, MUTED);
    write(t("common.notes"), MARGIN.left, y + 3);
    y += 7;
    style("normal", 9, MUTED);
    noteLines.forEach((line) => {
      ensure(6);
      write(line, MARGIN.left, y + 3.5);
      y += LINE_HEIGHT;
    });
  }

  // --- Page numbering, once the page count is known -------------------------------------------
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    style("normal", 8, MUTED);
    write(`${companyName} · ${quotation.number}`, MARGIN.left, PAGE.height - 12);
    right(t("quotations.page_of", { current: page, total: pageCount }), PAGE.width - MARGIN.right, PAGE.height - 12);
  }
  doc.setPage(1);

  doc.setProperties({
    title: `${t("quotations.document_title")} ${quotation.number}`,
    subject: clean(quotation.subject),
    author: companyName,
    creator: t("app.name"),
  });

  return doc;
}