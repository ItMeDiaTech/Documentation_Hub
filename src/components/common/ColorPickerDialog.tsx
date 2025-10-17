import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Palette, Pipette } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/utils/cn';

interface ColorPickerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  color: string;
  onColorChange: (color: string) => void;
  title?: string;
}

export function ColorPickerDialog({
  isOpen,
  onClose,
  color,
  onColorChange,
  title = 'Pick a Color'
}: ColorPickerDialogProps) {
  const [tempColor, setTempColor] = useState(color);

  useEffect(() => {
    if (isOpen) {
      setTempColor(color);
    }
  }, [isOpen, color]);

  const handleConfirm = () => {
    onColorChange(tempColor);
    onClose();
  };

  const handleCancel = () => {
    setTempColor(color); // Reset to original
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50"
            onClick={handleCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-80 bg-background border border-border rounded-xl shadow-2xl"
          >
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-semibold">{title}</h3>
              <button
                onClick={handleCancel}
                className="p-1 rounded-md hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-3">
                <div className="w-full h-32 rounded-lg border border-border relative overflow-hidden group cursor-pointer">
                  <div
                    className="absolute inset-0 transition-all"
                    style={{ backgroundColor: tempColor }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                    <div className="bg-white/90 px-3 py-1.5 rounded-full flex items-center gap-2 text-sm font-medium">
                      <Pipette className="w-4 h-4" />
                      Click to pick color
                    </div>
                  </div>
                  <input
                    type="color"
                    value={tempColor}
                    onChange={(e) => setTempColor(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </div>

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Palette className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={tempColor}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (/^#[0-9A-Fa-f]{0,6}$/.test(value)) {
                          setTempColor(value);
                        }
                      }}
                      className="w-full pl-10 pr-3 py-2 text-sm border border-border rounded-md bg-background font-mono focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                      placeholder="#000000"
                      maxLength={7}
                    />
                  </div>
                  <div
                    className="w-10 h-10 rounded-md border-2 border-border shadow-inner"
                    style={{ backgroundColor: tempColor }}
                  />
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-2">Quick Colors</p>
                  <div className="grid grid-cols-8 gap-2">
                    {[
                      '#ef4444', '#f97316', '#f59e0b', '#eab308',
                      '#84cc16', '#22c55e', '#10b981', '#14b8a6',
                      '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
                      '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
                      '#f43f5e', '#64748b', '#475569', '#334155',
                      '#1e293b', '#0f172a', '#ffffff', '#000000'
                    ].map((presetColor) => (
                    <button
                      key={presetColor}
                      onClick={() => setTempColor(presetColor)}
                      className={cn(
                        'w-8 h-8 rounded border-2 transition-all',
                        tempColor === presetColor
                          ? 'border-primary scale-110'
                          : 'border-border hover:border-muted-foreground hover:scale-105'
                      )}
                      style={{ backgroundColor: presetColor }}
                      aria-label={`Select ${presetColor}`}
                    />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2 p-4 border-t border-border">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleCancel}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                className="flex-1"
                onClick={handleConfirm}
                icon={<Check className="w-4 h-4" />}
              >
                OK
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}