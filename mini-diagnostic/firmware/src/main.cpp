// USB-only bench firmware: virtual state in RAM; no CAN, no load GPIO, no production service.
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <mutex>
#include "bench_engine.h"

static constexpr char SERVICE[] = "7e625a10-5721-4cde-a84b-9e5fd1287410";
static constexpr char CAPABILITY[] = "7e625a11-5721-4cde-a84b-9e5fd1287410";
static constexpr char COMMAND[] = "7e625a12-5721-4cde-a84b-9e5fd1287410";
static constexpr char RESPONSE[] = "7e625a13-5721-4cde-a84b-9e5fd1287410";
static uint8_t caps[] = {0x54,0x53,0x4D,0x44,1,1,3,0};
static BenchEngine engine;
static std::mutex guard;
static BLECharacteristic* response=nullptr;

static void publish(BenchEngine::Reply value) {
    if(response) response->setValue(value.data(),value.size());
}
class ServerEvents : public BLEServerCallbacks {
    void onConnect(BLEServer*) override {
        std::lock_guard<std::mutex> lock(guard);
        engine.connect(millis()); publish(engine.state());
    }
    void onDisconnect(BLEServer*) override {
        { std::lock_guard<std::mutex> lock(guard); engine.disconnect(); publish(engine.state()); }
        BLEDevice::startAdvertising();
    }
};
class CommandEvents : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* characteristic) override {
        const auto data=characteristic->getValue();
        std::lock_guard<std::mutex> lock(guard);
        publish(engine.handle(reinterpret_cast<const uint8_t*>(data.data()),data.size(),millis()));
    }
    // No notification, no extra device access; read response after confirmed write.
};
static ServerEvents events;
static CommandEvents commands;
void setup() {
    Serial.begin(115200);
    BLEDevice::init("TrakSOS Mini Bench");
    auto* server=BLEDevice::createServer();
    server->setCallbacks(&events);
    auto* service=server->createService(SERVICE);
    auto* capability=service->createCharacteristic(CAPABILITY,BLECharacteristic::PROPERTY_READ);
    capability->setValue(caps,sizeof(caps));
    response=service->createCharacteristic(RESPONSE,BLECharacteristic::PROPERTY_READ);
    publish(engine.state());
    auto* command=service->createCharacteristic(COMMAND,BLECharacteristic::PROPERTY_WRITE);
    command->setCallbacks(&commands);
    service->start();
    auto* advertising=BLEDevice::getAdvertising();
    advertising->addServiceUUID(SERVICE);
    advertising->setScanResponse(true);
    BLEDevice::startAdvertising();
    Serial.println("TrakSOS bench BLE v1.1: RAM only, no GPIO loads or CAN");
}
void loop() {
    // Clear virtual state on timeout. Do not overwrite a valid pending response before its read,
    // except when the session has expired (then stale replies must not be accepted).
    { std::lock_guard<std::mutex> lock(guard);
      const auto before=engine.state();
      engine.tick(millis());
      const auto after=engine.state();
      if(before[6]!=after[6]) publish(after);
    }
    delay(20);
}
