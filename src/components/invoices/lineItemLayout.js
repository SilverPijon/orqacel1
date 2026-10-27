// The six columns of an invoice line: description, quantity, unit price, VAT %, the calculated line
// total and the row's own delete action.
//
// The header row and every line row share this one template, so each heading sits exactly above the
// field it describes, and a line reads as one grid row from lg upwards.
export const LINE_COLUMNS =
  "lg:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_6rem_7.5rem_2.25rem]";

// Below lg the same six fields stack into a compact card instead of a table row.
export const LINE_ROW_CLASS =
  `grid gap-3 rounded-xl border border-border bg-card p-3 lg:items-center lg:gap-3 lg:rounded-none lg:border-0 lg:bg-transparent lg:px-0 lg:py-3 ${LINE_COLUMNS}`;