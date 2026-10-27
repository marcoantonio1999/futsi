import type {ComponentProps, ElementType} from 'react';
import {createElement} from 'react';

// shadcn/ui primitives, adapted to the existing native form and top-layer dialog
// contracts. Keep native submit/ref/FormData semantics and A4 print styles.
type Variant = 'default'|'outline'|'secondary'|'ghost'|'destructive'|'link';
export function Button({variant, className='', ...props}: ComponentProps<'button'> & {variant?:Variant}) {
  const tokens=className.split(/\s+/);
  const resolved=variant ?? (tokens.some(t=>/danger|destructive|delete-confirm/.test(t))?'destructive':tokens.includes('primary')?'default':tokens.includes('quiet')?'ghost':'outline');
  return <button data-slot="button" data-variant={resolved} className={className} {...props}/>;
}
export function Input(props:ComponentProps<'input'>){return <input data-slot={props.type==='checkbox'?'checkbox':'input'} {...props}/>;}
export function NativeSelect(props:ComponentProps<'select'>){return <select data-slot="native-select" {...props}/>;}
export function Textarea(props:ComponentProps<'textarea'>){return <textarea data-slot="textarea" {...props}/>;}
export function Label(props:ComponentProps<'label'>){return <label data-slot="label" {...props}/>;}
export function Dialog(props:ComponentProps<'dialog'>){return <dialog data-slot="dialog-content" {...props}/>;}
export function Card<T extends ElementType='div'>({as,...props}:{as?:T}&ComponentProps<T>){
  return createElement(as||'div',{'data-slot':'card',...props});
}
