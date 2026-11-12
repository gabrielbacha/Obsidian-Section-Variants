import {describe,it,expect} from 'vitest';
import {parseNote} from './parser';
import {resolveMutationBlock} from './block-resolution';
import {serializeVariantOpening} from './serializer';
import {textChange} from './text-diff';
import {validColumnRatios,serializeColumnRatios,parseColumnRatios} from './column-ratios';
const box=(text:string,id='')=>`:::: {.variants${id?` #${id}`:''}}\n::: A\n${text}\n:::\n::: B\nOther\n:::\n::::`;
describe('deferred structural targets',()=>{
 it('does not reuse the removed first box ordinal for its neighbor',()=>{const first=box('First'),second=box('Second');const target=parseNote(first+'\n'+second).blocks[0]!;expect(resolveMutationBlock(target,parseNote(second).blocks)).toBeUndefined();expect(resolveMutationBlock(target,parseNote(second+'\n'+first).blocks)).toBeUndefined();});
 it('permits an unchanged anonymous source and an unchanged stable box moved through the note',()=>{const source=box('First');expect(resolveMutationBlock(parseNote(source).blocks[0]!,parseNote(source).blocks)).toBeDefined();const stable=box('First','stable');expect(resolveMutationBlock(parseNote(stable).blocks[0]!,parseNote('Intro\n'+stable).blocks)?.identityKey).toBe('id:stable');});
 it('rejects changed content and duplicate IDs even when a stable key is retained',()=>{const source=box('First','stable'),target=parseNote(source).blocks[0]!;expect(resolveMutationBlock(target,parseNote(source.replace('First','New content')).blocks)).toBeUndefined();expect(resolveMutationBlock(target,parseNote(source+'\n'+source).blocks)).toBeUndefined();});
});
describe('fail-visible fenced content',()=>{
 for(const marker of ['```','~~~'])it(`does not close ${marker} code with a trailing suffix`,()=>{expect(parseNote(`${marker}js\n${marker}not-a-close\n${box('Example')}\n${marker}`).blocks).toHaveLength(0);expect(parseNote(`${marker}js\n${marker+marker}\n${box('Active')}`).blocks[0]?.valid).toBe(true);});
 for(const [name,source]of [['preamble',box('One').replace('::: A','Preamble\n::: A')],['between',box('One').replace('::: B','Between\n::: B')],['trailing',box('One').replace('\n::::','\nTrailing\n::::')]])it(`keeps ${name} outside a child fail-visible`,()=>{const block=parseNote(source!).blocks[0]!;expect(block.valid).toBe(false);expect(block.diagnostics.some(item=>item.code==='unowned-container-text')).toBe(true);});
 it('propagates invalid nested content to a raw parent in every rendering path',()=>{const child=box('Nested').replace('::: B','::: A');const parent=`:::::: {.variants}\n::::: A\n${child}\n:::::\n::::: B\nOther\n:::::\n::::::`;expect(parseNote(parent).roots[0]?.valid).toBe(false);});
});
it('serializes supported multiword and punctuation labels with their fence length',()=>{for(const label of ['Long label','Quote "and" \\ slash','日本語']){const opening=serializeVariantOpening(3,label);const parsed=parseNote(`:::: {.variants}\n${opening}\nBody\n:::\n::: Other\nBody\n:::\n::::`);expect(parsed.blocks[0]?.valid).toBe(true);expect(parsed.blocks[0]?.variants[0]?.label).toBe(label);}expect(serializeVariantOpening(5,'Long label').startsWith('::::: ')).toBe(true);});
it('shares minimal UTF16 edits without splitting CRLF or surrogate pairs',()=>{for(const [before,after]of [['','😀'],['a\r\nb','a\nb'],['😀tail','😁tail'],['start😀','start😁'],['α\ntext','α\nNEWtext'],['same','same']]){const change=textChange(before!,after!);expect(before!.slice(0,change.from)+change.insert+before!.slice(change.to)).toBe(after);if(before==='😀tail')expect(change).toEqual({from:0,to:2,insert:'😁'});}});
it('accepted small, large and fractional column ratios stay positive after serialization',()=>{for(const values of [[.0001,1],[1000000,.000001],[1.234567,2.345678]]){expect(validColumnRatios(values)).toBe(true);const parsed=parseColumnRatios(serializeColumnRatios(values),2)!;expect(parsed.every(value=>value>0)).toBe(true);}expect(validColumnRatios([1e100,1])).toBe(false);expect(validColumnRatios([1e-20,1])).toBe(false);});
