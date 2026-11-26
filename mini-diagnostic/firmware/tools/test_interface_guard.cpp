#include "interface_guard.h"
#include <cassert>
using G=InterfaceGuard;
int main() {
    G g;
    const G::Conditions ok{true,true,true,true,true};
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
    assert(g.select(G::Path::WarningInput,4000,ok)); g.tick(4100,ok);
    assert(g.enabledMask()==8 && !g.txAllowed());
    auto failure=ok; failure.hardwareOk=false;
    g.tick(4101,failure); assert(g.state()==G::State::Latched && g.enabledMask()==0);
    assert(!g.select(G::Path::KLine,4200,ok)); assert(!g.reset(ok));
    assert(g.reset({false,false,false,true,true})); assert(g.enabledMask()==0);
    assert(!g.select(static_cast<G::Path>(255),4300,ok)); assert(g.enabledMask()==0);
    assert(g.select(G::Path::Iso11992,0xfffffff0u,ok));
    g.tick(0x54u,ok); assert(g.enabledMask()==1);
    g.stop(); assert(g.enabledMask()==0);
    auto lights=ok; lights.lightOff=false;
    assert(!g.select(G::Path::KLine,1,lights));
}
