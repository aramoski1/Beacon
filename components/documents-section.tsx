"use client";

import { useRef, useState, useTransition } from "react";
import { FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { uploadDocumentAction, deleteDocumentAction, fetchDocuments } from "@/app/documents/actions";
import type { DocumentEntityType, DocumentWithUrl } from "@/lib/documents";
import { ConfirmDialog } from "@/components/confirm-dialog";

function formatBytes(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function DocumentsSection({
  entityType,
  entityId,
  initialDocuments,
}: {
  entityType: DocumentEntityType;
  entityId: string;
  initialDocuments: DocumentWithUrl[];
}) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DocumentWithUrl | null>(null);
  const [, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    startTransition(async () => {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const result = await uploadDocumentAction(entityType, entityId, fd);
        if (result.error) setError(result.error);
      }
      setDocuments(await fetchDocuments(entityType, entityId));
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function handleDeleteRequest(doc: DocumentWithUrl) {
    setPendingDelete(doc);
  }

  function handleDeleteCancel() {
    setPendingDelete(null);
  }

  function handleDeleteConfirm() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    setDeletingId(id);
    setError(null);
    startTransition(async () => {
      const result = await deleteDocumentAction(id);
      setDeletingId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Paperclip className="size-4" />
          Documents
          {documents.length > 0 && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">({documents.length})</span>
          )}
        </CardTitle>
        <div>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="sr-only"
            onChange={handleFilesSelected}
            disabled={uploading}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="h-7 text-xs px-3"
          >
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            Upload
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
        ) : (
          <div className="space-y-1.5">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <div className="min-w-0 flex items-center gap-2">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    {doc.url ? (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium truncate block hover:underline underline-offset-2"
                      >
                        {doc.file_name}
                      </a>
                    ) : (
                      <span className="text-sm font-medium truncate block">{doc.file_name}</span>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {[formatBytes(doc.size_bytes), formatDate(doc.created_at)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteRequest(doc)}
                  disabled={deletingId === doc.id}
                  className="shrink-0 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                  title="Delete file"
                >
                  {deletingId === doc.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {pendingDelete && (
        <ConfirmDialog
          title="Delete file"
          message={`Delete "${pendingDelete.file_name}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onCancel={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </Card>
  );
}
