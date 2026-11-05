import messages from './en.json';
export function currentLanguage(){try{return localStorage.getItem('lms-language')==='en'?'en':'vi';}catch{return 'vi';}}
export function currentLocale(){return currentLanguage()==='en'?'en-GB':'vi-VN';}
export function uiText(source:string,values:unknown[]=[]){
 const key=source.trim();const translated=currentLanguage()==='en'?(messages as Record<string,string>)[key]:undefined;
 const result=translated===undefined?source:source.replace(key,()=>translated);
 const entities:Record<string,string>={'&rarr;':'→','&larr;':'←','&ldquo;':'“','&rdquo;':'”','&#10;':'\n','&amp;':'&','&lt;':'<','&gt;':'>'};
 return result.replace(/&(?:rarr|larr|ldquo|rdquo|amp|lt|gt|#10);/g, entity=>entities[entity]).replace(/\{(\d+)\}/g,(_,i)=>String(values[Number(i)]??''));
}
