import { Plus, Trash2 } from "lucide-react";
import type { DevKeyValue } from "@/types/settings";
import { newKeyValueRow } from "@/utils/devHttp";

interface KeyValueEditorProps {
  label: string;
  rows: DevKeyValue[];
  onChange: (rows: DevKeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

/**
 * Editable list of enable/key/value rows, used for both request headers and
 * query params. Emits the full new array on every change so the parent can
 * persist it. A disabled row is kept but excluded when the request is built.
 */
export function KeyValueEditor({
  label,
  rows,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
}: KeyValueEditorProps) {
  const update = (id: string, patch: Partial<DevKeyValue>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const remove = (id: string) => onChange(rows.filter((row) => row.id !== id));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <button
          type="button"
          onClick={() => onChange([...rows, newKeyValueRow()])}
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">None.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(e) => update(row.id, { enabled: e.target.checked })}
                aria-label="Enable row"
                className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
              />
              <input
                type="text"
                value={row.key}
                onChange={(e) => update(row.id, { key: e.target.value })}
                placeholder={keyPlaceholder}
                spellCheck={false}
                className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-input bg-background text-sm font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
              <input
                type="text"
                value={row.value}
                onChange={(e) => update(row.id, { value: e.target.value })}
                placeholder={valuePlaceholder}
                spellCheck={false}
                className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-input bg-background text-sm font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
              <button
                type="button"
                onClick={() => remove(row.id)}
                aria-label="Remove row"
                className="p-1.5 shrink-0 text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
