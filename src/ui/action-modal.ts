import {Modal} from 'obsidian';
import {errorMessage} from '../core/errors';
/** Owns one asynchronous commit. Closing a submitted dialog cannot submit it again. */
const activeModals=new Set<ActionModal>();
export function closeActionModals():void{for(const modal of [...activeModals])modal.close();}
export class ActionModal extends Modal {
 open():void{activeModals.add(this);super.open();}
 private pending=false;
 private committed=false;
 private closed=false;
 protected async perform(action:()=>void|Promise<void>,error?:HTMLElement):Promise<void>{
  if(this.pending||this.committed||this.closed)return;
  this.pending=true;this.contentEl.setAttribute('aria-busy','true');
  const status=this.contentEl.createEl('p',{text:'Saving changes. Closing this dialog does not cancel this action.'});status.setAttribute('role','status');
  const controls=Array.from(this.contentEl.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('button,input,select')).map(element=>({element,disabled:element.disabled}));
  for(const {element}of controls)element.disabled=true;
  try{await action();this.committed=true;if(!this.closed)this.close();}
  catch(reason){if(!this.closed)error?.setText(errorMessage(reason));}
  finally{this.pending=false;if(!this.closed){status.remove();this.contentEl.removeAttribute('aria-busy');for(const {element,disabled}of controls)element.disabled=disabled;}}
 }
 onClose():void{this.closedSubmission();this.contentEl.empty();}
 protected isSubmissionClosed():boolean{return this.closed;}
 protected closedSubmission():void{this.closed=true;activeModals.delete(this);}
}
