// lux-ble.js (ES module) – Ren Web Bluetooth transport
export function envProbe(){
  return {
    https: location.protocol === 'https:',
    localhost: location.hostname === 'localhost' || location.hostname === '127.0.0.1',
    webBluetooth: !!navigator.bluetooth
  };
}

function luxPacket(r,g,b){ return new Uint8Array([0x01, 0xFF, r&255, g&255, b&255]); }

class WebBluetoothBackend {
  constructor(opts){
    this.opts = opts||{};
    this.device=null; this.server=null; this.char=null; this.metaCb=null;
    this.onDisconnected = null;
  }

  secureOk(){
    return location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  }
  async isSupported(){ return !!navigator.bluetooth && this.secureOk(); }

  async connect(metaCb){
    this.metaCb = typeof metaCb === 'function' ? metaCb : null;
    if (!await this.isSupported()) throw new Error('Web Bluetooth ikke understøttet i denne browser/kontekst');

    const OPTIONAL_SERVICES = [
      '00001234-0000-1000-8000-00805f9b34fb', // jeres model
      '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART (hvis relevant)
      '0000fff0-0000-1000-8000-00805f9b34fb','0000ff00-0000-1000-8000-00805f9b34fb',
      '0000ffd0-0000-1000-8000-00805f9b34fb','0000ffe0-0000-1000-8000-00805f9b34fb',
      '00001800-0000-1000-8000-00805f9b34fb','00001801-0000-1000-8000-00805f9b34fb',
      '0000180a-0000-1000-8000-00805f9b34fb','0000180f-0000-1000-8000-00805f9b34fb'
    ];

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'LUX' }],
      optionalServices: OPTIONAL_SERVICES
    });

    // Disconnect-handler
    this.onDisconnected = () => {
      this.char = null;
      this.server = null;
    };
    this.device.addEventListener('gattserverdisconnected', this.onDisconnected);

    this.server = await this.device.gatt.connect();

    // Find første skrivbare characteristic (ignorér standard 0x2A** og standard-services)
    const stdServices = new Set([
      '00001800-0000-1000-8000-00805f9b34fb',
      '00001801-0000-1000-8000-00805f9b34fb',
      '0000180a-0000-1000-8000-00805f9b34fb',
      '0000180f-0000-1000-8000-00805f9b34fb'
    ]);
    const is2A = u => /^00002a[0-9a-f]{2}-0000-1000-8000-00805f9b34fb$/i.test(u);

    let best=null, bestSvc=null;
    const services = await this.server.getPrimaryServices();
    for (const svc of services){
      const sUUID = svc.uuid.toLowerCase();
      if (stdServices.has(sUUID)) continue;
      const chars = await svc.getCharacteristics();
      for (const ch of chars){
        const cUUID = ch.uuid.toLowerCase();
        const p = ch.properties;
        if (is2A(cUUID)) continue;
        if (p.write || p.writeWithoutResponse){
          best = ch; bestSvc = sUUID;
          if (p.writeWithoutResponse) break; // foretræk uden respons
        }
      }
      if (best) break;
    }
    if (!best) throw new Error('Ingen skrivbar characteristic fundet');

    this.char = best;
    if (this.metaCb) this.metaCb({ svc: bestSvc, chr: best.uuid.toLowerCase() });

    return { transport:'webbluetooth', deviceName:this.device.name, charUUID:this.char.uuid };
  }

  async sendColor(r,g,b){
    if (!this.char) throw new Error('Ikke tilsluttet');
    const pkt = luxPacket(r,g,b);
    const p = this.char.properties;
    if (p.writeWithoutResponse && this.char.writeValueWithoutResponse) return this.char.writeValueWithoutResponse(pkt);
    if (p.write && this.char.writeValueWithResponse) return this.char.writeValueWithResponse(pkt);
    return this.char.writeValue(pkt);
  }

  async disconnect(){
    try {
      if (this.device && this.onDisconnected) {
        this.device.removeEventListener('gattserverdisconnected', this.onDisconnected);
      }
    } catch {}
    this.onDisconnected = null;

    try { this.device?.gatt?.disconnect(); } catch {}
    this.char = null;
    this.server = null;
    this.device = null;
  }
}

export class LuxTransport {
  constructor(opts){ this.opts = opts||{}; this.bt = new WebBluetoothBackend(opts); }
  async connect(metaCb){
    if (await this.bt.isSupported()) return await this.bt.connect(metaCb);
    throw new Error('Ingen understøttet transport (Web Bluetooth mangler i denne browser)');
  }
  async sendColor(r,g,b){ return this.bt.sendColor(r,g,b); }
  async disconnect(){ return this.bt.disconnect(); }
}
