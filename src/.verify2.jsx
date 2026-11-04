import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import JobFormDialog from "@/components/jobs/JobFormDialog";
import ClientFormDialog from "@/components/clients/ClientFormDialog";
import FormField from "@/components/FormField";

const qc = new QueryClient();
const wrap = (el) => renderToStaticMarkup(React.createElement(QueryClientProvider, { client: qc }, el));

const cases = [
  ["job create", wrap(React.createElement(JobFormDialog, { open: true, onOpenChange: () => {}, job: null })), "job-title"],
  [
    "job edit",
    wrap(
      React.createElement(JobFormDialog, {
        open: true,
        onOpenChange: () => {},
        job: { id: "j1", revision: 3, title: "Roof repair", status: "scheduled", price: 100 },
      }),
    ),
    "job-title",
  ],
  ["client create", wrap(React.createElement(ClientFormDialog, { open: true, onOpenChange: () => {}, client: null })), "client-name"],
  [
    "client edit",
    wrap(
      React.createElement(ClientFormDialog, {
        open: true,
        onOpenChange: () => {},
        client: { id: "c1", name: "Acme OÜ", status: "active" },
      }),
    ),
    "client-name",
  ],
];

let failures = 0;
for (const [name, html, id] of cases) {
  const label = html.match(new RegExp(`<label[^>]*for="${id}"[\\s\\S]{0,240}?</label>`));
  const markup = label ? label[0] : "";
  const hasMarker = /class="ml-1 font-bold text-destructive"/.test(markup);
  const hasRequiredFlag = /data-required="true"/.test(markup);
  const controlRequired = new RegExp(`id="${id}"[^>]*aria-required="true"`).test(html);
  const ok = hasMarker && hasRequiredFlag && controlRequired;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(14)} marker=${hasMarker} labelFlag=${hasRequiredFlag} controlAriaRequired=${controlRequired}`);
  if (!ok) console.log("      markup:", markup || "(label not rendered)");
}

// An optional field must never gain a marker.
const optional = renderToStaticMarkup(
  React.createElement(
    FormField,
    { id: "opt", label: "Optional field" },
    React.createElement("input", { id: "opt" }),
  ),
);
const optionalClean = !/text-destructive/.test(optional) && !/data-required/.test(optional);
if (!optionalClean) failures += 1;
console.log(`${optionalClean ? "PASS" : "FAIL"}  optional field has no marker`);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);