#include "bench_engine.h"
#include <cassert>
#include <array>
using Frame=std::array<uint8_t,9>;
static Frame f(uint8_t op,uint32_t seq,uint8_t p=0) {
    return {{1,op,uint8_t(seq),uint8_t(seq>>8),uint8_t(seq>>16),uint8_t(seq>>24),p,0,0}};
}
static BenchEngine::Reply send(BenchEngine& e,Frame x,uint32_t t) {
    return e.handle(x.data(),x.size(),t);
}
int main() {
    BenchEngine e;
    assert(send(e,f(2,1,35),0)[1]==2);
    e.connect(0);
    assert(send(e,f(1,1),1)[6]==3);
    const auto set=send(e,f(2,2,35),2);
    assert((set==BenchEngine::Reply{{1,0,2,0,0,0,3,35,0,0}}));
    const auto replay=send(e,f(2,2,0),3);
    assert(replay[1]==3 && replay[7]==35);
    assert(send(e,f(3,3),4)[7]==0);
    assert(send(e,f(17,4),5)[1]==5);
    assert(send(e,f(1,5),6)[7]==0);
    e.connect(100);
    assert(send(e,f(2,1,127),101)[7]==127);
    assert(send(e,f(4,2,3),102)[1]==1);
    assert(send(e,f(99,2),103)[1]==1);
    assert(send(e,f(2,1,0),2000)[1]==3);
    e.tick(2101);
    assert(e.state()[6]==2 && e.state()[7]==0);
    e.connect(0xfffffff0u);
    assert(send(e,f(2,1,1),0xfffffff1u)[7]==1);
    e.tick(0x000007c1u);
    assert(e.state()[6]==2 && e.state()[7]==0);
    e.connect(3000);
    assert(send(e,f(1,1),3001)[7]==0);
    e.disconnect();
    assert(e.state()[6]==2);
}
