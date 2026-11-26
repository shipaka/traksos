// USB-only bench firmware, no CAN, no GPIO load control and no writable GATT characteristic.
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

static constexpr char SERVICE[] = "7e625a10-5721-4cde-a84b-9e5fd1287410";
static constexpr char CAPABILITY[] = "7e625a11-5721-4cde-a84b-9e5fd1287410";
static uint8_t caps[] = {0x54,0x53,0x4D,0x44,1,0,1,0};
class ServerEvents : public BLEServerCallbacks {
    void onDisconnect(BLEServer*) override { BLEDevice::startAdvertising(); }
};
static ServerEvents events;
void setup() {
    Serial.begin(115200);
    BLEDevice::init("TrakSOS Mini Bench");
    auto* server = BLEDevice::createServer();
    server->setCallbacks(&events);
    auto* service = server->createService(SERVICE);
    auto* characteristic = service->createCharacteristic(CAPABILITY,BLECharacteristic::PROPERTY_READ);
    characteristic->setValue(caps,sizeof(caps));
    service->start();
    auto* advertising = BLEDevice::getAdvertising();
    advertising->addServiceUUID(SERVICE);
    advertising->setScanResponse(true);
    BLEDevice::startAdvertising();
    Serial.println("TrakSOS bench BLE v1: no electrical outputs; no CAN");
}
void loop() { delay(100); }
