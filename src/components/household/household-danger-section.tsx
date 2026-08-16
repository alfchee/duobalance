"use client";

import { Download, AlertTriangle, LogOut, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHousehold } from "@/hooks/useHousehold";
import { useHouseholdMembers } from "@/hooks/useHouseholdMembers";
import { useHouseholdCommands } from "@/hooks/useHouseholdCommands";
import { downloadFilename } from "@/components/household/export-section";
import { apiFetch } from "@/lib/api-fetch";

type ExportFormat = "json" | "csv";

export function HouseholdDangerSection() {
  const t = useTranslations("settings.actions");
  const tErrors = useTranslations("settings.actions.errors");
  const { householdId, householdName, role } = useHousehold();
  const members = useHouseholdMembers(householdId);
  const { removeHousehold, leave } = useHouseholdCommands();

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [typedName, setTypedName] = useState("");
  const [exportPending, setExportPending] = useState<ExportFormat | null>(null);
  const [exportError, setExportError] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const isOwner = role === "owner";
  const activeMembers = members.data ?? [];
  const activeCount = members.data ? activeMembers.length : 1;
  const isOwnerWithOthers = isOwner && (members.isPending || activeCount > 1);

  async function downloadExport(format: ExportFormat) {
    if (!householdId) return;
    setExportPending(format);
    setExportError(false);
    try {
      const blob = await apiFetch<Blob>(`/api/export?format=${format}&householdId=${householdId}`, {
        responseType: "blob",
      });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = downloadFilename(householdName ?? "household", format);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
    } catch {
      setExportError(true);
    } finally {
      setExportPending(null);
    }
  }

  async function handleConfirmLeave() {
    if (!householdId) return;
    setActionError(null);
    setIsPending(true);
    try {
      const res = await leave(householdId);
      if (!res.ok) {
        setActionError(res.errorKey);
      } else {
        setLeaveOpen(false);
      }
    } catch {
      setActionError("generic");
    } finally {
      setIsPending(false);
    }
  }

  async function handleConfirmDelete() {
    if (!householdId) return;
    if (typedName.trim() !== (householdName ?? "").trim()) return;
    setActionError(null);
    setIsPending(true);
    try {
      const res = await removeHousehold(householdId);
      if (!res.ok) {
        setActionError(res.errorKey);
      } else {
        setDeleteOpen(false);
      }
    } catch {
      setActionError("generic");
    } finally {
      setIsPending(false);
    }
  }

  function handleOpenDelete() {
    setTypedName("");
    setActionError(null);
    setExportError(false);
    setDeleteOpen(true);
  }

  function handleOpenLeave() {
    setActionError(null);
    setLeaveOpen(true);
  }

  return (
    <section className="space-y-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
      <div>
        <h2 className="text-sm font-semibold text-destructive">{t("title")}</h2>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{t("leave.title")}</p>
          <p className="text-xs text-muted-foreground">{t("leave.description")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={handleOpenLeave}
        >
          <LogOut aria-hidden className="size-4" />
          {t("leave.button")}
        </Button>
      </div>

      {isOwner ? (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-destructive/10 pt-4">
          <div>
            <p className="text-sm font-medium text-destructive">{t("delete.title")}</p>
            <p className="text-xs text-muted-foreground">{t("delete.description")}</p>
          </div>
          <Button variant="destructive" size="sm" onClick={handleOpenDelete}>
            <Trash2 aria-hidden className="size-4" />
            {t("delete.button")}
          </Button>
        </div>
      ) : null}

      {/* Leave Household Modal */}
      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <AlertTriangle className="size-5 text-amber-500" />
              {t("leave.dialogTitle")}
            </DialogTitle>
            <DialogDescription className="text-sm">
              {isOwnerWithOthers
                ? t("leave.ownerNotice")
                : activeCount === 1
                  ? t("leave.lastMemberNotice")
                  : t("leave.partnerNotice", { name: householdName ?? "" })}
            </DialogDescription>
          </DialogHeader>

          {actionError ? (
            <p role="alert" className="text-sm text-destructive">
              {tErrors(actionError)}
            </p>
          ) : null}

          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setLeaveOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            {!isOwnerWithOthers ? (
              <Button variant="destructive" onClick={handleConfirmLeave} disabled={isPending}>
                {isPending ? t("leave.leaving") : t("leave.confirmButton")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Household Modal */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-destructive">
              <Trash2 className="size-5" />
              {t("delete.dialogTitle", { name: householdName ?? "" })}
            </DialogTitle>
            <DialogDescription className="text-sm">
              {t("delete.recoverableNotice")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-lg border bg-muted/50 p-3 text-xs space-y-2">
              <p className="font-medium">{t("delete.exportFirst")}</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={exportPending !== null}
                  onClick={() => void downloadExport("csv")}
                >
                  <Download className="size-3" aria-hidden />
                  {exportPending === "csv" ? "Exporting…" : t("delete.exportCsv")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={exportPending !== null}
                  onClick={() => void downloadExport("json")}
                >
                  <Download className="size-3" aria-hidden />
                  {exportPending === "json" ? "Exporting…" : t("delete.exportJson")}
                </Button>
              </div>
              {exportError ? (
                <p role="alert" className="text-destructive">
                  {tErrors("exportFailed")}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="delete-confirm-input" className="text-xs font-medium">
                {t("delete.confirmPrompt", { name: householdName ?? "" })}
              </Label>
              <Input
                id="delete-confirm-input"
                type="text"
                placeholder={t("delete.confirmPlaceholder")}
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                autoComplete="off"
              />
            </div>

            {actionError ? (
              <p role="alert" className="text-sm text-destructive">
                {tErrors(actionError)}
              </p>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isPending || typedName.trim() !== (householdName ?? "").trim()}
            >
              {isPending ? t("delete.deleting") : t("delete.confirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
