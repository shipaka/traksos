#include "interface_guard.h"
#include "electrical_observation.h"
#include <cassert>
using G=InterfaceGuard;
static void observationTests() {
    ElectricalObservation o;
    assert(!o.supply(0,500).present && !o.can(0,500).present);
    o.observeSupply(24800,100,true);
    o.observeSupply(20100,110,true);
    o.observeSupply(25000,120,true);
    auto s=o.supply(130,500);
    assert(s.present && s.samples==3 && s.latestMv==25000 && s.minMv==20100 && s.maxMv==25000);
    assert(!o.supply(621,500).present);
    o.observeSupply(0,622,false);
    assert(!o.supply(622,500).present);
    o.observeSupply(0,623,true); // calibrated zero is not missing data
    assert(o.supply(623,500).present && o.supply(623,500).latestMv==0);
    o.observeCan(1,5,3,2,100,true);
    assert(!o.can(100,500).comparable);
    o.observeCan(1,9,4,2,200,true);
    auto c=o.can(200,500);
    assert(c.comparable && c.busErrorDelta==4 && c.missedDelta==1 && c.overrunDelta==0);
    o.observeCan(2,0,0,0,210,true);
    assert(!o.can(210,500).comparable);
    o.observeCan(2,3,2,1,220,true);
    o.observeCan(2,1,0,0,230,true);
    assert(!o.can(230,500).comparable);
    o.observeCan(2,1,0,0,240,false);
    assert(!o.can(240,500).present);
    o.observeSupply(24000,0xfffffff0u,true);
    assert(o.supply(0x10u,50).present);
    assert(!o.supply(0x100u,50).present);
    o.reset();
    assert(!o.supply(0,500).present && !o.can(0,500).present);
}
int main() {
    observationTests();
    G g;
    const G::Conditions ok{true,true,true,true,true,true};
    assert(g.enabledMask()==0 && !g.txAllowed());
    assert(g.select(G::Path::Iso11992,0,ok));
    g.tick(99,ok); assert(g.enabledMask()==0);
    g.tick(100,ok); assert(g.enabledMask()==1 && g.txAllowed());
    assert(!g.select(G::Path::Iso11898,101,ok));
    assert(g.enabledMask()==0);
    assert(g.select(G::Path::Iso11898,102,ok));
    g.tick(202,ok); assert(g.enabledMask()==4);
    auto missing=ok; missing.cable=false;
    g.tick(203,missing); assert(g.enabledMask()==0);
    assert(g.select(G::Path::KLine,300,ok)); g.tick(400,ok); assert(g.enabledMask()==2);
    assert(g.renew(1000,ok)); g.tick(3000,ok); assert(g.enabledMask()==0);
    assert(!g.select(static_cast<G::Path>(4),3999,ok));
    assert(g.enabledMask()==0 && !g.txAllowed());
    assert(g.select(G::Path::Iso11992,4000,ok)); g.tick(4100,ok);
    assert(g.enabledMask()==1 && g.txAllowed());
    auto failure=ok; failure.hardwareOk=false;
    g.tick(4101,failure); assert(g.state()==G::State::Latched && g.enabledMask()==0);
    assert(!g.select(G::Path::KLine,4200,ok)); assert(!g.reset(ok));
    assert(g.reset({false,false,false,true,true,false})); assert(g.enabledMask()==0);
    assert(!g.select(static_cast<G::Path>(255),4300,ok)); assert(g.enabledMask()==0);
    assert(g.select(G::Path::Iso11992,0xfffffff0u,ok));
    g.tick(0x54u,ok); assert(g.enabledMask()==1);
    g.stop(); assert(g.enabledMask()==0);
    auto lights=ok; lights.lightOff=false;
    assert(!g.select(G::Path::KLine,1,lights));
    auto unauthorized=ok; unauthorized.authenticated=false;
    assert(!g.select(G::Path::Iso11992,2,unauthorized));
    assert(g.enabledMask()==0 && !g.txAllowed());
    assert(g.select(G::Path::Iso11992,3,ok));
    g.tick(103,ok); assert(g.txAllowed());
    g.tick(104,unauthorized);
    assert(g.enabledMask()==0 && !g.txAllowed());
    assert(!g.renew(105,ok)); // authentication recovery cannot restart a path
    assert(g.select(G::Path::KLine,106,ok));
    assert(!g.renew(107,unauthorized));
    assert(g.enabledMask()==0);
    // An omitted authentication field is zero-initialized in an aggregate.
    const G::Conditions defaultDeny{};
    assert(!g.select(G::Path::Iso11992,108,defaultDeny));
}
