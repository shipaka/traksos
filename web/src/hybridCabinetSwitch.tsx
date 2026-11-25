import {hybridCabinetChoices,type CabinetMode} from './cabinetMode.ts';
import './hybridCabinetSwitch.css';

export function HybridCabinetSwitch({roles,mode,performerKind,onChoose}:{
  roles:readonly string[];mode:CabinetMode;performerKind?:string;
  onChoose:(mode:CabinetMode)=>void;
}) {
  const choices=hybridCabinetChoices(roles,performerKind);
  if(choices.length<2||!choices.some(choice=>choice.mode===mode))return null;
  return <div className="cabinet-role-switch hybrid-cabinet-switch">
    <select aria-label="Текущий рабочий кабинет" value={mode} onChange={event=>{
      const selected=choices.find(choice=>choice.mode===event.target.value);
      if(selected&&selected.mode!==mode)onChoose(selected.mode);
    }}>
      {choices.map(choice=><option key={choice.mode} value={choice.mode}>{choice.label}</option>)}
    </select>
  </div>;
}
