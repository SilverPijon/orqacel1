// One place for the required fields of the Client and Job forms. These are exactly the rules the
// dialogs already enforced on submit, and the same ones the server schemas enforce: a client needs
// a name, a job needs a title. Nothing here adds a requirement — the dialogs read this list to mark
// fields as required and to build their messages, so marker, rule and message cannot drift apart.

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

// Which field to focus after a failed submit: the first required field in the order the form shows
// them, so the user lands at the top of the problem rather than at the bottom.
export function firstInvalidField(errors, order) {
  return order.find((field) => errors[field]) || null;
}