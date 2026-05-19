import { Save, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/common/Button";
import { cn } from "@/utils/cn";
import type { QuickLink } from "@/types/settings";

interface QuickLinksEditorProps {
  /** Section heading shown at the top of the panel. */
  title: string;
  /** Short description of what the section does. */
  description: string;
  /** Current (unsaved) edit state of the rows. */
  links: QuickLink[];
  /** Called whenever the row list changes (add / remove / edit / reorder). */
  onChange: (links: QuickLink[]) => void;
  /** Called when the Save button is clicked. */
  onSave: () => void;
  /** Drives the Button success animation, mirrors existing Settings sections. */
  saveSuccess: boolean;
  /** Per-row validation messages keyed by link id; shown under the URL field. */
  errors?: Record<string, string>;
}

/**
 * Reusable editor for a list of named hyperlinks ("URL Name" + "Hyperlink").
 * Instantiated once per feature (Feedback, Document Managers). Rows can be
 * added, removed, edited and reordered; the parent owns persistence.
 */
export function QuickLinksEditor({
  title,
  description,
  links,
  onChange,
  onSave,
  saveSuccess,
  errors,
}: QuickLinksEditorProps) {
  const updateRow = (index: number, patch: Partial<QuickLink>) => {
    onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  };

  const addRow = () => {
    onChange([...links, { id: crypto.randomUUID(), name: "", url: "" }]);
  };

  const removeRow = (index: number) => {
    onChange(links.filter((_, i) => i !== index));
  };

  const moveRow = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= links.length) return;
    const next = [...links];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{title}</h2>
        <p className="text-muted-foreground mt-1">{description}</p>
      </div>

      <div className="space-y-4">
        {links.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No links added yet. Use the button below to add your first link.
          </p>
        )}

        {links.map((link, index) => (
          <div
            key={link.id}
            className="flex items-end gap-3 p-3 rounded-lg border border-border bg-muted/10"
          >
            <div className="flex-1">
              <label
                htmlFor={`quicklink-name-${link.id}`}
                className="block text-sm font-medium mb-2"
              >
                URL Name
              </label>
              <input
                id={`quicklink-name-${link.id}`}
                type="text"
                value={link.name}
                onChange={(e) => updateRow(index, { name: e.target.value })}
                placeholder="Display name"
                className="w-full px-3 py-2 rounded-md border border-input bg-background focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div className="flex-1">
              <label
                htmlFor={`quicklink-url-${link.id}`}
                className="block text-sm font-medium mb-2"
              >
                Hyperlink
              </label>
              <input
                id={`quicklink-url-${link.id}`}
                type="url"
                value={link.url}
                onChange={(e) => updateRow(index, { url: e.target.value })}
                placeholder="https://www.example.com"
                aria-invalid={errors?.[link.id] ? true : undefined}
                aria-describedby={
                  errors?.[link.id] ? `quicklink-url-error-${link.id}` : undefined
                }
                className={cn(
                  "w-full px-3 py-2 rounded-md border bg-background focus:outline-none focus:ring-1",
                  errors?.[link.id]
                    ? "border-destructive focus:border-destructive focus:ring-destructive/20"
                    : "border-input focus:border-primary focus:ring-primary/20"
                )}
              />
              {errors?.[link.id] && (
                <p
                  id={`quicklink-url-error-${link.id}`}
                  role="alert"
                  className="text-xs text-destructive mt-1"
                >
                  {errors[link.id]}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 pb-0.5">
              <button
                type="button"
                onClick={() => moveRow(index, -1)}
                disabled={index === 0}
                aria-label="Move link up"
                className={cn(
                  "p-2 rounded-md text-muted-foreground transition-colors",
                  "hover:bg-muted hover:text-foreground",
                  "disabled:opacity-30 disabled:pointer-events-none"
                )}
              >
                <ArrowUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => moveRow(index, 1)}
                disabled={index === links.length - 1}
                aria-label="Move link down"
                className={cn(
                  "p-2 rounded-md text-muted-foreground transition-colors",
                  "hover:bg-muted hover:text-foreground",
                  "disabled:opacity-30 disabled:pointer-events-none"
                )}
              >
                <ArrowDown className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => removeRow(index)}
                aria-label="Remove link"
                className="p-2 rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}

        <Button variant="outline" onClick={addRow} icon={<Plus className="w-4 h-4" />}>
          Add Link
        </Button>

        <div className="flex justify-end pt-4 border-t border-border">
          <Button onClick={onSave} showSuccess={saveSuccess} icon={<Save className="w-4 h-4" />}>
            Save Settings
          </Button>
        </div>
      </div>
    </div>
  );
}
