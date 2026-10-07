import type { TaskColor } from '../types';

/** The task colour palette: a strong colour (border, swatch) and the soft tint used for the card and the sheet cell. */
export const TASK_COLORS: Record<TaskColor, { label: string; strong: string; soft: string }> = {
  orange: { label: 'Orange', strong: '#e8913a', soft: '#fde7cf' },
  blue: { label: 'Blue', strong: '#3b82f6', soft: '#dbe8fb' },
  teal: { label: 'Teal', strong: '#14a38b', soft: '#d5f0ec' },
  purple: { label: 'Purple', strong: '#8b5cf6', soft: '#ece3fb' },
  pink: { label: 'Pink', strong: '#e0518f', soft: '#fadbe8' },
  brown: { label: 'Brown', strong: '#9a6b44', soft: '#ede2d6' },
};
export const TASK_COLOR_KEYS = Object.keys(TASK_COLORS) as TaskColor[];
