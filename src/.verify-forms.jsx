import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FormField, { fieldErrorProps } from "@/components/FormField";
import {
  CLIENT_REQUIRED_FIELDS,
  JOB_REQUIRED_FIELDS,
  firstInvalidField,
  validateClientForm,
  validateJobForm,
} from "@/lib/formValidation";

const t = (key) => `T:${key}`;
const emptyClient = validateClientForm({ name: "   " }, t);
const emptyJob = validateJobForm({ title: "" }, t);
const err = emptyClient.name;

const withError = renderToStaticMarkup(
  React.createElement(
    FormField,
    { id: "client-name", label: "Name", error: err, required: true },
    React.createElement("input", { id: "client-name", ...fieldErrorProps("client-name", err) }),
  ),
);
const withoutError = renderToStaticMarkup(
  React.createElement(
    FormField,
    { id: "job-title", label: "Job title", required: true },
    React.createElement("input", { id: "job-title", ...fieldErrorProps("job-title", undefined) }),
  ),
);

console.log(
  JSON.stringify(
    {
      clientEmpty: emptyClient,
      clientValid: validateClientForm({ name: "Acme OÜ" }, t),
      jobEmpty: emptyJob,
      jobValid: validateJobForm({ title: "Fix roof" }, t),
      firstClient: firstInvalidField(emptyClient, CLIENT_REQUIRED_FIELDS),
      firstJob: firstInvalidField(emptyJob, JOB_REQUIRED_FIELDS),
      firstWhenValid: firstInvalidField({}, JOB_REQUIRED_FIELDS),
      propsWithError: fieldErrorProps("client-name", err),
      propsWithoutError: fieldErrorProps("job-title", undefined),
      htmlWithError: withError,
      htmlWithoutError: withoutError,
    },
    null,
    1,
  ),
);