export interface TextChange {from:number;to:number;insert:string;}
/** UTF-16 offsets for all host adapters, keeping CRLF and surrogate pairs intact. */
export function textChange(before:string,after:string):TextChange{
 let from=0;const shared=Math.min(before.length,after.length);
 while(from<shared&&before[from]===after[from])from++;
 if(split(before,from)||split(after,from))from--;
 let suffix=0;while(suffix<before.length-from&&suffix<after.length-from&&before[before.length-suffix-1]===after[after.length-suffix-1])suffix++;
 if(split(before,before.length-suffix)||split(after,after.length-suffix))suffix--;
 return{from,to:before.length-suffix,insert:after.slice(from,after.length-suffix)};
}
function split(text:string,at:number):boolean{if(at<=0||at>=text.length)return false;const previous=text.charCodeAt(at-1),current=text.charCodeAt(at);return(text[at-1]==='\r'&&text[at]==='\n')||(previous>=0xd800&&previous<=0xdbff&&current>=0xdc00&&current<=0xdfff);}
