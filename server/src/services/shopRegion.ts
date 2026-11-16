import { z } from 'zod';
import type { Db } from '../db/index.ts';
import type { AuthUser, AuthedCtx, Router } from '../http/router.ts';
import { parse, bad, conflict } from '../http/router.ts';
import type { SettingsService } from './settings.ts';
import type { ShopService } from './shop.ts';

type City = {city_code:'spb'|'other';city_label:string;selected_at:Date};
const CITY='Санкт-Петербург';
const BLOCKED='Пока недоступен в вашем регионе';
const city=z.string().trim().min(2).max(80).regex(/^[\p{L}\p{M} .'-]+$/u,
  'Укажите название города, а не адрес');
function cityCode(name:string):'spb'|'other' {
  const v=name.trim().toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[.\s-]+/g,'');
  return ['санктпетербург','спб','питер'].includes(v)?'spb':'other';
}
// Fail closed until a geocoder confirms a local delivery address.
// "Московская область, Санкт-Петербургское шоссе" is NOT Saint Petersburg.
function addressDeclaredInSpb(address:string) {
  return /^\s*(?:г\.?\s*)?(?:санкт[\s-]?петербург|спб)(?=[\s,.;№\d]|$)/iu.test(address);
}
export class ShopRegionService {
  constructor(private db:Db, private settings:SettingsService){}
  async selected(user:AuthUser):Promise<City|null>{
    return this.db.one<City>('select city_code,city_label,selected_at from shop_customer_regions where user_id=$1',[user.id]);
  }
  async choose(user:AuthUser,cityName:string) {
    const selected=parse(city,cityName);
    const code=cityCode(selected);
    // Do not reuse the chat region or IP location; this is storefront intent only.
    const stored=await this.db.one<City>(
      'insert into shop_customer_regions(user_id,city_code,city_label) values($1,$2,$3) '+
      'on conflict(user_id) do update set city_code=excluded.city_code,city_label=excluded.city_label,selected_at=now() '+
      'returning city_code,city_label,selected_at',
      [user.id,code,code==='spb'?CITY:selected]);
    return this.describe(stored);
  }
  describe(value:City|null) {
    return {city:value?.city_label??null,selected:Boolean(value),available:value?.city_code==='spb',
      supportedCity:CITY,message:value?.city_code==='spb'?null:BLOCKED};
  }
  async current(user:AuthUser){return this.describe(await this.selected(user));}
  async requireAvailable(user:AuthUser) {
    const selected=await this.selected(user);
    if(selected?.city_code!=='spb') throw conflict('shop_region_unavailable',BLOCKED);
  }
  async requireWhenOpen(user:AuthUser) {
    const settings=await this.settings.get('shop');
    if(settings.enabled)await this.requireAvailable(user);
  }
  async requireCheckout(user:AuthUser,delivery:string,address:string|null|undefined){
    await this.requireWhenOpen(user);
    if(delivery==='delivery') {
      if(!address?.trim())return; // let existing 400 need_address rule surface
      if(!addressDeclaredInSpb(address))throw conflict('delivery_outside_region',
        'Доставка магазина пока доступна только по адресам Санкт-Петербурга');
    }
  }
  async catalog(user:AuthUser,shop:ShopService,light:boolean) {
    const selection=await this.current(user);
    const settings=await this.settings.get('shop');
    if(!settings.enabled) return {...await shop.catalog(light),region:selection};
    if(!selection.available) return {
      enabled:false,closedTitle:BLOCKED,
      closedText:'Магазин запчастей пока работает только в Санкт-Петербурге. Выберите город, чтобы проверить доступность.',
      note:'Покупки и доставка в других регионах пока не принимаются.',
      categories:{},categoryGroups:[],products:[],region:selection,
      delivery:{pickup:false,pickupAddress:'',delivery:false,deliveryPrice:0,
        deliveryNote:'',withMaster:false}
    };
    return {...await shop.catalog(light),region:selection};
  }
}

export function registerShopRegionRoutes(r:Router,regions:ShopRegionService) {
  r.get('/api/shop/region',true,(c:AuthedCtx)=>regions.current(c.user));
  r.put('/api/shop/region',true,(c:AuthedCtx)=>{
    const {city:cityName}=parse(z.object({city}),c.body);
    return regions.choose(c.user,cityName);
  });
}