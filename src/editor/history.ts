import { isolateHistory } from '@codemirror/commands';
import { AnnotationType } from '@codemirror/state';

// Obsidian provides one shared state module at runtime. The npm command and
// Obsidian declarations currently depend on different state declaration copies.
export const isolateNativeHistory = isolateHistory as unknown as AnnotationType<'before' | 'after' | 'full'>;
