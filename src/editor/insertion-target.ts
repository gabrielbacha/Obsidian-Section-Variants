import type {Editor,EditorPosition} from 'obsidian';
import {STRUCTURAL_TRANSACTION_ORIGIN} from '../core/structural-transaction';
export interface InsertionTarget {path:string;source:string;from:number;to:number;}
export function captureInsertion(editor:Editor,path:string,from:EditorPosition,to:EditorPosition=from):InsertionTarget{return{path,source:editor.getValue(),from:editor.posToOffset(from),to:editor.posToOffset(to)};}
export function commitInsertion(editor:Editor,currentPath:string|undefined,target:InsertionTarget,markdown:string,contentOffset:number):void{
 if(currentPath!==target.path||editor.getValue()!==target.source)throw new Error('The note or insertion position changed. Open the insert dialog again.');
 const expected=target.source.slice(0,target.from)+markdown+target.source.slice(target.to);
 editor.transaction({changes:[{from:editor.offsetToPos(target.from),to:editor.offsetToPos(target.to),text:markdown}]},STRUCTURAL_TRANSACTION_ORIGIN);
 if(editor.getValue()!==expected)throw new Error('Obsidian did not accept the insertion.');
 editor.setCursor(editor.offsetToPos(target.from+contentOffset));
}
