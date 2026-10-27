// Quotation numbering: QT-1001, QT-1002, … per company.
//
// Same claim as invoices (numberSequence.server.js), so two quotations created at the same moment can
// never receive the same number, and a number is never reused or handed out twice.
import { claimSequenceNumber } from "@/lib/numberSequence.server";

const PREFIX = "QT";
const FIRST_NUMBER = 1001;
const MIN_WIDTH = 4;

// A company's counter starts here, so its first quotation is QT-1001.
export const QUOTATION_COUNTER_START = FIRST_NUMBER - 1;

// Claims the next quotation number for a company, exclusively, or fails without returning one.
export function claimQuotationNumber(service, companyId) {
  return claimSequenceNumber(service, {
    companyId,
    counterField: "quotation_sequence",
    entityName: "Quotation",
    prefix: PREFIX,
    firstNumber: FIRST_NUMBER,
    minWidth: MIN_WIDTH,
  });
}