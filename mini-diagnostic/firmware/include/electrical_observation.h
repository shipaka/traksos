#pragma once
#include <cstdint>

// Pure observation model. No GPIO, TWAI, ADC, BLE, traffic or fault control.
// Values are calibrated measurements supplied by a future validated acquisition path.
class ElectricalObservation {
public:
    struct Supply {
        bool present=false;
        uint32_t samples=0;
        uint32_t latestMv=0, minMv=0, maxMv=0, lastMs=0;
    };
    struct Can {
        bool present=false;
        uint32_t epoch=0, lastMs=0, busErrors=0, missed=0, overruns=0;
        uint32_t busErrorDelta=0, missedDelta=0, overrunDelta=0;
        bool comparable=false;
    };
    void reset() { supply_=Supply{}; can_=Can{}; }
    void observeSupply(uint32_t mv,uint32_t now,bool valid) {
        if(!valid) { supply_=Supply{}; return; }
        if(!supply_.present) {
            supply_.minMv=mv; supply_.maxMv=mv;
        } else {
            if(mv<supply_.minMv) supply_.minMv=mv;
            if(mv>supply_.maxMv) supply_.maxMv=mv;
        }
        supply_.present=true; supply_.latestMv=mv; supply_.lastMs=now;
        if(supply_.samples!=UINT32_MAX) ++supply_.samples;
    }
    void observeCan(uint32_t epoch,uint32_t busErrors,uint32_t missed,uint32_t overruns,uint32_t now,bool valid) {
        if(!valid) { can_=Can{}; return; }
        const bool comparable=can_.present && can_.epoch==epoch &&
            busErrors>=can_.busErrors && missed>=can_.missed && overruns>=can_.overruns;
        Can next;
        next.present=true; next.epoch=epoch; next.lastMs=now;
        next.busErrors=busErrors; next.missed=missed; next.overruns=overruns;
        next.comparable=comparable;
        if(comparable) {
            next.busErrorDelta=busErrors-can_.busErrors;
            next.missedDelta=missed-can_.missed;
            next.overrunDelta=overruns-can_.overruns;
        }
        can_=next;
    }
    Supply supply(uint32_t now,uint32_t maxAgeMs) const {
        return supply_.present && uint32_t(now-supply_.lastMs)<=maxAgeMs ? supply_ : Supply{};
    }
    Can can(uint32_t now,uint32_t maxAgeMs) const {
        return can_.present && uint32_t(now-can_.lastMs)<=maxAgeMs ? can_ : Can{};
    }
private:
    Supply supply_;
    Can can_;
};
