#pragma once
#include <cstdint>

// Host-testable interlock model. Deliberately NOT connected to physical GPIO.
// The real hardware must independently fail safe; this model cannot prove that.
class InterfaceGuard {
public:
    enum class Path : uint8_t { Off=0, Iso11992=1, KLine=2, Iso11898=3, WarningInput=4 };
    enum class State : uint8_t { Off, Break, Active, Latched };
    struct Conditions { bool session; bool permit; bool cable; bool lightOff; bool hardwareOk; bool authenticated; };
    static constexpr uint32_t breakMs=100; // virtual test value, not final electrical timing
    static constexpr uint32_t leaseMs=2000;
    bool select(Path path,uint32_t now,Conditions c) {
        tick(now,c);
        if(path==Path::Off) { stop(); return true; }
        if(state_==State::Latched || !safe(c) || !known(path)) { stop(); return false; }
        if(state_==State::Active || state_==State::Break) { stop(); return false; }
        desired_=path; since_=now; last_=now; state_=State::Break; return true;
    }
    void tick(uint32_t now,Conditions c) {
        if(!c.hardwareOk) { fault(); return; }
        if(state_==State::Latched || state_==State::Off) return;
        if(!safe(c) || uint32_t(now-last_)>=leaseMs) { stop(); return; }
        if(state_==State::Break && uint32_t(now-since_)>=breakMs) state_=State::Active;
    }
    bool renew(uint32_t now,Conditions c) {
        tick(now,c);
        if(state_!=State::Active && state_!=State::Break) return false;
        last_=now; return true;
    }
    void stop() {
        desired_=Path::Off;
        if(state_!=State::Latched) state_=State::Off;
    }
    void fault() { desired_=Path::Off; state_=State::Latched; }
    bool reset(Conditions c) {
        if(state_!=State::Latched || !c.hardwareOk || c.session || c.permit || c.authenticated || !c.lightOff) return false;
        state_=State::Off; desired_=Path::Off; return true;
    }
    State state() const { return state_; }
    uint8_t enabledMask() const {
        return state_==State::Active ? uint8_t(1u<<(static_cast<uint8_t>(desired_)-1u)) : 0;
    }
    bool txAllowed() const { return state_==State::Active && desired_!=Path::WarningInput; }
private:
    static bool known(Path p) { return p>=Path::Iso11992 && p<=Path::WarningInput; }
    static bool safe(Conditions c) { return c.session && c.permit && c.cable && c.lightOff && c.hardwareOk && c.authenticated; }
    State state_=State::Off;
    Path desired_=Path::Off;
    uint32_t since_=0,last_=0;
};
