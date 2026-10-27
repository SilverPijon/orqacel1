// Invoice numbering: INV-1001, INV-1002, … per company.
//
// The claim itself lives in numberSequence.server.js, shared with quotation numbering, so both use
// exactly one compare-and-set implementation and neither can drift back to a read-then-write count.
import { claimSequenceNumber } from "@/lib/numberSequence.server";

const PREFIX = "INV";
const FIRST_NUMBER = 1001;
const MIN_WIDTH = 4;

// A company's counter starts here, so its first invoice is INV-1001.
export const INVOICE_COUNTER_START = FIRST_NUMBER - 1;
export const INVOICE_NUMBER_FORMAT = `${PREFIX}-1001, ${PREFIX}-1002, ${PREFIX}-1003 …`;

// Claims the next invoice number for a company, exclusively, or fails without returning one.
export function claimInvoiceNumber(service, companyId) {
  return claimSequenceNumber(service, {
    companyId,
    counterField: "invoice_sequence",
    entityName: "Invoice",
    prefix: PREFIX,
    firstNumber: FIRST_NUMBER,
    minWidth: MIN_WIDTH,
  });
}