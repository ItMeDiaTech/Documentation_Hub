import logger from './logger';

// Convert hex color to HSL format for CSS variables
export function hexToHSL(hex: string): string {
  try {
    // Validate input
    if (!hex || typeof hex !== 'string') {
      logger.error('[ColorConvert] Invalid hex color input:', hex);
      return '0 0% 50%'; // Default to medium gray
    }

    // Remove the hash if present
    hex = hex.replace(/^#/, '');

    // Validate hex format (must be 6 characters of 0-9, A-F)
    if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
      logger.error('[ColorConvert] Invalid hex format:', hex);
      return '0 0% 50%'; // Default to medium gray
    }

    // Parse the hex values
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    // Validate parsed values
    if (isNaN(r) || isNaN(g) || isNaN(b)) {
      logger.error('[ColorConvert] Failed to parse hex values:', hex);
      return '0 0% 50%';
    }

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      switch (max) {
        case r:
          h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
          break;
        case g:
          h = ((b - r) / d + 2) / 6;
          break;
        case b:
          h = ((r - g) / d + 4) / 6;
          break;
      }
    }

    // Convert to CSS HSL format (H in degrees, S and L in percentages)
    const hDegrees = Math.round(h * 360);
    const sPercent = Math.round(s * 100);
    const lPercent = Math.round(l * 100);

    // Validate final values
    if (isNaN(hDegrees) || isNaN(sPercent) || isNaN(lPercent)) {
      logger.error('[ColorConvert] Invalid HSL values calculated from:', hex);
      return '0 0% 50%';
    }

    // Return in Tailwind CSS variable format
    return `${hDegrees} ${sPercent}% ${lPercent}%`;
  } catch (error) {
    logger.error('[ColorConvert] Unexpected error in hexToHSL:', error, 'Input:', hex);
    return '0 0% 50%'; // Safe fallback
  }
}

// Convert hex to RGB format
export function hexToRGB(hex: string): string {
  hex = hex.replace(/^#/, '');

  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  return `${r} ${g} ${b}`;
}

/**
 * Calculate relative luminance of a color using the WCAG 2.1 formula
 * @param hex Hex color string (e.g., '#FFFFFF' or 'FFFFFF')
 * @returns Luminance value between 0 (black) and 1 (white)
 */
export function calculateLuminance(hex: string): number {
  try {
    // Validate input
    if (!hex || typeof hex !== 'string') {
      logger.error('[ColorConvert] Invalid hex input for luminance:', hex);
      return 0.5; // Default to medium luminance
    }

    // Remove hash if present
    hex = hex.replace(/^#/, '');

    // Validate hex format
    if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
      logger.error('[ColorConvert] Invalid hex format for luminance:', hex);
      return 0.5;
    }

    // Parse RGB values (0-255) and normalize to 0-1
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    // Validate parsed values
    if (isNaN(r) || isNaN(g) || isNaN(b)) {
      logger.error('[ColorConvert] Failed to parse RGB for luminance:', hex);
      return 0.5;
    }

    // Apply gamma correction (sRGB to linear RGB)
    // WCAG 2.1 formula: if value <= 0.03928, divide by 12.92, else apply power function
    const gammaCorrect = (channel: number): number => {
      return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    };

    const rLinear = gammaCorrect(r);
    const gLinear = gammaCorrect(g);
    const bLinear = gammaCorrect(b);

    // Calculate relative luminance using WCAG coefficients
    // These weights account for human eye sensitivity to different colors
    const luminance = 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;

    // Validate result
    if (isNaN(luminance)) {
      logger.error('[ColorConvert] Invalid luminance calculated from:', hex);
      return 0.5;
    }

    return luminance;
  } catch (error) {
    logger.error('[ColorConvert] Unexpected error in calculateLuminance:', error, 'Input:', hex);
    return 0.5; // Safe fallback
  }
}

/**
 * Determine optimal text color (white or black) for a given background color
 * Uses WCAG 2.1 contrast guidelines to ensure readability
 * @param backgroundColor Hex color string (e.g., '#FFFFFF' or 'FFFFFF')
 * @returns '#FFFFFF' for white text or '#000000' for black text
 */
export function getContrastTextColor(backgroundColor: string): string {
  try {
    // Validate input
    if (!backgroundColor || typeof backgroundColor !== 'string') {
      logger.error('[ColorConvert] Invalid background color for contrast:', backgroundColor);
      return '#000000'; // Default to black text
    }

    const luminance = calculateLuminance(backgroundColor);

    // WCAG threshold: luminance > 0.5 suggests light background (use black text)
    // luminance <= 0.5 suggests dark background (use white text)
    return luminance > 0.5 ? '#000000' : '#FFFFFF';
  } catch (error) {
    logger.error(
      '[ColorConvert] Unexpected error in getContrastTextColor:',
      error,
      'Input:',
      backgroundColor
    );
    return '#000000'; // Safe fallback
  }
}

/**
 * Create a subtle color variation for secondary text
 * Makes white text slightly darker, and black text slightly lighter
 * @param primaryTextColor Primary text color ('#FFFFFF' or '#000000')
 * @returns Slightly adjusted hex color for secondary text
 */
export function getSecondaryTextColor(primaryTextColor: string): string {
  try {
    // Validate input
    if (!primaryTextColor || typeof primaryTextColor !== 'string') {
      logger.error('[ColorConvert] Invalid primary text color for secondary:', primaryTextColor);
      return '#4D4D4D'; // Default to gray
    }

    const isWhite =
      primaryTextColor.toUpperCase() === '#FFFFFF' || primaryTextColor.toUpperCase() === 'FFFFFF';

    if (isWhite) {
      // White text -> slightly darker (85% opacity equivalent = #D9D9D9)
      return '#D9D9D9';
    } else {
      // Black text -> slightly lighter (70% opacity equivalent = #4D4D4D)
      return '#4D4D4D';
    }
  } catch (error) {
    logger.error(
      '[ColorConvert] Unexpected error in getSecondaryTextColor:',
      error,
      'Input:',
      primaryTextColor
    );
    return '#4D4D4D'; // Safe fallback
  }
}

/**
 * Parse a hex color string into R, G, B components (0-255)
 * @param hex Hex color string (e.g., '#FFFFFF' or 'FFFFFF')
 * @returns Object with r, g, b values (0-255)
 */
function parseHex(hex: string): { r: number; g: number; b: number } {
  hex = hex.replace(/^#/, '');
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16),
  };
}

/**
 * Convert R, G, B components (0-255) to a hex color string
 */
function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
}

/**
 * Adjust a color's lightness by mixing it toward black (darken) or white (lighten).
 * @param hex The color to adjust
 * @param factor Amount to adjust (0 = no change, 1 = fully black/white)
 * @param direction 'darken' or 'lighten'
 * @returns Adjusted hex color
 */
function adjustLightness(hex: string, factor: number, direction: 'darken' | 'lighten'): string {
  const { r, g, b } = parseHex(hex);
  const target = direction === 'darken' ? 0 : 255;
  return toHex(
    r + (target - r) * factor,
    g + (target - g) * factor,
    b + (target - b) * factor
  );
}

/**
 * Calculate the WCAG contrast ratio between two colors.
 * @returns Contrast ratio (1:1 to 21:1)
 */
export function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = calculateLuminance(hex1);
  const lum2 = calculateLuminance(hex2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Ensure a primary accent color is readable when used as text against the background.
 * If the contrast ratio is too low (e.g., white primary on white background),
 * the color is progressively darkened or lightened until it meets a 3:1 contrast ratio.
 *
 * This does NOT affect bg-primary (backgrounds keep the user's chosen color).
 * It only affects text-primary (standalone accent text/icons on the page background).
 *
 * @param primaryHex The user's chosen primary color
 * @param backgroundHex The user's chosen background color
 * @returns A hex color that maintains the primary hue but is readable against the background
 */
export function ensureReadablePrimary(primaryHex: string, backgroundHex: string): string {
  try {
    if (!primaryHex || !backgroundHex) {
      logger.error('[ColorConvert] Invalid inputs for ensureReadablePrimary:', { primaryHex, backgroundHex });
      return primaryHex || '#3B82F6'; // Fallback to default blue
    }

    const contrastRatio = getContrastRatio(primaryHex, backgroundHex);

    // WCAG AA large text / UI components require 3:1 minimum
    if (contrastRatio >= 3) {
      return primaryHex; // Already readable — no adjustment needed
    }

    // Determine direction: darken primary on light backgrounds, lighten on dark
    const bgLum = calculateLuminance(backgroundHex);
    const direction: 'darken' | 'lighten' = bgLum > 0.5 ? 'darken' : 'lighten';

    // Progressively adjust until we hit 3:1 contrast (step in 5% increments)
    for (let step = 0.05; step <= 1.0; step += 0.05) {
      const adjusted = adjustLightness(primaryHex, step, direction);
      const newRatio = getContrastRatio(adjusted, backgroundHex);
      if (newRatio >= 3) {
        return adjusted;
      }
    }

    // If we couldn't reach 3:1 even at maximum adjustment, use black or white
    return bgLum > 0.5 ? '#000000' : '#FFFFFF';
  } catch (error) {
    logger.error('[ColorConvert] Error in ensureReadablePrimary:', error);
    return primaryHex || '#3B82F6';
  }
}
