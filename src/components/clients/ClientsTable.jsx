import React from "react";
import { Link } from "@tanstack/react-router";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import StatusBadge from "@/components/StatusBadge";
import { CLIENT_STATUS } from "@/lib/statusMeta";
import { useI18n } from "@/lib/i18n/I18nContext";

export default function ClientsTable({ clients, onEdit, onDelete, canDelete }) {
  const { t } = useI18n();

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("common.name")}</TableHead>
            <TableHead className="hidden md:table-cell">{t("clients.contact_name")}</TableHead>
            <TableHead className="hidden lg:table-cell">{t("common.phone")}</TableHead>
            <TableHead className="hidden sm:table-cell">{t("common.status")}</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((client) => (
            <TableRow key={client.id}>
              <TableCell className="font-medium">
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: client.id }}
                  className="hover:text-primary hover:underline"
                >
                  {client.name}
                </Link>
                <span className="block text-xs text-muted-foreground md:hidden">
                  {client.contact_name || client.email || ""}
                </span>
              </TableCell>
              <TableCell className="hidden md:table-cell text-muted-foreground">
                {client.contact_name || "—"}
              </TableCell>
              <TableCell className="hidden lg:table-cell text-muted-foreground">{client.phone || "—"}</TableCell>
              <TableCell className="hidden sm:table-cell">
                <StatusBadge
                  label={t(CLIENT_STATUS[client.status]?.key || "clients.active")}
                  tone={CLIENT_STATUS[client.status]?.tone}
                />
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("common.actions")}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(client)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      {t("common.edit")}
                    </DropdownMenuItem>
                    {canDelete ? (
                      <DropdownMenuItem
                        onClick={() => onDelete(client)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t("common.delete")}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}