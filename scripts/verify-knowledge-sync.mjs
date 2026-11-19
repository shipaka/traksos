/**
 * TrakSOS release gate. Future code changes affecting what we teach or charge
 * must update the versioned knowledge package IN THE SAME pull request.
 *
 * This is a coverage guard, not a substitute for legal review or live UX tests.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const file=(p)=>readFileSync(p,'utf8');
const required=[
  'docs/TRAKSOS_USER_INTRO.md',
  'docs/FINANCIAL_KNOWLEDGE_RELEASE_POLICY.md',
  'web/src/screens/help.tsx',
  'web/src/screens/platformIntro.tsx',
  'web/src/screens/trainingDemoModel.ts',
  'web/src/screens/scenarioLibrary.ts',
  'web/src/screens/economicsGuide.tsx',
  'web/src/screens/offers.tsx',
  'server/src/domain/economicsGuide.ts',
  'server/test/economics-guide.test.ts',
  'server/test/scenario-encyclopedia.test.ts',
];
for(const path of required) if(!existsSync(path))throw new Error('Knowledge release missing file: '+path);
const econ=file('web/src/screens/economicsGuide.tsx');
const help=file('web/src/screens/help.tsx');
const terms=file('web/src/screens/offers.tsx');
const api=file('server/src/app.ts');
const finance=file('server/src/domain/money.ts');
const rf=file('server/src/services/referral.ts');
const guide=file('server/src/domain/economicsGuide.ts');
const init=file('server/src/domain/defaults.ts');
for(const [name,passes] of [
  ['Help consumes live economics',help.includes('<EconomicsGuide')],
  ['Rules consume live economics',file('web/src/screens/rules.tsx').includes('<EconomicsGuide')],
  ['Legal view consumes live economics',terms.includes('<EconomicsGuide')],
  ['Role-scoped endpoint exists',api.includes("'/api/me/economics'")],
  ['No contractor fee in public prices',!api.match(/r\.get\('\/api\/pricing'[\s\S]{0,900}performerCommissionPct:/)],
  ['Server caps both sides',finance.includes('cappedPct(amount, fees.clientFeePct)')&&finance.includes('cappedPct(amount, commissionPct(fees, ctx))')],
  ['Referral credits from actual client fee',rf.includes('const actualFee = Math.max(0, clientFee - Number(actualPoints?.points_fee ?? 0))')],
  ['Referral 10% of fee',init.includes('clientSharePct: 10')],
  ['Client spend 10% of order',init.includes('clientSpendCapPct: 10')],
  ['Legal publications embed financial snapshot',file('server/src/services/offers.ts').includes('contractEconomyAnnex(await this.settings.all(),p.audience)')],
  ['Training role scenarios present',file('web/src/screens/scenarioLibrary.ts').includes('scenariosForRole')],
  ['Financial guide contains examples',guide.includes('examples=[1_000_000,20_000_000]')],
  ['Financial guide is called from help',help.includes("import { EconomicsGuide }")],
  ['Financial guide shown to user',econ.includes('Математика на примерах')],
])if(!passes)throw new Error('Knowledge consistency check failed: '+name);

// Changes in these behavior modules require actual knowledge/offer files in the
// release diff. No false claim that CI can interpret arbitrary new UX behavior.
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
let base=null;
try {
  const ref=process.env.GITHUB_BASE_REF;
  if(ref)base=git('merge-base','HEAD','origin/'+ref);
  else if(process.env.GITHUB_EVENT_NAME==='push')base=git('rev-parse','HEAD^');
} catch {
  if(process.env.GITHUB_BASE_REF)throw new Error('Cannot find PR merge-base: fetch full Git history in checkout.');
}
if(base){
  const changed=git('diff','--name-only',base,'HEAD').split('\n').filter(Boolean);
  const changedHas=(regex)=>changed.some(x=>regex.test(x));
  const domainChanged=changedHas(/^server\/src\/(?:domain\/(?:money|pricing|defaults|orderState)\.ts|services\/(?:orders|referral|support|settings|offers|service|insuranceQuoteFlow|partnerFinance)\.ts|payments\/service\.ts)$/);
  const legalChanged=changedHas(/^server\/src\/(?:domain\/(?:money|defaults)\.ts|services\/(?:referral|offers|settings)\.ts|payments\/service\.ts)$/);
  if(domainChanged){
    for(const file of ['docs/TRAKSOS_USER_INTRO.md','web/src/screens/help.tsx']){
      if(!changed.includes(file))throw new Error('Changed business rules without updating '+file+' in this release');
    }
    if(!changedHas(/^web\/src\/screens\/(?:scenarioLibrary|trainingDemoModel|economicsGuide)\.tsx?$/))
      throw new Error('Business rules changed without reviewing the matching role-learning module');
  }
  // An economic rule change must be reviewed in ALL three public surfaces:
  // role finance, legal offer, and release policy. Merely touching help is not enough.
  if(legalChanged){
    for(const path of [
      'web/src/screens/offers.tsx',
      'server/src/domain/economicsGuide.ts',
      'docs/FINANCIAL_KNOWLEDGE_RELEASE_POLICY.md',
      'server/test/economics-guide.test.ts',
    ]){
      if(!changed.includes(path))
        throw new Error('Economics changed without updating the legal/learning release package: '+path);
    }
  }
  // If the order/support lifecycle changes, at least one practical decision
  // course must be reviewed, not just a paragraph about the new feature.
  const lifecycleChanged=changedHas(/^server\/src\/(?:domain\/(?:pricing|orderState)\.ts|services\/(?:orders|support|service|insuranceQuoteFlow)\.ts)$/);
  if(lifecycleChanged && !changedHas(/^web\/src\/screens\/(?:scenarioLibrary|trainingDemoModel)\.ts$/))
    throw new Error('Order/support behavior changed without updating an interactive course');
  if(lifecycleChanged && !changed.includes('server/test/scenario-encyclopedia.test.ts'))
    throw new Error('Order/support behavior changed without reviewing scenario regression tests');
  console.log('Knowledge release gate: '+changed.length+' changed files, business='+domainChanged+', economics='+legalChanged+', lifecycle='+lifecycleChanged);
} else console.log('Knowledge consistency validated (no applicable git base comparison).');
