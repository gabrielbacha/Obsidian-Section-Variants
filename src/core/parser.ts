import { describeOpening } from './attributes';
import {
	Diagnostic,
	FenceToken,
	normalizeLabel,
	ParsedNote,
	VariantBlock,
	VariantSection,
} from './types';

interface ContainerFrame {
	kind: 'container';
	block: VariantBlock;
}

interface VariantFrame {
	kind: 'variant';
	block: VariantBlock;
	variant: VariantSection;
}

interface OtherFrame {
	kind: 'other';
	opening: FenceToken;
}

type Frame = ContainerFrame | VariantFrame | OtherFrame;

interface CodeFence {
	character: '`' | '~';
	length: number;
}

const DIV_FENCE = /^ {0,3}(:{3,})(?:[ \t]+(.+?))?[ \t]*$/u;
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})/u;
const BLOCK_ID = /^\^([\p{L}\p{N}-]+)$/u;

export function parseNote(
	source: string,
	configuredAliases: readonly string[] = ['variants'],
): ParsedNote {
	const aliases = new Set(
		['variants', ...configuredAliases].map((alias) => alias.trim()).filter(Boolean),
	);
	const lines = source.split('\n');
	const lineOffsets = buildLineOffsets(lines);
	const blocks: VariantBlock[] = [];
	const roots: VariantBlock[] = [];
	const fences: FenceToken[] = [];
	const diagnostics: Diagnostic[] = [];
	const stack: Frame[] = [];
	let codeFence: CodeFence | undefined;
	let frontmatter = lines[0]?.replace(/\r$/u, '') === '---';

	for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
		const rawLine = lines[lineNumber]?.replace(/\r$/u, '') ?? '';
		const offset = lineOffsets[lineNumber] ?? 0;

		if (frontmatter) {
			if (lineNumber > 0 && rawLine === '---') frontmatter = false;
			continue;
		}

		const codeMatch = rawLine.match(CODE_FENCE);
		if (codeMatch?.[1]) {
			const marker = codeMatch[1];
			const character = marker[0] as '`' | '~';
			if (!codeFence) {
				codeFence = { character, length: marker.length };
				continue;
			}
			if (codeFence.character === character && marker.length >= codeFence.length) {
				codeFence = undefined;
			}
			continue;
		}
		if (codeFence) continue;

		const match = rawLine.match(DIV_FENCE);
		if (!match?.[1]) continue;
		const marker = match[1];
		const description = match[2]?.trim();
		const token: FenceToken = {
			text: rawLine.trim(),
			colonCount: marker.length,
			kind: description ? 'open' : 'close',
			from: offset,
			to: offset + rawLine.length,
			lineStart: lineNumber,
			lineEnd: lineNumber,
		};
		fences.push(token);

		if (!description) {
			closeFrame(stack, token, source, lineOffsets, diagnostics);
			continue;
		}

		const directVariantChild = stack.at(-1)?.kind === 'container';
		const opening = describeOpening(description, aliases, directVariantChild);
		const openingDiagnostics = opening.diagnostics.map((diagnostic) => ({
			...diagnostic,
			line: lineNumber,
			from: offset,
			to: offset + rawLine.length,
		}));

		if (opening.kind === 'container') {
			const parentVariantFrame = findNearestVariantFrame(stack);
			const parentBlock = parentVariantFrame?.block;
			const block = createBlock(token, opening.attributes ?? {}, parentBlock);
			block.diagnostics.push(...openingDiagnostics);
			blocks.push(block);
			if (parentBlock && parentVariantFrame) {
				parentBlock.children.push(block);
				parentVariantFrame.variant.children.push(block);
			} else {
				roots.push(block);
			}
			stack.push({ kind: 'container', block });
			continue;
		}

		if (opening.kind === 'variant' && stack.at(-1)?.kind === 'container') {
			const container = stack.at(-1) as ContainerFrame;
			const variant: VariantSection = {
				label: opening.label ?? '',
				normalizedLabel: normalizeLabel(opening.label ?? ''),
				opening: token,
				content: {
					from: nextLineOffset(lineNumber, lineOffsets, token.to),
					to: source.length,
					lineStart: lineNumber + 1,
					lineEnd: lines.length - 1,
				},
				children: [],
			};
			container.block.variants.push(variant);
			container.block.diagnostics.push(...openingDiagnostics);
			stack.push({ kind: 'variant', block: container.block, variant });
			continue;
		}

		const currentBlock = findNearestContainerFrame(stack)?.block;
		currentBlock?.diagnostics.push(...openingDiagnostics);
		stack.push({ kind: 'other', opening: token });
	}

	finishUnclosedFrames(stack, source, diagnostics);
	for (const block of blocks) validateBlock(block, lines, lineOffsets);
	validateUniqueIds(blocks);
	assignIdentities(blocks);
	diagnostics.push(...blocks.flatMap((block) => block.diagnostics));

	return { source, lineOffsets, blocks, roots, fences, diagnostics };
}

function createBlock(
	opening: FenceToken,
	attributes: VariantBlock['attributes'],
	parent?: VariantBlock,
): VariantBlock {
	return {
		attributes,
		opening,
		variants: [],
		children: [],
		diagnostics: [],
		valid: false,
		range: { ...opening },
		identityKey: '',
		identityAmbiguous: false,
		fingerprint: '',
		parent,
	};
}

function closeFrame(
	stack: Frame[],
	token: FenceToken,
	source: string,
	lineOffsets: number[],
	diagnostics: Diagnostic[],
): void {
	const frame = stack.pop();
	if (!frame) {
		diagnostics.push({
			code: 'unexpected-closing-fence',
			message: 'Closing fenced div has no matching opening fence.',
			severity: 'warning',
			line: token.lineStart,
			from: token.from,
			to: token.to,
		});
		return;
	}
	if (frame.kind === 'other') return;
	if (frame.kind === 'variant') {
		frame.variant.closing = token;
		frame.variant.content = {
			from: nextLineOffset(
				frame.variant.opening.lineStart,
				lineOffsets,
				frame.variant.opening.to,
			),
			to: token.from,
			lineStart: frame.variant.opening.lineStart + 1,
			lineEnd: Math.max(
				frame.variant.opening.lineStart + 1,
				token.lineStart - 1,
			),
		};
		return;
	}
	frame.block.closing = token;
	frame.block.range = {
		from: frame.block.opening.from,
		to: token.to,
		lineStart: frame.block.opening.lineStart,
		lineEnd: token.lineEnd,
	};
	if (frame.block.range.to > source.length) frame.block.range.to = source.length;
}

function finishUnclosedFrames(
	stack: Frame[],
	source: string,
	diagnostics: Diagnostic[],
): void {
	while (stack.length > 0) {
		const frame = stack.pop();
		if (!frame || frame.kind === 'other') continue;
		const opening =
			frame.kind === 'variant' ? frame.variant.opening : frame.block.opening;
		const diagnostic: Diagnostic = {
			code: 'missing-closing-fence',
			message: `Missing closing fence for the ${frame.kind === 'variant' ? 'variant' : 'variants block'}.`,
			severity: 'error',
			line: opening.lineStart,
			from: opening.from,
			to: opening.to,
			fix: 'append-closer',
		};
		if (frame.kind === 'variant') {
			frame.variant.content.to = source.length;
			frame.block.diagnostics.push(diagnostic);
		} else {
			frame.block.range.to = source.length;
			frame.block.diagnostics.push(diagnostic);
		}
		diagnostics.push(diagnostic);
	}
}

function validateBlock(
	block: VariantBlock,
	lines: string[],
	lineOffsets: number[],
): void {
	if (block.variants.length < 2) {
		block.diagnostics.push(blockDiagnostic(block, 'fewer-than-two-variants', 'A variants block requires at least two variants.'));
	}
	const seen = new Set<string>();
	for (const variant of block.variants) {
		if (!variant.label.trim()) {
			block.diagnostics.push(blockDiagnostic(block, 'empty-variant-label', 'Variant labels cannot be empty.'));
		}
		if (seen.has(variant.normalizedLabel)) {
			block.diagnostics.push({
				...blockDiagnostic(
					block,
					'duplicate-variant-label',
					`Duplicate label: ${variant.label}. Labels are case-insensitively unique within a block.`,
				),
				line: variant.opening.lineStart,
				from: variant.opening.from,
				to: variant.opening.to,
			});
		}
		seen.add(variant.normalizedLabel);
		if (!variant.closing) {
			block.diagnostics.push(blockDiagnostic(block, 'unclosed-variant', `Variant ${variant.label || '(unlabeled)'} is not closed.`));
		}
	}

	if (
		block.attributes.defaultLabel &&
		!seen.has(normalizeLabel(block.attributes.defaultLabel))
	) {
		block.diagnostics.push(
			blockDiagnostic(
				block,
				'invalid-default-label',
				`Default label ${block.attributes.defaultLabel} does not exist in this block.`,
			),
		);
	}
	if (block.attributes.widths && /[;{}]/u.test(block.attributes.widths)) {
		block.diagnostics.push({
			...blockDiagnostic(
				block,
				'invalid-widths',
				'Invalid column widths; equal widths will be used.',
			),
			severity: 'warning',
		});
	}
	if (
		block.attributes.minWidth &&
		!/^\d+(?:\.\d+)?(?:px|rem|em|ch)$/u.test(block.attributes.minWidth)
	) {
		block.diagnostics.push({
			...blockDiagnostic(
				block,
				'invalid-min-width',
				'Invalid minimum width; the vault default will be used.',
			),
			severity: 'warning',
		});
	}
	if (block.closing) {
		const nextLine = block.closing.lineEnd + 1;
		const nextText = lines[nextLine]?.replace(/\r$/u, '').trim();
		const idMatch = nextText?.match(BLOCK_ID);
		if (idMatch?.[1]) block.blockId = idMatch[1];
		const nextOffset = lineOffsets[nextLine];
		if (idMatch?.[1] && nextOffset !== undefined) {
			block.range.to = nextOffset + (lines[nextLine]?.replace(/\r$/u, '').length ?? 0);
			block.range.lineEnd = nextLine;
		}
	}
	block.valid =
		Boolean(block.closing) &&
		block.diagnostics.every((diagnostic) => diagnostic.severity !== 'error');
}

function validateUniqueIds(blocks: VariantBlock[]): void {
	const byId = new Map<string, VariantBlock[]>();
	for (const block of blocks) {
		const stableId = block.attributes.id ?? block.blockId;
		if (!stableId) continue;
		const entries = byId.get(stableId) ?? [];
		entries.push(block);
		byId.set(stableId, entries);
	}
	for (const [id, entries] of byId) {
		if (entries.length < 2) continue;
		for (const block of entries) {
			block.diagnostics.push(
				blockDiagnostic(
					block,
					'duplicate-block-id',
					`Block ID ${id} is used by more than one variants block.`,
				),
			);
			block.valid = false;
		}
	}
}

function assignIdentities(blocks: VariantBlock[]): void {
	const fingerprints = new Map<string, VariantBlock[]>();
	for (const block of blocks) {
		block.fingerprint = hashText(
			block.variants.map((variant) => variant.normalizedLabel).join('\u0000'),
		);
		if (block.attributes.id) {
			block.identityKey = `id:${block.attributes.id}`;
			continue;
		}
		if (block.blockId) {
			block.identityKey = `block:${block.blockId}`;
			continue;
		}
		const entries = fingerprints.get(block.fingerprint) ?? [];
		entries.push(block);
		fingerprints.set(block.fingerprint, entries);
	}
	for (const [fingerprint, entries] of fingerprints) {
		entries.forEach((block, index) => {
			block.identityKey = `fingerprint:${fingerprint}:${index}`;
			block.identityAmbiguous = entries.length > 1;
		});
	}
}

function hashText(text: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

function blockDiagnostic(
	block: VariantBlock,
	code: string,
	message: string,
): Diagnostic {
	return {
		code,
		message,
		severity: 'error',
		line: block.opening.lineStart,
		from: block.opening.from,
		to: block.opening.to,
	};
}

function findNearestVariantFrame(stack: Frame[]): VariantFrame | undefined {
	return [...stack].reverse().find((frame): frame is VariantFrame => frame.kind === 'variant');
}

function findNearestContainerFrame(stack: Frame[]): ContainerFrame | undefined {
	return [...stack].reverse().find((frame): frame is ContainerFrame => frame.kind === 'container');
}

function buildLineOffsets(lines: string[]): number[] {
	const offsets: number[] = [];
	let offset = 0;
	for (const line of lines) {
		offsets.push(offset);
		offset += line.length + 1;
	}
	return offsets;
}

function nextLineOffset(
	line: number,
	lineOffsets: number[],
	fallback: number,
): number {
	return lineOffsets[line + 1] ?? fallback;
}
