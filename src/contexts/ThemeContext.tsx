import { createContext, useContext, useEffect, useState } from 'react';
import { hexToHSL, getContrastTextColor, getSecondaryTextColor, ensureReadablePrimary } from '@/utils/colorConvert';
import { logger } from '@/utils/logger';

type Theme = 'light' | 'dark' | 'system';
type AccentColor = 'blue' | 'purple' | 'green' | 'orange' | 'pink' | 'cyan' | 'indigo' | 'custom';
type Density = 'minimal' | 'compact' | 'comfortable';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
  accentColor: AccentColor;
  setAccentColor: (color: AccentColor) => void;
  customAccentColor: string;
  setCustomAccentColor: (color: string) => void;
  customPrimaryColor: string;
  setCustomPrimaryColor: (color: string) => void;
  customBackgroundColor: string;
  setCustomBackgroundColor: (color: string) => void;
  customHeaderColor: string;
  setCustomHeaderColor: (color: string) => void;
  customSidebarColor: string;
  setCustomSidebarColor: (color: string) => void;
  customBorderColor: string;
  setCustomBorderColor: (color: string) => void;
  useCustomColors: boolean;
  setUseCustomColors: (use: boolean) => void;
  density: Density;
  setDensity: (density: Density) => void;
  animations: boolean;
  setAnimations: (enabled: boolean) => void;
  blur: boolean;
  setBlur: (enabled: boolean) => void;
  reduceMotion: boolean;
  setReduceMotion: (enabled: boolean) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
  fontFamily: string;
  setFontFamily: (family: string) => void;
  fontWeight: string;
  setFontWeight: (weight: string) => void;
  fontStyle: string;
  setFontStyle: (style: string) => void;
  letterSpacing: number;
  setLetterSpacing: (spacing: number) => void;
  lineHeight: number;
  setLineHeight: (height: number) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const log = logger.namespace('ThemeContext');
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('theme') as Theme;
    return stored || 'system';
  });

  const [accentColor, setAccentColor] = useState<AccentColor>(() => {
    const stored = localStorage.getItem('accentColor') as AccentColor;
    return stored || 'blue';
  });

  const [customAccentColor, setCustomAccentColor] = useState<string>(() => {
    const stored = localStorage.getItem('customAccentColor');
    return stored || '#8b5cf6';
  });

  const [customPrimaryColor, setCustomPrimaryColor] = useState<string>(() => {
    const stored = localStorage.getItem('customPrimaryColor');
    return stored || '#3b82f6';
  });

  const [customBackgroundColor, setCustomBackgroundColor] = useState<string>(() => {
    const stored = localStorage.getItem('customBackgroundColor');
    return stored || '#ffffff';
  });

  const [customForegroundColor, setCustomForegroundColor] = useState<string>(() => {
    const stored = localStorage.getItem('customForegroundColor');
    return stored || '#020817';
  });

  const [customHeaderColor, setCustomHeaderColor] = useState<string>(() => {
    const stored = localStorage.getItem('customHeaderColor');
    return stored || '#f8fafc';
  });

  const [customSidebarColor, setCustomSidebarColor] = useState<string>(() => {
    const stored = localStorage.getItem('customSidebarColor');
    return stored || '#ffffff';
  });

  const [customBorderColor, setCustomBorderColor] = useState<string>(() => {
    const stored = localStorage.getItem('customBorderColor');
    return stored || '#e2e8f0';
  });

  const [useCustomColors, setUseCustomColors] = useState<boolean>(() => {
    const stored = localStorage.getItem('useCustomColors');
    return stored === 'true';
  });

  const [fontSize, setFontSize] = useState<number>(() => {
    const stored = localStorage.getItem('fontSize');
    return stored ? parseInt(stored) : 15;
  });

  const [fontFamily, setFontFamily] = useState<string>(() => {
    const stored = localStorage.getItem('fontFamily');
    return stored || 'system-ui';
  });

  const [fontWeight, setFontWeight] = useState<string>(() => {
    const stored = localStorage.getItem('fontWeight');
    return stored || '400';
  });

  const [fontStyle, setFontStyle] = useState<string>(() => {
    const stored = localStorage.getItem('fontStyle');
    return stored || 'normal';
  });

  const [letterSpacing, setLetterSpacing] = useState<number>(() => {
    const stored = localStorage.getItem('letterSpacing');
    return stored ? parseFloat(stored) : 0;
  });

  const [lineHeight, setLineHeight] = useState<number>(() => {
    const stored = localStorage.getItem('lineHeight');
    return stored ? parseFloat(stored) : 1.5;
  });

  const [density, setDensity] = useState<Density>(() => {
    const stored = localStorage.getItem('density') as Density;
    return stored || 'comfortable';
  });

  const [animations, setAnimations] = useState<boolean>(() => {
    const stored = localStorage.getItem('animations');
    return stored !== 'false';
  });

  const [blur, setBlur] = useState<boolean>(() => {
    const stored = localStorage.getItem('blur');
    return stored !== 'false';
  });

  const [reduceMotion, setReduceMotion] = useState<boolean>(() => {
    const stored = localStorage.getItem('reduceMotion');
    // Default to system preference if not stored
    if (stored === null) {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return stored === 'true';
  });

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const root = window.document.documentElement;

    const applyTheme = () => {
      let effectiveTheme: 'light' | 'dark';

      if (theme === 'system') {
        effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
      } else {
        effectiveTheme = theme;
      }

      root.classList.remove('light', 'dark');
      root.classList.add(effectiveTheme);
      setResolvedTheme(effectiveTheme);
      log.info('Theme applied', { theme, effectiveTheme });
    };

    applyTheme();
    localStorage.setItem('theme', theme);

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme();
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme, log]);

  useEffect(() => {
    const root = window.document.documentElement;

    // Apply accent color
    if (accentColor === 'custom') {
      root.setAttribute('data-accent', 'custom');
      // Convert hex to HSL for CSS variables
      const hslColor = hexToHSL(customAccentColor);
      root.style.setProperty('--custom-accent', hslColor);
      localStorage.setItem('customAccentColor', customAccentColor);
      log.info('Custom accent color applied', { customAccentColor });
    } else if (accentColor !== 'blue') {
      root.setAttribute('data-accent', accentColor);
      // Clear custom accent when switching to preset
      root.style.removeProperty('--custom-accent');
      log.info('Preset accent color applied', { accentColor });
    } else {
      root.removeAttribute('data-accent');
      root.style.removeProperty('--custom-accent');
      log.info('Default accent color applied', { accentColor: 'blue' });
    }

    localStorage.setItem('accentColor', accentColor);
  }, [accentColor, customAccentColor, log]);

  // Apply custom colors when enabled
  useEffect(() => {
    const root = window.document.documentElement;

    if (useCustomColors) {
      try {
        root.setAttribute('data-custom-colors', 'true');

        log.debug('[ThemeContext] Applying custom colors...');

        // Calculate optimal text colors based on background colors
        const foregroundColor = getContrastTextColor(customBackgroundColor);
        const headerTextColor = getContrastTextColor(customHeaderColor);
        const sidebarTextColor = getContrastTextColor(customSidebarColor);
        const primaryTextColor = getContrastTextColor(customPrimaryColor); // For checkmarks!
        const secondaryFontColor = getSecondaryTextColor(foregroundColor); // Subtle variation of primary text!
        // Readable primary: ensures text-primary (accent icons/badges) is visible against the background
        // E.g., if primary is white and background is white, this darkens the primary for text usage
        const primaryReadableColor = ensureReadablePrimary(customPrimaryColor, customBackgroundColor);

        // Convert and apply all custom colors
        root.style.setProperty('--custom-primary', hexToHSL(customPrimaryColor));
        root.style.setProperty('--custom-primary-text', hexToHSL(primaryTextColor)); // For checkmarks!
        root.style.setProperty('--custom-primary-readable', hexToHSL(primaryReadableColor)); // For text-primary accent usage!
        root.style.setProperty('--custom-background', hexToHSL(customBackgroundColor));
        root.style.setProperty('--custom-foreground', hexToHSL(foregroundColor)); // Auto-calculated!
        root.style.setProperty('--custom-header', hexToHSL(customHeaderColor));
        root.style.setProperty('--custom-header-text', hexToHSL(headerTextColor)); // Auto-calculated!
        root.style.setProperty('--custom-sidebar', hexToHSL(customSidebarColor));
        root.style.setProperty('--custom-sidebar-text', hexToHSL(sidebarTextColor)); // Auto-calculated!
        root.style.setProperty('--custom-border', hexToHSL(customBorderColor));
        root.style.setProperty('--custom-secondary-font', hexToHSL(secondaryFontColor)); // Auto-calculated subtle variation!

        log.debug('[ThemeContext] Custom colors applied successfully');
      } catch (error) {
        log.error('[ThemeContext] Error applying custom colors:', error);
        log.error('[ThemeContext] Color values:', {
          customPrimaryColor,
          customBackgroundColor,
          customHeaderColor,
          customSidebarColor,
          customBorderColor,
        });

        // Disable custom colors on error to prevent cascading failures
        setUseCustomColors(false);
        root.removeAttribute('data-custom-colors');
      }
    } else {
      root.removeAttribute('data-custom-colors');
      root.style.removeProperty('--custom-primary');
      root.style.removeProperty('--custom-primary-text');
      root.style.removeProperty('--custom-primary-readable');
      root.style.removeProperty('--custom-background');
      root.style.removeProperty('--custom-foreground');
      root.style.removeProperty('--custom-header');
      root.style.removeProperty('--custom-header-text');
      root.style.removeProperty('--custom-sidebar');
      root.style.removeProperty('--custom-sidebar-text');
      root.style.removeProperty('--custom-border');
      root.style.removeProperty('--custom-secondary-font');
    }

    localStorage.setItem('useCustomColors', String(useCustomColors));
    if (useCustomColors) {
      localStorage.setItem('customPrimaryColor', customPrimaryColor);
      localStorage.setItem('customBackgroundColor', customBackgroundColor);
      localStorage.setItem('customHeaderColor', customHeaderColor);
      localStorage.setItem('customSidebarColor', customSidebarColor);
      localStorage.setItem('customBorderColor', customBorderColor);
    }
  }, [
    useCustomColors,
    customPrimaryColor,
    customBackgroundColor,
    customHeaderColor,
    customSidebarColor,
    customBorderColor,
  ]);

  useEffect(() => {
    const root = window.document.documentElement;

    // Apply density
    root.setAttribute('data-density', density);
    localStorage.setItem('density', density);
    log.info('Density mode changed', { density });
  }, [density, log]);

  useEffect(() => {
    const root = window.document.documentElement;

    // Apply animations
    if (!animations) {
      root.classList.add('no-animations');
    } else {
      root.classList.remove('no-animations');
    }
    localStorage.setItem('animations', String(animations));
    log.debug('Animations toggled', { enabled: animations });
  }, [animations, log]);

  useEffect(() => {
    const root = window.document.documentElement;

    // Apply blur effects
    if (!blur) {
      root.classList.add('no-blur');
    } else {
      root.classList.remove('no-blur');
    }
    localStorage.setItem('blur', String(blur));
    log.debug('Blur effects toggled', { enabled: blur });
  }, [blur, log]);

  useEffect(() => {
    const root = window.document.documentElement;

    // Apply reduce motion preference
    if (reduceMotion) {
      root.classList.add('reduce-motion');
    } else {
      root.classList.remove('reduce-motion');
    }
    localStorage.setItem('reduceMotion', String(reduceMotion));
    log.debug('Reduce motion toggled', { enabled: reduceMotion });
  }, [reduceMotion, log]);

  // PERFORMANCE FIX: Apply typography settings with requestAnimationFrame
  // Batches all 6 CSS updates into a single frame to prevent layout thrashing
  useEffect(() => {
    // Use requestAnimationFrame to batch DOM updates
    const frameId = requestAnimationFrame(() => {
      const root = window.document.documentElement;

      // Batch all CSS custom property updates in one frame
      root.style.setProperty('--custom-font-size', `${fontSize}px`);
      root.style.setProperty('--custom-font-family', fontFamily);
      root.style.setProperty('--custom-font-weight', fontWeight);
      root.style.setProperty('--custom-font-style', fontStyle);
      root.style.setProperty('--custom-letter-spacing', `${letterSpacing}em`);
      root.style.setProperty('--custom-line-height', String(lineHeight));

      // Persist to localStorage after DOM updates complete
      localStorage.setItem('fontSize', String(fontSize));
      localStorage.setItem('fontFamily', fontFamily);
      localStorage.setItem('fontWeight', fontWeight);
      localStorage.setItem('fontStyle', fontStyle);
      localStorage.setItem('letterSpacing', String(letterSpacing));
      localStorage.setItem('lineHeight', String(lineHeight));
    });

    // Cleanup: cancel scheduled frame if component unmounts or dependencies change
    return () => cancelAnimationFrame(frameId);
  }, [fontSize, fontFamily, fontWeight, fontStyle, letterSpacing, lineHeight]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        resolvedTheme,
        accentColor,
        setAccentColor,
        customAccentColor,
        setCustomAccentColor,
        customPrimaryColor,
        setCustomPrimaryColor,
        customBackgroundColor,
        setCustomBackgroundColor,
        customHeaderColor,
        setCustomHeaderColor,
        customSidebarColor,
        setCustomSidebarColor,
        customBorderColor,
        setCustomBorderColor,
        useCustomColors,
        setUseCustomColors,
        density,
        setDensity,
        animations,
        setAnimations,
        blur,
        setBlur,
        reduceMotion,
        setReduceMotion,
        fontSize,
        setFontSize,
        fontFamily,
        setFontFamily,
        fontWeight,
        setFontWeight,
        fontStyle,
        setFontStyle,
        letterSpacing,
        setLetterSpacing,
        lineHeight,
        setLineHeight,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
