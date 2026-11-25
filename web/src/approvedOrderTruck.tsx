import { APPROVED_VISUALS } from './approvedVisuals.ts';
import { vehicleReferencePhoto } from './vehiclePhotoCatalog.ts';
import './approvedOrderTruck.css';

/** Same API-backed order picture on desktop and Android.
 * A matching photo requires brand AND model and a compatible generation/year.
 * Otherwise we show a clearly labeled generic illustration, never a false model.
 */
export function ApprovedOrderTruck({order}:{order:any}) {
  const brand=order.vehicle?.brand||order.v_brand||order.brand;
  const model=order.vehicle?.model||order.v_model||order.model;
  const year=order.vehicle?.year||order.v_year||order.year;
  const exact=vehicleReferencePhoto(brand,model,year);
  return <span className={'tr-approved-order-truck'+(exact?' is-model-photo':' is-illustration')}
    role="img" aria-label={exact
      ? exact.description
      : 'Иллюстрация грузовика. Точное фото автомобиля клиента не определено.'}>
    <img loading="lazy" alt="" aria-hidden="true"
      src={exact?.src??APPROVED_VISUALS.workspaceTruck}/>
    {!exact && <small>Иллюстрация</small>}
  </span>;
}
