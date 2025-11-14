import { useState, useEffect } from 'react';
import { Plus, Trash2, Check } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { cn } from '@/utils/cn';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from '@/contexts/SessionContext';
import { ReplacementRule } from '@/types/session';
import { validateUrlScheme } from '@/utils/urlHelpers';

interface HyperlinkRule {
  id: string;
  enabled: boolean;
  oldHyperlink: string;
  newContentId: string;
}

interface TextRule {
  id: string;
  enabled: boolean;
  oldText: string;
  newText: string;
}

interface ReplacementsTabProps {
  sessionId?: string;
}

export function ReplacementsTab({ sessionId }: ReplacementsTabProps) {
  const { sessions, updateSessionReplacements } = useSession();
  const [replaceHyperlinksEnabled, setReplaceHyperlinksEnabled] = useState(false);
  const [replaceTextEnabled, setReplaceTextEnabled] = useState(false);
  const [hyperlinkRules, setHyperlinkRules] = useState<HyperlinkRule[]>([]);
  const [textRules, setTextRules] = useState<TextRule[]>([]);
  // SECURITY: Track URL validation errors for user feedback
  const [urlValidationErrors, setUrlValidationErrors] = useState<Record<string, string>>({});

  // Load existing replacements from session on mount
  useEffect(() => {
    if (!sessionId) return;

    const session = sessions.find((s) => s.id === sessionId);
    if (session?.replacements) {
      // Convert ReplacementRule[] to HyperlinkRule[] and TextRule[]
      const hyperlinks: HyperlinkRule[] = [];
      const texts: TextRule[] = [];

      session.replacements.forEach((rule) => {
        if (rule.type === 'hyperlink') {
          hyperlinks.push({
            id: rule.id,
            enabled: rule.enabled,
            oldHyperlink: rule.pattern,
            newContentId: rule.replacement,
          });
        } else if (rule.type === 'text') {
          texts.push({
            id: rule.id,
            enabled: rule.enabled,
            oldText: rule.pattern,
            newText: rule.replacement,
          });
        }
      });

      setHyperlinkRules(hyperlinks);
      setTextRules(texts);
      setReplaceHyperlinksEnabled(hyperlinks.some((r) => r.enabled));
      setReplaceTextEnabled(texts.some((r) => r.enabled));
    }
  }, [sessionId, sessions]);

  // Save changes to session whenever rules change
  const saveRulesToSession = (hyperlinks: HyperlinkRule[], texts: TextRule[]) => {
    if (!sessionId) return;

    // Convert back to ReplacementRule[]
    const replacements: ReplacementRule[] = [
      ...hyperlinks.map((h) => ({
        id: h.id,
        enabled: h.enabled,
        type: 'hyperlink' as const,
        pattern: h.oldHyperlink,
        replacement: h.newContentId,
      })),
      ...texts.map((t) => ({
        id: t.id,
        enabled: t.enabled,
        type: 'text' as const,
        pattern: t.oldText,
        replacement: t.newText,
      })),
    ];

    updateSessionReplacements(sessionId, replacements);
  };

  const addHyperlinkRule = () => {
    const newRule: HyperlinkRule = {
      id: `hyperlink-${Date.now()}`,
      enabled: true,
      oldHyperlink: '',
      newContentId: '',
    };
    const updatedRules = [...hyperlinkRules, newRule];
    setHyperlinkRules(updatedRules);
    saveRulesToSession(updatedRules, textRules);
  };

  const updateHyperlinkRule = (id: string, updates: Partial<HyperlinkRule>) => {
    // SECURITY FIX: Validate URL scheme for newContentId to prevent XSS-like attacks
    if (updates.newContentId !== undefined) {
      const validation = validateUrlScheme(updates.newContentId);

      if (!validation.valid) {
        // Store validation error to show to user
        setUrlValidationErrors((prev) => ({
          ...prev,
          [id]: validation.error || 'Invalid URL',
        }));

        // Still update the field value (for user to see and correct)
        // but don't save to session until valid
        const updatedRules = hyperlinkRules.map((rule) =>
          rule.id === id ? { ...rule, ...updates } : rule
        );
        setHyperlinkRules(updatedRules);
        return; // Don't save to session with invalid URL
      } else {
        // Clear any previous validation error for this field
        setUrlValidationErrors((prev) => {
          const newErrors = { ...prev };
          delete newErrors[id];
          return newErrors;
        });
      }
    }

    // If validation passed or update doesn't include newContentId, proceed normally
    const updatedRules = hyperlinkRules.map((rule) =>
      rule.id === id ? { ...rule, ...updates } : rule
    );
    setHyperlinkRules(updatedRules);
    saveRulesToSession(updatedRules, textRules);
  };

  const removeHyperlinkRule = (id: string) => {
    const updatedRules = hyperlinkRules.filter((rule) => rule.id !== id);
    setHyperlinkRules(updatedRules);
    saveRulesToSession(updatedRules, textRules);
  };

  const addTextRule = () => {
    const newRule: TextRule = {
      id: `text-${Date.now()}`,
      enabled: true,
      oldText: '',
      newText: '',
    };
    const updatedRules = [...textRules, newRule];
    setTextRules(updatedRules);
    saveRulesToSession(hyperlinkRules, updatedRules);
  };

  const updateTextRule = (id: string, updates: Partial<TextRule>) => {
    const updatedRules = textRules.map((rule) => (rule.id === id ? { ...rule, ...updates } : rule));
    setTextRules(updatedRules);
    saveRulesToSession(hyperlinkRules, updatedRules);
  };

  const removeTextRule = (id: string) => {
    const updatedRules = textRules.filter((rule) => rule.id !== id);
    setTextRules(updatedRules);
    saveRulesToSession(hyperlinkRules, updatedRules);
  };

  return (
    <div className="space-y-6">
      {/* Hyperlink Replacements */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setReplaceHyperlinksEnabled(!replaceHyperlinksEnabled)}
              className={cn(
                'relative w-12 h-6 rounded-full transition-colors',
                replaceHyperlinksEnabled ? 'bg-primary' : 'bg-muted'
              )}
            >
              <motion.div
                className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-xs"
                animate={{ x: replaceHyperlinksEnabled ? 24 : 2 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            </button>
            <div>
              <h3 className="font-medium">Replace Hyperlinks</h3>
              <p className="text-sm text-muted-foreground">
                Replace hyperlink targets based on rules
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            icon={<Plus className="w-4 h-4" />}
            onClick={addHyperlinkRule}
            disabled={!replaceHyperlinksEnabled}
          >
            Add Rule
          </Button>
        </div>

        {hyperlinkRules.length > 0 && (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium w-12">Enable</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Old Hyperlink Text</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">New Content ID</th>
                  <th className="px-4 py-3 text-left text-sm font-medium w-12"></th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {hyperlinkRules.map((rule) => (
                    <motion.tr
                      key={rule.id}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className={cn(
                        'border-t border-border',
                        !replaceHyperlinksEnabled && 'opacity-50'
                      )}
                    >
                      <td className="px-4 py-3">
                        <label className="flex items-center cursor-pointer">
                          <div className="relative">
                            <input
                              type="checkbox"
                              checked={rule.enabled}
                              onChange={(e) =>
                                updateHyperlinkRule(rule.id, { enabled: e.target.checked })
                              }
                              disabled={!replaceHyperlinksEnabled}
                              className="sr-only"
                            />
                            <div
                              className={cn(
                                'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                                rule.enabled && replaceHyperlinksEnabled
                                  ? 'bg-primary border-primary checkbox-checked'
                                  : 'border-border'
                              )}
                            >
                              {rule.enabled && replaceHyperlinksEnabled && (
                                <Check className="w-3 h-3 text-white checkbox-checkmark" />
                              )}
                            </div>
                          </div>
                        </label>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={rule.oldHyperlink}
                          onChange={(e) =>
                            updateHyperlinkRule(rule.id, { oldHyperlink: e.target.value })
                          }
                          disabled={!replaceHyperlinksEnabled}
                          placeholder="Enter old hyperlink text"
                          className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-muted/30 focus:bg-background transition-colors disabled:opacity-50"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <input
                            type="text"
                            value={rule.newContentId}
                            onChange={(e) =>
                              updateHyperlinkRule(rule.id, { newContentId: e.target.value })
                            }
                            disabled={!replaceHyperlinksEnabled}
                            placeholder="Enter new content ID"
                            className={cn(
                              'w-full px-3 py-1.5 text-sm border rounded-md bg-muted/30 focus:bg-background transition-colors disabled:opacity-50',
                              urlValidationErrors[rule.id]
                                ? 'border-red-500 focus:border-red-500'
                                : 'border-border'
                            )}
                          />
                          {urlValidationErrors[rule.id] && (
                            <p className="text-xs text-red-500 mt-1">
                              {urlValidationErrors[rule.id]}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => removeHyperlinkRule(rule.id)}
                          disabled={!replaceHyperlinksEnabled}
                          className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Text Replacements */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setReplaceTextEnabled(!replaceTextEnabled)}
              className={cn(
                'relative w-12 h-6 rounded-full transition-colors',
                replaceTextEnabled ? 'bg-primary' : 'bg-muted'
              )}
            >
              <motion.div
                className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-xs"
                animate={{ x: replaceTextEnabled ? 24 : 2 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            </button>
            <div>
              <h3 className="font-medium">Replace Text</h3>
              <p className="text-sm text-muted-foreground">Replace text content based on rules</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            icon={<Plus className="w-4 h-4" />}
            onClick={addTextRule}
            disabled={!replaceTextEnabled}
          >
            Add Rule
          </Button>
        </div>

        {textRules.length > 0 && (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium w-12">Enable</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Old Text</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">New Text</th>
                  <th className="px-4 py-3 text-left text-sm font-medium w-12"></th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {textRules.map((rule) => (
                    <motion.tr
                      key={rule.id}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className={cn('border-t border-border', !replaceTextEnabled && 'opacity-50')}
                    >
                      <td className="px-4 py-3">
                        <label className="flex items-center cursor-pointer">
                          <div className="relative">
                            <input
                              type="checkbox"
                              checked={rule.enabled}
                              onChange={(e) =>
                                updateTextRule(rule.id, { enabled: e.target.checked })
                              }
                              disabled={!replaceTextEnabled}
                              className="sr-only"
                            />
                            <div
                              className={cn(
                                'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                                rule.enabled && replaceTextEnabled
                                  ? 'bg-primary border-primary checkbox-checked'
                                  : 'border-border'
                              )}
                            >
                              {rule.enabled && replaceTextEnabled && (
                                <Check className="w-3 h-3 text-white checkbox-checkmark" />
                              )}
                            </div>
                          </div>
                        </label>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={rule.oldText}
                          onChange={(e) => updateTextRule(rule.id, { oldText: e.target.value })}
                          disabled={!replaceTextEnabled}
                          placeholder="Enter old text"
                          className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-muted/30 focus:bg-background transition-colors disabled:opacity-50"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={rule.newText}
                          onChange={(e) => updateTextRule(rule.id, { newText: e.target.value })}
                          disabled={!replaceTextEnabled}
                          placeholder="Enter new text"
                          className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-muted/30 focus:bg-background transition-colors disabled:opacity-50"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => removeTextRule(rule.id)}
                          disabled={!replaceTextEnabled}
                          className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
