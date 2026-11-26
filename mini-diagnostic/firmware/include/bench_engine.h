#pragma once
#include <array>
#include <cstddef>
#include <cstdint>

// USB-only virtual state machine. No electrical I/O; no CAN. All outputs are RAM bits.
class BenchEngine {
public:
    using Reply = std::array<uint8_t,10>;
    void connect(uint32_t now) { connected_=true; enabled_=0; seq_=0; last_=now; }
    void disconnect() { connected_=false; enabled_=0; }
    void tick(uint32_t now) { if(connected_ && uint32_t(now-last_)>=2000u) disconnect(); }
    Reply state() const { return reply(0,0); }
    Reply handle(const uint8_t* data,std::size_t size,uint32_t now) {
        tick(now);
        if(size!=9 || data==nullptr || data[0]!=1 || data[7]!=0 || data[8]!=0 || data[6]>127)
            return reply(0,1);
        const uint8_t op=data[1], payload=data[6];
        const uint32_t seq=uint32_t(data[2])|(uint32_t(data[3])<<8)|(uint32_t(data[4])<<16)|(uint32_t(data[5])<<24);
        const bool known=(op>=1 && op<=5)||(op>=16 && op<=18);
        if(!known || seq==0 || (op!=2 && op!=4 && payload!=0) ||
            (op==4 && (payload==0 || (payload & (payload-1))!=0))) return reply(0,1);
        if(!connected_) return reply(seq,2);
        if(seq<=seq_) return reply(seq,3);
        seq_=seq;
        if(op>=16) return reply(seq,5);
        if(op==2) enabled_=payload;
        if(op==3) enabled_=0;
        // No fault-injection hardware, no virtual faults in this USB image.
        last_=now;
        return reply(seq,0);
    }
private:
    bool connected_=false;
    uint8_t enabled_=0;
    uint32_t seq_=0, last_=0;
    Reply reply(uint32_t seq,uint8_t code) const {
        return {{1,code,uint8_t(seq),uint8_t(seq>>8),uint8_t(seq>>16),uint8_t(seq>>24),
            uint8_t(2|(connected_?1:0)),enabled_,0,0}};
    }
};
