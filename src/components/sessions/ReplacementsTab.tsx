import { useState } from 'react';
import { Plus, Trash2, Check } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { cn } from '@/utils/cn';
import { motion, AnimatePresence } from 'framer-motion';

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
  sessionId: string;
  onRulesChange?: (hyperlinkRules: HyperlinkRule[], textRules: TextRule[]) => void;
}

export function ReplacementsTab({ sessionId, onRulesChange }: ReplacementsTabProps) {
  const [replaceHyperlinksEnabled, setReplaceHyperlinksEnabled] = useState(false);
  const [replaceTextEnabled, setReplaceTextEnabled] = useState(false);
  const [hyperlinkRules, setHyperlinkRules] = useState<HyperlinkRule[]>([]);
  const [textRules, setTextRules] = useState<TextRule[]>([]);

  const addHyperlinkRule = () => {
    const newRule: HyperlinkRule = {
      id: `hyperlink-${Date.now()}`,
      enabled: true,
      oldHyperlink: '',
      newContentId: ''
    };
    const updatedRules = [...hyperlinkRules, newRule];
    setHyperlinkRules(updatedRules);
    onRulesChange?.(updatedRules, textRules);
  };

  const updateHyperlinkRule = (id: string, updates: Partial<HyperlinkRule>) => {
    const updatedRules = hyperlinkRules.map(rule =>
      rule.id === id ? { ...rule, ...updates } : rule
    );
    setHyperlinkRules(updatedRules);
    onRulesChange?.(updatedRules, textRules);
  };

  const removeHyperlinkRule = (id: string) => {
    const updatedRules = hyperlinkRules.filter(rule => rule.id !== id);
    setHyperlinkRules(updatedRules);
    onRulesChange?.(updatedRules, textRules);
  };

  const addTextRule = () => {
    const newRule: TextRule = {
      id: `text-${Date.now()}`,
      enabled: true,
      oldText: '',
      newText: ''
    };
    const updatedRules = [...textRules, newRule];
    setTextRules(updatedRules);
    onRulesChange?.(hyperlinkRules, updatedRules);
  };

  const updateTextRule = (id: string, updates: Partial<TextRule>) => {
    const updatedRules = textRules.map(rule =>
      rule.id === id ? { ...rule, ...updates } : rule
    );
    setTextRules(updatedRules);
    onRulesChange?.(hyperlinkRules, updatedRules);
  };

  const removeTextRule = (id: string) => {
    const updatedRules = textRules.filter(rule => rule.id !== id);
    setTextRules(updatedRules);
    onRulesChange?.(hyperlinkRules, updatedRules);
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
                className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
                animate={{ x: replaceHyperlinksEnabled ? 24 : 2 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            </button>
            <div>
              <h3 className="font-medium">Replace Hyperlinks</h3>
              <p className="text-sm text-muted-foreground">Replace hyperlink targets based on rules</p>
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
                  {hyperlinkRules.map((rule, index) => (
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
                              onChange={(e) => updateHyperlinkRule(rule.id, { enabled: e.target.checked })}
                              disabled={!replaceHyperlinksEnabled}
                              className="sr-only"
                            />
                            <div className={cn(
                              'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                              rule.enabled && replaceHyperlinksEnabled
                                ? 'bg-primary border-primary'
                                : 'border-border'
                            )}>
                              {rule.enabled && replaceHyperlinksEnabled && (
                                <Check className="w-3 h-3 text-white" />
                              )}
                            </div>
                          </div>
                        </label>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={rule.oldHyperlink}
                          onChange={(e) => updateHyperlinkRule(rule.id, { oldHyperlink: e.target.value })}
                          disabled={!replaceHyperlinksEnabled}
                          placeholder="Enter old hyperlink text"
                          className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background disabled:opacity-50"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={rule.newContentId}
                          onChange={(e) => updateHyperlinkRule(rule.id, { newContentId: e.target.value })}
                          disabled={!replaceHyperlinksEnabled}
                          placeholder="Enter new content ID"
                          className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background disabled:opacity-50"
                        />
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
                className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
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
                  {textRules.map((rule, index) => (
                    <motion.tr
                      key={rule.id}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className={cn(
                        'border-t border-border',
                        !replaceTextEnabled && 'opacity-50'
                      )}
                    >
                      <td className="px-4 py-3">
                        <label className="flex items-center cursor-pointer">
                          <div className="relative">
                            <input
                              type="checkbox"
                              checked={rule.enabled}
                              onChange={(e) => updateTextRule(rule.id, { enabled: e.target.checked })}
                              disabled={!replaceTextEnabled}
                              className="sr-only"
                            />
                            <div className={cn(
                              'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                              rule.enabled && replaceTextEnabled
                                ? 'bg-primary border-primary'
                                : 'border-border'
                            )}>
                              {rule.enabled && replaceTextEnabled && (
                                <Check className="w-3 h-3 text-white" />
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
                          className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background disabled:opacity-50"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={rule.newText}
                          onChange={(e) => updateTextRule(rule.id, { newText: e.target.value })}
                          disabled={!replaceTextEnabled}
                          placeholder="Enter new text"
                          className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background disabled:opacity-50"
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