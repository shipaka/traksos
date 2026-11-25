// A single illustration can have many independent vehicle bindings.
// Thematic discovery never proves installation. Exact vehicle fit requires
// generation/year, variant and evidence (and VIN where applicable).
export type TechBinding={
 make:string;model:string;generation?:string;yearFrom?:number;yearTo?:number;
 variant?:string;manufacturer?:string;article?:string;revision?:string;
 source:string;status:'thematic'|'verified_component';
};
export type TechBindingCard={
 id:string;make:string|null;models:readonly string[];url:string;
};
export type BindingFilter={make?:string;model?:string;year?:number;generation?:string;variant?:string};
const norm=(s:string)=>s.trim().toLowerCase();
// Only add independently reviewed entries with an exact component identity.
// No fabricated cross-brand installation assertions.
export const VERIFIED_BINDINGS:Readonly<Record<string,readonly TechBinding[]>>={};
export function bindingsForCard(card:TechBindingCard,additional:readonly TechBinding[]=VERIFIED_BINDINGS[card.id]??[]):TechBinding[]{
 const thematic:TechBinding[]=card.make?card.models.map(model=>({make:card.make!,model,source:card.url,status:'thematic'})):[];
 return [...thematic,...additional].filter((b,i,all)=>all.findIndex(x=>JSON.stringify(x)===JSON.stringify(b))===i);
}
export function matchesBinding(b:TechBinding,f:BindingFilter){
 if(f.make&&norm(b.make)!==norm(f.make))return false;
 if(f.model&&norm(b.model)!==norm(f.model))return false;
 if(f.year!=null&&((b.yearFrom!=null&&f.year<b.yearFrom)||(b.yearTo!=null&&f.year>b.yearTo)))return false;
 if(f.generation&&b.generation&&norm(b.generation)!==norm(f.generation))return false;
 if(f.variant&&b.variant&&norm(b.variant)!==norm(f.variant))return false;
 return true;
}
export function bindingEvidenceComplete(b:TechBinding){
 return b.status==='verified_component'&&!!b.make&&!!b.model&&!!b.generation&&
 Number.isInteger(b.yearFrom)&&Number.isInteger(b.yearTo)&&b.yearFrom!<=b.yearTo!&&
 !!b.variant&&!!b.manufacturer&&!!b.article&&!!b.revision&&/^https:\/\//.test(b.source);
}
export function discoverCard(card:TechBindingCard,bindings:readonly TechBinding[],filter:BindingFilter,includeGeneral=true){
 if(!filter.make&&!filter.model&&filter.year==null&&!filter.generation&&!filter.variant)return true;
 return bindings.some(b=>matchesBinding(b,filter))||(!card.make&&bindings.length===0&&includeGeneral);
}
