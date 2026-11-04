// One place for the required fields of the forms the app edits in place. These are exactly the rules
// each form already enforced on submit, and the same ones the server enforces: a client needs a name,
// a job a title, a quotation and an invoice a customer, a company its name, an invitation an email
// address. Nothing here adds a requirement — every form reads these lists to mark fields as required
// and to build its messages, so marker, rule and message cannot drift apart.

const isBlank = (value) => !String(value ?? "").trim();

export const CLIENT_REQUIRED_FIELDS = ["name"];
export const JOB_REQUIRED_FIELDS = ["title"];

export function validateClientForm(form, t) {
  const errors = {};
  if (isBlank(form.name)) errors.name = t("common.required");
  return errors;
}

export function validateJobForm(form, t) {
  const errors = {};
  if (isBlank(form.title)) errors.title = t("common.required");
  return errors;
}

// A quotation and an invoice need a customer: the server refuses to write one without a client that
// belongs to the company, so the form already blocked submission on this field and said so in a toast.
export const QUOTATION_REQUIRED_FIELDS = ["client_id"];
export const INVOICE_REQUIRED_FIELDS = ["client_id"];

export function validateQuotationForm(form, t) {
  const errors = {};
  if (isBlank(form.client_id)) errors.client_id = t("quotations.select_client");
  return errors;
}

export function validateInvoiceForm(form, t) {
  const errors = {};
  if (isBlank(form.client_id)) errors.client_id = t("invoices.select_customer");
  return errors;
}

// The company name is required by the entity schema and was the one field the profile form refused
// to save empty.
export const COMPANY_PROFILE_REQUIRED_FIELDS = ["name"];

export function validateCompanyProfileForm(form, t) {
  const errors = {};
  if (isBlank(form.name)) errors.name = t("common.required");
  return errors;
}

// An invitation needs an address, and a usable one: the same shape the invite endpoint validates
// before it stores anything. The form used to leave both checks to the browser's own bubble.
export const INVITE_REQUIRED_FIELDS = ["email"];

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateInviteForm(form, t) {
  const errors = {};
  if (isBlank(form.email)) errors.email = t("common.required");
  else if (!EMAIL_SHAPE.test(String(form.email).trim())) errors.email = t("auth.email_invalid");
  return errors;
}

// Which field to focus after a failed submit: the first required field in the order the form shows
// them, so the user lands at the top of the problem rather than at the bottom.
export function firstInvalidField(errors, order) {
  return order.find((field) => errors[field]) || null;
}